import { describe, expect, it } from 'vitest';
import { computePoints, getSpecies, SPECIES, type FishSpecies, type SpeciesId } from '../fish/species.ts';
import type { CatchRecord } from './types.ts';
import {
  DEFAULT_INVENTORY_RULES,
  evaluateKeep,
  PROTECTED_RELEASE_MULTIPLIER,
  RELEASE_BONUS_FRACTION,
  releaseReward,
  type InventoryRules,
  type InventoryState,
} from './inventory.ts';
import {
  ACHIEVEMENT_IDS,
  biggestBySpecies,
  evaluateAchievements,
  isNewPersonalRecord,
  newlyUnlocked,
  personalRecord,
  SPORT_MASTER_RELEASES,
  type AchievementId,
  type AchievementState,
} from './achievements.ts';

const DAY = 86_400_000;
const T0 = 1_760_000_000_000;
let seq = 0;

function rec(overrides: Partial<CatchRecord> = {}): CatchRecord {
  seq++;
  return {
    id: `c${String(seq).padStart(4, '0')}`,
    speciesId: 'tilapia',
    weightKg: 0.5,
    lengthCm: 32,
    timestamp: T0 + seq * 1000,
    locationId: 'lago-principal',
    lureId: 'pellet',
    rarity: 'uncommon',
    disposition: 'kept',
    isPersonalRecord: false,
    ...overrides,
  };
}

function many(n: number, overrides: Partial<CatchRecord> = {}): CatchRecord[] {
  return Array.from({ length: n }, () => rec(overrides));
}

const EMPTY: InventoryState = { stored: [], history: [] };

function state(list: readonly AchievementState[], id: AchievementId): AchievementState {
  const found = list.find((a) => a.id === id);
  if (!found) throw new Error(`conquista ausente: ${id}`);
  return found;
}

/** Tabela fictícia com `n` espécies e peso máximo `maxKg`, para conquistas que a tabela real não alcança. */
function fakeTable(n: number, maxKg: number): FishSpecies[] {
  return Array.from({ length: n }, (_, i) => ({
    ...SPECIES[0]!,
    id: `sp${i}` as SpeciesId,
    maxWeightKg: maxKg,
  }));
}

describe('inventário: guardar captura', () => {
  it('recusa guardar espécie protegida (Tucunaré) com motivo', () => {
    const decision = evaluateKeep(rec({ speciesId: 'tucunare', weightKg: 3, lengthCm: 60 }), EMPTY);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('protected_species');
    expect(decision.message).toContain('Tucunaré');
    expect(decision.message).toContain('solte');
  });

  it('a proteção vence as outras regras, mesmo com viveiro vazio e tamanho grande', () => {
    const decision = evaluateKeep(rec({ speciesId: 'tucunare', weightKg: 5, lengthCm: 70 }), EMPTY);
    expect(decision).toMatchObject({ allowed: false, reason: 'protected_species' });
  });

  it('permite guardar espécie não protegida dentro das regras', () => {
    expect(evaluateKeep(rec({ speciesId: 'tilapia', lengthCm: 35 }), EMPTY)).toEqual({ allowed: true });
  });

  it('recusa abaixo do tamanho mínimo e aceita a partir dele', () => {
    const min = DEFAULT_INVENTORY_RULES.minKeepLengthCm.tilapia;
    const small = evaluateKeep(rec({ lengthCm: min - 0.1 }), EMPTY);
    expect(small).toMatchObject({ allowed: false, reason: 'undersized' });
    if (!small.allowed) expect(small.message).toContain(`${min} cm`);
    expect(evaluateKeep(rec({ lengthCm: min }), EMPTY)).toEqual({ allowed: true });
  });

  it('aplica o limite diário por espécie, só contando o que foi guardado no mesmo dia', () => {
    const rules: InventoryRules = { ...DEFAULT_INVENTORY_RULES, dailyLimitPerSpecies: 2 };
    const now = T0 + 10 * DAY;
    const history = [
      rec({ timestamp: now - 1000 }),
      rec({ timestamp: now - 2000 }),
      rec({ timestamp: now - 3000, disposition: 'released' }),
      rec({ timestamp: now - 3000, speciesId: 'lambari', lengthCm: 14 }),
    ];
    const candidate = rec({ timestamp: now });
    const refused = evaluateKeep(candidate, { stored: [], history }, rules);
    expect(refused).toMatchObject({ allowed: false, reason: 'daily_limit' });
    // Outra espécie no mesmo dia não é afetada.
    expect(evaluateKeep(rec({ speciesId: 'lambari', lengthCm: 14, timestamp: now }), { stored: [], history }, rules)).toEqual({
      allowed: true,
    });
    // No dia seguinte o limite zera.
    expect(evaluateKeep(rec({ timestamp: now + DAY }), { stored: [], history }, rules)).toEqual({ allowed: true });
  });

  it('recusa quando o viveiro está cheio', () => {
    const rules: InventoryRules = { ...DEFAULT_INVENTORY_RULES, capacity: 3 };
    const stored = many(3, { timestamp: T0 - 5 * DAY });
    expect(evaluateKeep(rec(), { stored, history: stored }, rules)).toMatchObject({
      allowed: false,
      reason: 'storage_full',
    });
    expect(evaluateKeep(rec(), { stored: stored.slice(1), history: stored }, rules)).toEqual({ allowed: true });
  });

  it('rejeita captura com números inválidos', () => {
    expect(() => evaluateKeep(rec({ lengthCm: Number.NaN }), EMPTY)).toThrow(RangeError);
  });
});

