import type { Rng } from '../utils/rng.ts';

export const SPECIES_IDS = ['lambari', 'tilapia', 'tucunare'] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export const RARITIES = ['common', 'uncommon', 'rare'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_SCORE_MULTIPLIER: Readonly<Record<Rarity, number>> = { common: 1, uncommon: 1.5, rare: 2.5 };

export interface ResistanceProfile {
  /** Tensão por segundo que o peixe aplica na luta normal. */
  readonly basePull: number;
  /** Tensão por segundo durante uma arrancada. */
  readonly burstPull: number;
  readonly burstChancePerSec: number;
  readonly burstMs: number;
}

export interface FishSpecies {
  readonly id: SpeciesId;
  readonly name: string;
  readonly minWeightKg: number;
  readonly maxWeightKg: number;
  readonly rarity: Rarity;
  /** 0 (fácil) a 1 (difícil): encurta a janela de fisgada e aumenta o puxão. */
  readonly difficulty: number;
  /** Peso relativo no sorteio da espécie. */
  readonly spawnWeight: number;
  /** Chance de cada beliscada virar mordida. */
  readonly biteChance: number;
  readonly resistance: ResistanceProfile;
}

export const SPECIES: readonly FishSpecies[] = [
  {
    id: 'lambari',
    name: 'Lambari',
    minWeightKg: 0.02,
    maxWeightKg: 0.08,
    rarity: 'common',
    difficulty: 0.15,
    spawnWeight: 60,
    biteChance: 0.7,
    resistance: { basePull: 0.15, burstPull: 0.25, burstChancePerSec: 0.3, burstMs: 300 },
  },
  {
    id: 'tilapia',
    name: 'Tilápia',
    minWeightKg: 0.3,
    maxWeightKg: 2.5,
    rarity: 'uncommon',
    difficulty: 0.45,
    spawnWeight: 30,
    biteChance: 0.5,
    resistance: { basePull: 0.3, burstPull: 0.5, burstChancePerSec: 0.5, burstMs: 500 },
  },
  {
    id: 'tucunare',
    name: 'Tucunaré',
    minWeightKg: 0.8,
    maxWeightKg: 5,
    rarity: 'rare',
    difficulty: 0.8,
    spawnWeight: 10,
    biteChance: 0.35,
    resistance: { basePull: 0.45, burstPull: 0.8, burstChancePerSec: 0.7, burstMs: 700 },
  },
];

export function isSpeciesId(value: unknown): value is SpeciesId {
  return typeof value === 'string' && (SPECIES_IDS as readonly string[]).includes(value);
}

export function getSpecies(id: SpeciesId, table: readonly FishSpecies[] = SPECIES): FishSpecies {
  const found = table.find((s) => s.id === id);
  if (!found) throw new RangeError(`espécie ausente da tabela: ${id}`);
  return found;
}

function finiteIn(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Lança RangeError dizendo qual campo de qual espécie está fora da faixa. */
export function validateSpeciesTable(table: readonly FishSpecies[]): readonly FishSpecies[] {
  if (table.length === 0) throw new RangeError('a tabela de espécies não pode ser vazia');
  const seen = new Set<string>();
  for (const s of table) {
    if (!isSpeciesId(s.id)) throw new RangeError(`id de espécie desconhecido: ${String(s.id)}`);
    if (seen.has(s.id)) throw new RangeError(`espécie repetida: ${s.id}`);
    seen.add(s.id);
    const where = `espécie ${s.id}`;
    if (!(s.minWeightKg > 0) || !Number.isFinite(s.maxWeightKg) || s.maxWeightKg < s.minWeightKg) {
      throw new RangeError(`${where}: faixa de peso inválida`);
    }
    if (!(RARITIES as readonly string[]).includes(s.rarity)) throw new RangeError(`${where}: raridade inválida`);
    if (!finiteIn(s.difficulty, 0, 1)) throw new RangeError(`${where}: difficulty deve estar em [0, 1]`);
    if (!(Number.isFinite(s.spawnWeight) && s.spawnWeight > 0)) throw new RangeError(`${where}: spawnWeight deve ser > 0`);
    if (!(finiteIn(s.biteChance, 0, 1) && s.biteChance > 0)) throw new RangeError(`${where}: biteChance deve estar em (0, 1]`);
    const r = s.resistance;
    if (![r.basePull, r.burstPull, r.burstChancePerSec, r.burstMs].every((v) => finiteIn(v, 0, Number.MAX_VALUE))) {
      throw new RangeError(`${where}: perfil de resistência inválido`);
    }
  }
  return table;
}

/** Probabilidade de a espécie ser sorteada, pelo peso relativo na tabela. */
export function spawnProbability(id: SpeciesId, table: readonly FishSpecies[] = SPECIES): number {
  const total = table.reduce((sum, s) => sum + s.spawnWeight, 0);
  return getSpecies(id, table).spawnWeight / total;
}

export function pickSpecies(rng: Rng, table: readonly FishSpecies[] = SPECIES): FishSpecies {
  const total = table.reduce((sum, s) => sum + s.spawnWeight, 0);
  const r = rng.next() * total;
  let acc = 0;
  let last: FishSpecies | undefined;
  for (const s of table) {
    acc += s.spawnWeight;
    last = s;
    if (r < acc) return s;
  }
  if (!last) throw new RangeError('a tabela de espécies não pode ser vazia');
  return last;
}

/** Peso em kg com 3 casas, enviesado para os menores (r²). */
export function rollWeightKg(rng: Rng, species: FishSpecies): number {
  const r = rng.next();
  const raw = species.minWeightKg + (species.maxWeightKg - species.minWeightKg) * r * r;
  const rounded = Math.round(raw * 1000) / 1000;
  return Math.min(species.maxWeightKg, Math.max(species.minWeightKg, rounded));
}

export function hookWindowMs(species: FishSpecies, baseMs: number): number {
  return Math.round(baseMs * (1 - 0.6 * species.difficulty));
}

/** Tensão por segundo que o peixe aplica na luta, maior com dificuldade e peso. */
export function fightPull(species: FishSpecies, weightKg: number, bursting: boolean): number {
  const span = species.maxWeightKg - species.minWeightKg;
  const weightRatio = span > 0 ? Math.min(1, Math.max(0, (weightKg - species.minWeightKg) / span)) : 1;
  const base = bursting ? species.resistance.burstPull : species.resistance.basePull;
  return base * (0.75 + 0.5 * species.difficulty) * (0.7 + 0.3 * weightRatio);
}

export function computePoints(species: FishSpecies, weightKg: number): number {
  const raw = weightKg * 100 * RARITY_SCORE_MULTIPLIER[species.rarity] * (1 + species.difficulty);
  return Math.max(1, Math.round(raw));
}
