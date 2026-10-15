import type { Rng } from '../utils/rng.ts';

export const SPECIES_IDS = ['lambari', 'tilapia', 'tucunare'] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

/** 'legendary' é só de indivíduo troféu (topo de peso da espécie); nenhuma espécie tem essa raridade base. */
export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];
export type SpeciesRarity = Exclude<Rarity, 'legendary'>;

export const RARITY_SCORE_MULTIPLIER: Readonly<Record<Rarity, number>> = {
  common: 1,
  uncommon: 1.5,
  rare: 2.5,
  legendary: 4,
};

export const LURE_IDS = ['worm', 'dough', 'corn', 'pellet', 'spinner', 'popper', 'jig'] as const;
export type LureId = (typeof LURE_IDS)[number];

export const CONSERVATION_STATUSES = ['least_concern', 'protected'] as const;
export type ConservationStatus = (typeof CONSERVATION_STATUSES)[number];

export const SPOT_PATTERNS = ['humeral_caudal_spots', 'vertical_bars', 'ocellated_bars'] as const;
export type SpotPattern = (typeof SPOT_PATTERNS)[number];

/** Relação comprimento-peso W = a·L^b, com W em gramas e L em centímetros. */
export interface LengthWeight {
  readonly a: number;
  readonly b: number;
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface SpeciesVisual {
  /** Cores em hex (#rrggbb). */
  readonly palette: { readonly dorsal: string; readonly flank: string; readonly belly: string; readonly fin: string };
  /** Proporções relativas ao comprimento total. */
  readonly proportions: { readonly bodyDepth: number; readonly headLength: number; readonly caudalLength: number };
  readonly spots: { readonly pattern: SpotPattern; readonly count: number; readonly color: string };
}

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
  readonly scientificName: string;
  readonly habitat: string;
  readonly curiosities: readonly string[];
  readonly lengthWeight: LengthWeight;
  readonly depthRangeM: Range;
  readonly preferredTempC: Range;
  readonly preferredLures: readonly LureId[];
  readonly conservationStatus: ConservationStatus;
  readonly visual: SpeciesVisual;
  readonly minWeightKg: number;
  readonly maxWeightKg: number;
  readonly rarity: SpeciesRarity;
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
    scientificName: 'Astyanax lacustris',
    habitat: 'Margens rasas e vegetadas do lago, em cardumes perto da superfície.',
    curiosities: [
      'Vive em cardumes e belisca a isca várias vezes antes de morder.',
      'Tem uma mancha escura atrás da cabeça e outra na base da cauda.',
    ],
    lengthWeight: { a: 0.0141, b: 3.05 },
    depthRangeM: { min: 0, max: 2 },
    preferredTempC: { min: 20, max: 30 },
    preferredLures: ['dough', 'corn', 'worm'],
    conservationStatus: 'least_concern',
    visual: {
      palette: { dorsal: '#6f7d6a', flank: '#c9ccc2', belly: '#eef0ea', fin: '#d9b23a' },
      proportions: { bodyDepth: 0.3, headLength: 0.22, caudalLength: 0.2 },
      spots: { pattern: 'humeral_caudal_spots', count: 2, color: '#1d1d1b' },
    },
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
    scientificName: 'Oreochromis niloticus',
    habitat: 'Fundo de lama e areia de águas calmas e mornas, perto de plantas aquáticas.',
    curiosities: [
      'A fêmea incuba os ovos na boca.',
      'Espécie africana, hoje comum em pesqueiros de todo o Brasil.',
    ],
    lengthWeight: { a: 0.0145, b: 3.04 },
    depthRangeM: { min: 0.5, max: 4 },
    preferredTempC: { min: 24, max: 32 },
    preferredLures: ['pellet', 'dough', 'worm'],
    conservationStatus: 'least_concern',
    visual: {
      palette: { dorsal: '#4e5a55', flank: '#8f9a92', belly: '#d8dcd4', fin: '#a8524a' },
      proportions: { bodyDepth: 0.38, headLength: 0.28, caudalLength: 0.18 },
      spots: { pattern: 'vertical_bars', count: 8, color: '#3a423e' },
    },
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
    scientificName: 'Cichla ocellaris',
    habitat: 'Áreas abertas perto de troncos e pedras, onde caça peixes menores.',
    curiosities: [
      'O ocelo na cauda parece um olho e confunde os predadores.',
      'Nesta reserva é protegido: a captura é registrada e o peixe deve ser solto.',
    ],
    lengthWeight: { a: 0.0102, b: 3.08 },
    depthRangeM: { min: 1, max: 6 },
    preferredTempC: { min: 25, max: 31 },
    preferredLures: ['spinner', 'popper', 'jig'],
    conservationStatus: 'protected',
    visual: {
      palette: { dorsal: '#4f6b2a', flank: '#c9b23c', belly: '#f0e3b0', fin: '#c4462e' },
      proportions: { bodyDepth: 0.27, headLength: 0.3, caudalLength: 0.17 },
      spots: { pattern: 'ocellated_bars', count: 3, color: '#1f2a16' },
    },
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

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function validRange(r: Range, floor: number): boolean {
  return Number.isFinite(r.min) && Number.isFinite(r.max) && r.min >= floor && r.max >= r.min;
}

function validateBiology(s: FishSpecies, where: string): void {
  if (s.scientificName.trim() === '') throw new RangeError(`${where}: scientificName vazio`);
  if (s.habitat.trim() === '') throw new RangeError(`${where}: habitat vazio`);
  const { a, b } = s.lengthWeight;
  if (!(Number.isFinite(a) && a > 0) || !finiteIn(b, 2, 4)) {
    throw new RangeError(`${where}: lengthWeight exige a > 0 e b em [2, 4]`);
  }
  if (!validRange(s.depthRangeM, 0)) throw new RangeError(`${where}: depthRangeM inválida`);
  if (!validRange(s.preferredTempC, -5)) throw new RangeError(`${where}: preferredTempC inválida`);
  if (s.preferredLures.length === 0 || !s.preferredLures.every((l) => (LURE_IDS as readonly string[]).includes(l))) {
    throw new RangeError(`${where}: preferredLures deve ter ao menos uma isca conhecida`);
  }
  if (!(CONSERVATION_STATUSES as readonly string[]).includes(s.conservationStatus)) {
    throw new RangeError(`${where}: conservationStatus inválido`);
  }
  const v = s.visual;
  const colors = [v.palette.dorsal, v.palette.flank, v.palette.belly, v.palette.fin, v.spots.color];
  if (!colors.every((c) => HEX_COLOR.test(c))) throw new RangeError(`${where}: cores da paleta devem ser #rrggbb`);
  const p = v.proportions;
  if (![p.bodyDepth, p.headLength, p.caudalLength].every((x) => finiteIn(x, 0.01, 1))) {
    throw new RangeError(`${where}: proporções devem estar em [0.01, 1]`);
  }
  if (!(SPOT_PATTERNS as readonly string[]).includes(v.spots.pattern) || !Number.isInteger(v.spots.count) || v.spots.count < 0) {
    throw new RangeError(`${where}: padrão de manchas inválido`);
  }
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
    if (!(RARITIES as readonly string[]).includes(s.rarity) || (s.rarity as Rarity) === 'legendary') {
      throw new RangeError(`${where}: raridade inválida ('legendary' é só para indivíduos troféu)`);
    }
    if (!finiteIn(s.difficulty, 0, 1)) throw new RangeError(`${where}: difficulty deve estar em [0, 1]`);
    if (!(Number.isFinite(s.spawnWeight) && s.spawnWeight > 0)) throw new RangeError(`${where}: spawnWeight deve ser > 0`);
    if (!(finiteIn(s.biteChance, 0, 1) && s.biteChance > 0)) throw new RangeError(`${where}: biteChance deve estar em (0, 1]`);
    const r = s.resistance;
    if (![r.basePull, r.burstPull, r.burstChancePerSec, r.burstMs].every((v) => finiteIn(v, 0, Number.MAX_VALUE))) {
      throw new RangeError(`${where}: perfil de resistência inválido`);
    }
    validateBiology(s, where);
  }
  return table;
}

/** Peso esperado (kg) para o comprimento, por W = a·L^b. */
export function expectedWeightKg(species: FishSpecies, lengthCm: number): number {
  const { a, b } = species.lengthWeight;
  return (a * lengthCm ** b) / 1000;
}

/** Inverso de W = a·L^b: comprimento (cm) esperado para o peso. */
export function lengthForWeightCm(species: FishSpecies, weightKg: number): number {
  const { a, b } = species.lengthWeight;
  return ((weightKg * 1000) / a) ** (1 / b);
}

/** Fração da faixa de peso a partir da qual o indivíduo é troféu ('legendary'). */
export const TROPHY_WEIGHT_FRACTION = 0.9;

export function trophyWeightKg(species: FishSpecies): number {
  return species.minWeightKg + (species.maxWeightKg - species.minWeightKg) * TROPHY_WEIGHT_FRACTION;
}

export function individualRarity(species: FishSpecies, weightKg: number): Rarity {
  return weightKg >= trophyWeightKg(species) ? 'legendary' : species.rarity;
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