describe('inventário: recompensa ao soltar', () => {
  it('paga parte dos pontos da captura', () => {
    const tilapia = getSpecies('tilapia');
    expect(releaseReward({ speciesId: 'tilapia', weightKg: 2 })).toBe(
      Math.round(computePoints(tilapia, 2) * RELEASE_BONUS_FRACTION),
    );
  });

  it('paga em dobro ao soltar espécie protegida', () => {
    const tucunare = getSpecies('tucunare');
    expect(releaseReward({ speciesId: 'tucunare', weightKg: 3 })).toBe(
      Math.round(computePoints(tucunare, 3) * RELEASE_BONUS_FRACTION * PROTECTED_RELEASE_MULTIPLIER),
    );
  });

  it('nunca paga menos de 1 ponto', () => {
    expect(releaseReward({ speciesId: 'lambari', weightKg: 0.001 })).toBeGreaterThanOrEqual(1);
  });
});

describe('conquistas', () => {
  it('são 11 e todas aparecem mesmo sem capturas', () => {
    const list = evaluateAchievements([]);
    expect(ACHIEVEMENT_IDS).toHaveLength(11);
    expect(list.map((a) => a.id)).toEqual([...ACHIEVEMENT_IDS]);
    expect(list.every((a) => a.status !== 'unlocked' && a.unlockedAt === null)).toBe(true);
  });

  it('first_fish: primeiro peixe', () => {
    const first = rec();
    const result = state(evaluateAchievements([first]), 'first_fish');
    expect(result).toMatchObject({ status: 'unlocked', unlockedAt: first.timestamp });
  });

  it('over_1kg: peixe a partir de 1 kg', () => {
    expect(state(evaluateAchievements([rec({ weightKg: 0.999 })]), 'over_1kg').status).toBe('in_progress');
    expect(state(evaluateAchievements([rec({ weightKg: 1 })]), 'over_1kg').status).toBe('unlocked');
  });

  it('over_5kg: peixe a partir de 5 kg', () => {
    const below = rec({ speciesId: 'tucunare', weightKg: 4.9, rarity: 'legendary' });
    const at = rec({ speciesId: 'tucunare', weightKg: 5, rarity: 'legendary' });
    expect(state(evaluateAchievements([below]), 'over_5kg')).toMatchObject({ status: 'in_progress', current: 4.9 });
    expect(state(evaluateAchievements([below, at]), 'over_5kg')).toMatchObject({
      status: 'unlocked',
      unlockedAt: at.timestamp,
    });
  });

  it('over_10kg: bloqueada sem espécie que chegue a 10 kg; liberada e conquistável quando há', () => {
    expect(state(evaluateAchievements([]), 'over_10kg').status).toBe('locked');
    const table = fakeTable(1, 12);
    expect(state(evaluateAchievements([], table), 'over_10kg').status).toBe('in_progress');
    const big = rec({ speciesId: 'sp0' as SpeciesId, weightKg: 10.5 });
    expect(state(evaluateAchievements([big], table), 'over_10kg').status).toBe('unlocked');
  });

  it('ten_species: bloqueada (mas listada) até a tabela ter 10 espécies', () => {
    const real = evaluateAchievements(SPECIES.map((s) => rec({ speciesId: s.id })));
    expect(state(real, 'ten_species')).toMatchObject({ status: 'locked', current: 3, target: 10 });
    const table = fakeTable(10, 1);
    const nine = table.slice(0, 9).map((s) => rec({ speciesId: s.id }));
    expect(state(evaluateAchievements(nine, table), 'ten_species').status).toBe('in_progress');
    const ten = [...nine, rec({ speciesId: table[9]!.id })];
    expect(state(evaluateAchievements(ten, table), 'ten_species').status).toBe('unlocked');
  });

  it('catches_50: 50 capturas', () => {
    const list = many(50);
    expect(state(evaluateAchievements(list.slice(0, 49)), 'catches_50')).toMatchObject({
      status: 'in_progress',
      current: 49,
    });
    expect(state(evaluateAchievements(list), 'catches_50')).toMatchObject({
      status: 'unlocked',
      unlockedAt: list[49]!.timestamp,
    });
  });

  it('catches_100: 100 capturas', () => {
    const list = many(100);
    expect(state(evaluateAchievements(list.slice(0, 99)), 'catches_100').status).toBe('in_progress');
    expect(state(evaluateAchievements(list), 'catches_100')).toMatchObject({
      status: 'unlocked',
      unlockedAt: list[99]!.timestamp,
    });
  });

  it('first_rare: primeira captura rara', () => {
    expect(state(evaluateAchievements([rec()]), 'first_rare').status).toBe('in_progress');
    const rare = rec({ speciesId: 'tucunare', weightKg: 2, rarity: 'rare', disposition: 'released' });
    expect(state(evaluateAchievements([rec(), rare]), 'first_rare')).toMatchObject({
      status: 'unlocked',
      unlockedAt: rare.timestamp,
    });
  });

  it('first_legendary: primeira captura lendária', () => {
    expect(state(evaluateAchievements([rec({ rarity: 'rare' })]), 'first_legendary').status).toBe('in_progress');
    const legend = rec({ weightKg: 2.4, rarity: 'legendary' });
    expect(state(evaluateAchievements([legend]), 'first_legendary').status).toBe('unlocked');
  });

  it('personal_record: superar o maior peso anterior da mesma espécie', () => {
    const first = rec({ weightKg: 1 });
    const lighter = rec({ weightKg: 0.8 });
    const otherSpecies = rec({ speciesId: 'lambari', weightKg: 0.05, lengthCm: 14 });
    expect(state(evaluateAchievements([first, lighter, otherSpecies]), 'personal_record').status).toBe('in_progress');
    const heavier = rec({ weightKg: 1.2 });
    expect(state(evaluateAchievements([first, lighter, otherSpecies, heavier]), 'personal_record')).toMatchObject({
      status: 'unlocked',
      unlockedAt: heavier.timestamp,
    });
  });

  it(`sport_master: ${SPORT_MASTER_RELEASES} solturas`, () => {
    const released = many(SPORT_MASTER_RELEASES, { disposition: 'released' });
    const kept = many(5);
    const almost = [...released.slice(1), ...kept];
    expect(state(evaluateAchievements(almost), 'sport_master')).toMatchObject({
      status: 'in_progress',
      current: SPORT_MASTER_RELEASES - 1,
    });
    expect(state(evaluateAchievements([...released, ...kept]), 'sport_master').status).toBe('unlocked');
  });

  it('é idempotente: ordem e ids repetidos não mudam o resultado', () => {
    const list = [rec({ weightKg: 1 }), rec({ speciesId: 'tucunare', weightKg: 5, rarity: 'legendary' }), rec({ weightKg: 2 })];
    const once = evaluateAchievements(list);
    expect(evaluateAchievements(list)).toEqual(once);
    expect(evaluateAchievements([...list].reverse())).toEqual(once);
    expect(evaluateAchievements([...list, ...list])).toEqual(once);
    expect(newlyUnlocked(once, evaluateAchievements([...list, ...list]))).toEqual([]);
  });

  it('newlyUnlocked lista só o que passou a ficar desbloqueado', () => {
    const before = evaluateAchievements([rec({ weightKg: 0.5 })]);
    const after = evaluateAchievements([rec({ weightKg: 0.5 }), rec({ weightKg: 1.5 })]);
    expect(newlyUnlocked(before, after)).toEqual(['over_1kg', 'personal_record']);
  });
});

