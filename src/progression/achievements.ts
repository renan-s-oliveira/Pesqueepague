import { SPECIES, type FishSpecies, type SpeciesId } from '../fish/species.ts';
import type { CatchRecord } from './types.ts';

export const ACHIEVEMENT_IDS = [
  'first_fish',
  'over_1kg',
  'over_5kg',
  'over_10kg',
  'ten_species',
  'catches_50',
  'catches_100',
  'first_rare',
  'first_legendary',
  'personal_record',
  'sport_master',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** 'locked': ainda não dá para conseguir com a tabela de espécies atual; continua listada. */
export type AchievementStatus = 'locked' | 'in_progress' | 'unlocked';

export interface AchievementState {
  readonly id: AchievementId;
  readonly status: AchievementStatus;
  readonly current: number;
  readonly target: number;
  /** Timestamp da captura que desbloqueou, ou null. */
  readonly unlockedAt: number | null;
}

/** Solturas exigidas por "mestre da pesca esportiva". */
export const SPORT_MASTER_RELEASES = 20;

interface Tally {
  catches: number;
  maxWeightKg: number;
  species: Set<SpeciesId>;
  rare: number;
  legendary: number;
  /** Capturas que superaram o maior peso anterior da mesma espécie. */
  recordsBroken: number;
  releases: number;
  best: Map<SpeciesId, number>;
}

interface AchievementDef {
  readonly id: AchievementId;
  readonly target: number;
  readonly current: (t: Tally) => number;
  readonly available: (table: readonly FishSpecies[]) => boolean;
}

const always = (): boolean => true;
const reachableWeight =
  (kg: number) =>
  (table: readonly FishSpecies[]): boolean =>
    table.some((s) => s.maxWeightKg >= kg);

const DEFS: readonly AchievementDef[] = [
  { id: 'first_fish', target: 1, current: (t) => t.catches, available: always },
  { id: 'over_1kg', target: 1, current: (t) => t.maxWeightKg, available: reachableWeight(1) },
  { id: 'over_5kg', target: 5, current: (t) => t.maxWeightKg, available: reachableWeight(5) },
  { id: 'over_10kg', target: 10, current: (t) => t.maxWeightKg, available: reachableWeight(10) },
  { id: 'ten_species', target: 10, current: (t) => t.species.size, available: (table) => table.length >= 10 },
  { id: 'catches_50', target: 50, current: (t) => t.catches, available: always },
  { id: 'catches_100', target: 100, current: (t) => t.catches, available: always },
  { id: 'first_rare', target: 1, current: (t) => t.rare, available: always },
  { id: 'first_legendary', target: 1, current: (t) => t.legendary, available: always },
  { id: 'personal_record', target: 1, current: (t) => t.recordsBroken, available: always },
  { id: 'sport_master', target: SPORT_MASTER_RELEASES, current: (t) => t.releases, available: always },
];

/** Ordem cronológica estável (timestamp, depois id), sem ids repetidos: a primeira ocorrência vale. */
export function chronological(records: readonly CatchRecord[]): CatchRecord[] {
  const seen = new Set<string>();
  const unique: CatchRecord[] = [];
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    unique.push(r);
  }
  return unique.sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Avalia as 11 conquistas a partir só da lista de capturas. Idempotente: a mesma lista,
 * em qualquer ordem e com ids repetidos, dá o mesmo resultado.
 */
export function evaluateAchievements(
  records: readonly CatchRecord[],
  table: readonly FishSpecies[] = SPECIES,
): AchievementState[] {
  const tally: Tally = {
    catches: 0,
    maxWeightKg: 0,
    species: new Set(),
    rare: 0,
    legendary: 0,
    recordsBroken: 0,
    releases: 0,
    best: new Map(),
  };
  const unlockedAt = new Map<AchievementId, number>();
  for (const r of chronological(records)) {
    tally.catches++;
    tally.maxWeightKg = Math.max(tally.maxWeightKg, r.weightKg);
    tally.species.add(r.speciesId);
    if (r.rarity === 'rare') tally.rare++;
    if (r.rarity === 'legendary') tally.legendary++;
    if (r.disposition === 'released') tally.releases++;
    const previous = tally.best.get(r.speciesId);
    if (previous !== undefined && r.weightKg > previous) tally.recordsBroken++;
    if (previous === undefined || r.weightKg > previous) tally.best.set(r.speciesId, r.weightKg);
    for (const def of DEFS) {
      if (!unlockedAt.has(def.id) && def.current(tally) >= def.target) unlockedAt.set(def.id, r.timestamp);
    }
  }
  return DEFS.map((def) => {
    const at = unlockedAt.get(def.id) ?? null;
    const status: AchievementStatus = at !== null ? 'unlocked' : def.available(table) ? 'in_progress' : 'locked';
    return { id: def.id, status, current: Math.min(def.current(tally), def.target), target: def.target, unlockedAt: at };
  });
}

/** Conquistas desbloqueadas em `next` que não estavam em `previous`. */
export function newlyUnlocked(
  previous: readonly AchievementState[],
  next: readonly AchievementState[],
): AchievementId[] {
  const before = new Set(previous.filter((a) => a.status === 'unlocked').map((a) => a.id));
  return next.filter((a) => a.status === 'unlocked' && !before.has(a.id)).map((a) => a.id);
}

/** Maior exemplar de cada espécie; no empate, o mais antigo. */
export function biggestBySpecies(records: readonly CatchRecord[]): Map<SpeciesId, CatchRecord> {
  const best = new Map<SpeciesId, CatchRecord>();
  for (const r of chronological(records)) {
    const current = best.get(r.speciesId);
    if (!current || r.weightKg > current.weightKg) best.set(r.speciesId, r);
  }
  return best;
}

/** Recorde pessoal: a captura mais pesada de todas; no empate, a mais antiga. */
export function personalRecord(records: readonly CatchRecord[]): CatchRecord | null {
  let best: CatchRecord | null = null;
  for (const r of chronological(records)) {
    if (!best || r.weightKg > best.weightKg) best = r;
  }
  return best;
}

/** Se a nova captura bate o maior peso já registrado da espécie (a primeira da espécie também conta). */
export function isNewPersonalRecord(
  candidate: Pick<CatchRecord, 'speciesId' | 'weightKg'>,
  records: readonly CatchRecord[],
): boolean {
  const best = biggestBySpecies(records).get(candidate.speciesId);
  return !best || candidate.weightKg > best.weightKg;
}
