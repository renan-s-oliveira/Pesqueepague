import { describe, expect, it } from 'vitest';
import {
  defaultSaveData,
  loadSave,
  parseSaveData,
  recordOutcome,
  SAVE_KEY,
  writeSave,
  type KeyValueStore,
} from '../config/persistence.ts';

class MemoryStore implements KeyValueStore {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function storeWith(text: string): MemoryStore {
  const store = new MemoryStore();
  store.setItem(SAVE_KEY, text);
  return store;
}

describe('persistência', () => {
  it('salva e carrega de volta o mesmo conteúdo', () => {
    const store = new MemoryStore();
    const data = {
      ...defaultSaveData(),
      volumes: { master: 0.3, music: 0, sfx: 1 },
      bestCatch: { speciesId: 'tucunare' as const, weightKg: 3.2, points: 1440 },
    };
    expect(writeSave(store, data)).toEqual({ ok: true });
    expect(loadSave(store)).toEqual({ data, status: 'ok', issues: [] });
  });

  it('sem save devolve os padrões', () => {
    expect(loadSave(new MemoryStore())).toEqual({ data: defaultSaveData(), status: 'empty', issues: [] });
  });

  it('migra o formato v1 para o atual', () => {
    const result = loadSave(
      storeWith(JSON.stringify({ version: 1, volume: 0.4, bestSpecies: 'tilapia', bestWeightKg: 1.5, totalCatches: 9 })),
    );
    expect(result.status).toBe('migrated');
    expect(result.data.version).toBe(2);
    expect(result.data.volumes.master).toBe(0.4);
    expect(result.data.bestCatch).toMatchObject({ speciesId: 'tilapia', weightKg: 1.5 });
    expect(result.data.stats.catches).toBe(9);
  });

  it('save v2 gravado antes dos presets novos, com qualidade medium, carrega sem perda', () => {
    const legacy = {
      version: 2,
      settings: { quality: 'medium', showHints: false, cameraSensitivity: 1.7 },
      volumes: { master: 0.5, music: 0.25, sfx: 0.9 },
      bestCatch: { speciesId: 'tilapia', weightKg: 1.5, points: 300 },
      stats: { catches: 12, escapes: 4, totalPoints: 2100, totalWeightKg: 8.75 },
    };
    const store = storeWith(JSON.stringify(legacy));
    const result = loadSave(store);
    // O save antigo não tinha settings.lureId: ele ganha o padrão sem perder o resto.
    const expected = { ...legacy, settings: { ...legacy.settings, lureId: 'worm' } };
    expect(result).toEqual({ data: expected, status: 'ok', issues: [] });
    expect(writeSave(store, result.data)).toEqual({ ok: true });
    expect(JSON.parse(store.getItem(SAVE_KEY) ?? 'null')).toEqual(expected);
  });

  it('settings.lureId faz ida e volta no save', () => {
    const store = new MemoryStore();
    const data = { ...defaultSaveData(), settings: { ...defaultSaveData().settings, lureId: 'spinner' as const } };
    expect(writeSave(store, data)).toEqual({ ok: true });
    expect(loadSave(store)).toEqual({ data, status: 'ok', issues: [] });
  });

  it('settings.lureId inválido volta ao padrão com aviso', () => {
    const result = parseSaveData({ version: 2, settings: { lureId: 'banana' } });
    expect(result.data.settings.lureId).toBe('worm');
    expect(result.issues).toContain('settings.lureId inválido');
  });

  it.each(['low', 'medium', 'high', 'ultra', 'auto'] as const)('qualidade %s faz ida e volta no save', (quality) => {
    const store = new MemoryStore();
    const data = { ...defaultSaveData(), settings: { ...defaultSaveData().settings, quality } };
    expect(writeSave(store, data)).toEqual({ ok: true });
    expect(loadSave(store)).toEqual({ data, status: 'ok', issues: [] });
  });

  it('não grava save inválido', () => {
    const store = new MemoryStore();
    const bad = { ...defaultSaveData(), volumes: { master: 5, music: 0, sfx: 0 } };
    expect(writeSave(store, bad).ok).toBe(false);
    expect(store.items.size).toBe(0);
  });

  it('registra capturas, fugas e a melhor captura pelo peso', () => {
    let data = defaultSaveData();
    data = recordOutcome(data, { outcome: 'caught', speciesId: 'tilapia', weightKg: 1.2, points: 250 });
    data = recordOutcome(data, { outcome: 'caught', speciesId: 'lambari', weightKg: 0.05, points: 6 });
    data = recordOutcome(data, { outcome: 'escaped', speciesId: 'tucunare', weightKg: 4, points: 0 });
    expect(data.stats).toEqual({ catches: 2, escapes: 1, totalPoints: 256, totalWeightKg: 1.25 });
    expect(data.bestCatch).toEqual({ speciesId: 'tilapia', weightKg: 1.2, points: 250 });
  });
});

describe('dados corrompidos ou antigos caem nos padrões sem lançar', () => {
  const cases: [string, string][] = [
    ['JSON quebrado', '{"version":2,'],
    ['texto qualquer', 'não é json'],
    ['null', 'null'],
    ['array', '[1,2,3]'],
    ['número', '42'],
    ['versão antiga sem suporte', JSON.stringify({ version: 0, volume: 0.1 })],
    ['sem versão', JSON.stringify({ volumes: { master: 0.1 } })],
    ['versão futura', JSON.stringify({ version: 99 })],
    ['versão como texto', JSON.stringify({ version: '2' })],
  ];

  it.each(cases)('%s', (_label, text) => {
    let result: ReturnType<typeof loadSave> | undefined;
    expect(() => {
      result = loadSave(storeWith(text));
    }).not.toThrow();
    expect(result?.status).toBe('invalid');
    expect(result?.data).toEqual(defaultSaveData());
    expect(result?.issues.length).toBeGreaterThan(0);
  });

  it('campos inválidos de um save v2 voltam ao padrão um a um', () => {
    const result = loadSave(
      storeWith(
        JSON.stringify({
          version: 2,
          settings: { quality: 'insano', showHints: 'sim', cameraSensitivity: 2 },
          volumes: { master: -1, music: 0.2, sfx: 'alto' },
          bestCatch: { speciesId: 'tubarao', weightKg: 900, points: 1 },
          stats: { catches: 1.5, escapes: 3, totalPoints: -10, totalWeightKg: 2 },
        }),
      ),
    );
    const d = defaultSaveData();
    expect(result.status).toBe('invalid');
    expect(result.data.settings).toEqual({ ...d.settings, cameraSensitivity: 2 });
    expect(result.data.volumes).toEqual({ ...d.volumes, music: 0.2 });
    expect(result.data.bestCatch).toBeNull();
    expect(result.data.stats).toEqual({ catches: 0, escapes: 3, totalPoints: 0, totalWeightKg: 2 });
  });

  it('v1 com campos inválidos migra com padrões', () => {
    const result = loadSave(storeWith(JSON.stringify({ version: 1, volume: 'muito', bestSpecies: 'dourado' })));
    expect(result.status).toBe('migrated');
    expect(result.data).toEqual(defaultSaveData());
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('save gigante é recusado', () => {
    const result = loadSave(storeWith(`"${'x'.repeat(70000)}"`));
    expect(result).toMatchObject({ status: 'invalid', data: defaultSaveData() });
  });

  it('armazenamento que lança ou não existe vira unavailable', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadSave(throwing)).toMatchObject({ status: 'unavailable', data: defaultSaveData() });
    expect(loadSave(null)).toMatchObject({ status: 'unavailable', data: defaultSaveData() });
    expect(writeSave(throwing, defaultSaveData()).ok).toBe(false);
  });

  it('parseSaveData aceita qualquer valor sem lançar', () => {
    for (const value of [undefined, 0, '', true, Symbol('x'), () => 1, { version: 2, settings: [] }]) {
      expect(() => parseSaveData(value)).not.toThrow();
    }
  });
});