describe('recordes', () => {
  it('maior exemplar por espécie; no empate, o mais antigo', () => {
    const a = rec({ weightKg: 1 });
    const b = rec({ weightKg: 2 });
    const c = rec({ weightKg: 2 });
    const l = rec({ speciesId: 'lambari', weightKg: 0.06, lengthCm: 15 });
    const best = biggestBySpecies([c, l, a, b]);
    expect(best.get('tilapia')).toBe(b);
    expect(best.get('lambari')).toBe(l);
    expect(best.has('tucunare')).toBe(false);
  });

  it('recorde pessoal é a captura mais pesada de todas', () => {
    expect(personalRecord([])).toBeNull();
    const heavy = rec({ speciesId: 'tucunare', weightKg: 4, rarity: 'rare' });
    expect(personalRecord([rec({ weightKg: 2 }), heavy, rec({ weightKg: 1 })])).toBe(heavy);
  });

  it('nova captura é recorde se for a primeira da espécie ou superar o maior peso', () => {
    const history = [rec({ weightKg: 1.5 })];
    expect(isNewPersonalRecord({ speciesId: 'lambari', weightKg: 0.03 }, history)).toBe(true);
    expect(isNewPersonalRecord({ speciesId: 'tilapia', weightKg: 1.5 }, history)).toBe(false);
    expect(isNewPersonalRecord({ speciesId: 'tilapia', weightKg: 1.6 }, history)).toBe(true);
  });
});
