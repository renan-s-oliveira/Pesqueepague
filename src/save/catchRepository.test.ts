import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSaveData, type SaveData } from '../config/persistence.ts';
import { getSpecies, individualRarity, lengthForWeightCm } from '../fish/species.ts';
import type { CatchRecord } from '../progression/types.ts';
import { CatchRepository, DEFAULT_LOCATION_ID, LEGACY_BEST_CATCH_ID } from './catchRepository.ts';
import { MemoryAdapter } from './storage.ts';

const record = (overrides: Partial<CatchRecord> & { id: string }): CatchRecord => ({
  speciesId: 'tilapia',
  weightKg: 1.2,
  lengthCm: 30,
  timestamp: 1_000,
  locationId: DEFAULT_LOCATION_ID,
  lureId: 'worm',
  rarity: 'common',
  disposition: 'kept',
  isPersonalRecord: false,
  ...overrides,
});

describe('CatchRepository com MemoryAdapter', () => {
  let repo: CatchRepository;

  beforeEach(() => {
    repo = new CatchRepository(new MemoryAdapter());
  });

  it('faz o CRUD de capturas e lista da mais recente para a mais antiga', async () => {
    await repo.put(record({ id: 'a', timestamp: 100 }));
    await repo.put(record({ id: 'b', timestamp: 300 }));
    await repo.put(record({ id: 'c', timestamp: 200 }));
    expect((await repo.get('b'))?.timestamp).toBe(300);
    expect((await repo.list()).map((c) => c.id)).toEqual(['b', 'c', 'a']);
    await repo.put(record({ id: 'b', timestamp: 300, disposition: 'released' }));
    expect((await repo.get('b'))?.disposition).toBe('released');
    await repo.remove('b');
    expect(await repo.get('b')).toBeUndefined();
    expect((await repo.list()).map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('remover a captura apaga a foto associada', async () => {
    await repo.putPhoto('foto1', new Blob(['pixels'], { type: 'image/png' }));
    await repo.put(record({ id: 'a', photoId: 'foto1' }));
    expect(await repo.getPhoto('foto1')).toBeDefined();
    await repo.remove('a');
    expect(await repo.getPhoto('foto1')).toBeUndefined();
  });

  it('guarda e devolve fotos como Blob, com o conteúdo intacto', async () => {
    const blob = new Blob(['conteúdo-da-foto'], { type: 'image/png' });
    await repo.putPhoto('foto1', blob);
    const loaded = await repo.getPhoto('foto1');
    expect(loaded?.type).toBe('image/png');
    expect(await loaded?.text()).toBe('conteúdo-da-foto');
  });

  it('consulta por espécie, raridade, local, faixa de peso e de data', async () => {
    await repo.put(record({ id: 'a', speciesId: 'lambari', rarity: 'common', weightKg: 0.2, timestamp: 100 }));
    await repo.put(record({ id: 'b', speciesId: 'tilapia', rarity: 'rare', weightKg: 2.5, timestamp: 200 }));
    await repo.put(record({ id: 'c', speciesId: 'tilapia', rarity: 'common', weightKg: 1.0, timestamp: 300, locationId: 'outro-lago' }));
    const ids = async (q: Parameters<CatchRepository['query']>[0]): Promise<string[]> => (await repo.query(q)).map((c) => c.id);
    expect(await ids({ speciesId: 'tilapia' })).toEqual(['c', 'b']);
    expect(await ids({ rarity: 'rare' })).toEqual(['b']);
    expect(await ids({ locationId: 'outro-lago' })).toEqual(['c']);
    expect(await ids({ minWeightKg: 0.5, maxWeightKg: 2 })).toEqual(['c']);
    expect(await ids({ from: 150, to: 250 })).toEqual(['b']);
    expect(await ids({ speciesId: 'tilapia', rarity: 'common' })).toEqual(['c']);
    expect(await ids({})).toEqual(['c', 'b', 'a']);
  });

  it('controla o inventário: quantidade inteira, zero remove e negativa é recusada', async () => {
    await repo.setItemQuantity('worm', 10);
    expect(await repo.getItemQuantity('worm')).toBe(10);
    expect(await repo.getItemQuantity('corn')).toBe(0);
    await repo.setItemQuantity('worm', 0);
    expect(await repo.listInventory()).toEqual([]);
    await expect(repo.setItemQuantity('worm', -1)).rejects.toThrow(/inteiro >= 0/);
    await expect(repo.setItemQuantity('worm', 1.5)).rejects.toThrow(/inteiro >= 0/);
  });

  it('desbloqueia conquistas uma vez só, mantendo o primeiro horário', async () => {
    expect(await repo.isUnlocked('primeira-captura')).toBe(false);
    await repo.unlock('primeira-captura', 111);
    await repo.unlock('primeira-captura', 999);
    expect(await repo.isUnlocked('primeira-captura')).toBe(true);
    expect(await repo.listAchievements()).toEqual([{ id: 'primeira-captura', unlockedAt: 111 }]);
  });

  it('migra bestCatch e stats do save local uma única vez', async () => {
    const save: SaveData = {
      ...defaultSaveData(),
      bestCatch: { speciesId: 'tilapia', weightKg: 2.5, points: 120 },
      stats: { catches: 3, escapes: 1, totalPoints: 150, totalWeightKg: 5.5 },
    };
    const first = await repo.migrateLegacySave(save, 777);
    expect(first.migrated).toBe(true);
    const species = getSpecies('tilapia');
    expect(first.record).toEqual({
      id: LEGACY_BEST_CATCH_ID,
      speciesId: 'tilapia',
      weightKg: 2.5,
      lengthCm: Math.round(lengthForWeightCm(species, 2.5) * 10) / 10,
      timestamp: 777,
      locationId: DEFAULT_LOCATION_ID,
      lureId: save.settings.lureId,
      rarity: individualRarity(species, 2.5),
      disposition: 'kept',
      isPersonalRecord: true,
    });
    expect(await repo.get(LEGACY_BEST_CATCH_ID)).toEqual(first.record);

    const second = await repo.migrateLegacySave(save, 888);
    expect(second).toEqual({ migrated: false, record: null });
    expect((await repo.list()).length).toBe(1);
  });

  it('sem bestCatch, a migração só grava a marca e não cria captura', async () => {
    const first = await repo.migrateLegacySave(defaultSaveData(), 777);
    expect(first).toEqual({ migrated: true, record: null });
    expect(await repo.list()).toEqual([]);
    const second = await repo.migrateLegacySave(defaultSaveData(), 888);
    expect(second.migrated).toBe(false);
  });
});
