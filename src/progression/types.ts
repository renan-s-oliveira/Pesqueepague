import type { Rng } from '../utils/rng.ts';
import {
  expectedWeightKg,
  individualRarity,
  lengthForWeightCm,
  type FishSpecies,
  type LureId,
  type Rarity,
  type SpeciesId,
} from '../fish/species.ts';

export type CatchDisposition = 'released' | 'kept';

/** Registro de uma captura: contrato comum de save, galeria e progresso. */
export interface CatchRecord {
  readonly id: string;
  readonly speciesId: SpeciesId;
  readonly weightKg: number;
  readonly lengthCm: number;
  /** Epoch em ms. */
  readonly timestamp: number;
  readonly locationId: string;
  readonly lureId: LureId;
  readonly rarity: Rarity;
  readonly disposition: CatchDisposition;
  readonly isPersonalRecord: boolean;
  readonly photoId?: string;
}

/** Variação de cor do indivíduo sobre a paleta da espécie. */
export interface ColorVariation {
  /** Graus somados ao matiz, em [-HUE_SHIFT_MAX_DEG, HUE_SHIFT_MAX_DEG]. */
  readonly hueShiftDeg: number;
  /** Somado à luminosidade (0..1), em [-LIGHTNESS_SHIFT_MAX, LIGHTNESS_SHIFT_MAX]. */
  readonly lightnessShift: number;
  /** Semente do posicionamento das manchas. */
  readonly spotSeed: number;
}

export interface FishIndividual {
  readonly speciesId: SpeciesId;
  readonly lengthCm: number;
  readonly weightKg: number;
  readonly rarity: Rarity;
  readonly color: ColorVariation;
}

/** Desvio máximo do fator de condição: o peso fica em a·L^b·(1 ± isto). */
export const CONDITION_FACTOR_SPREAD = 0.05;
export const HUE_SHIFT_MAX_DEG = 8;
export const LIGHTNESS_SHIFT_MAX = 0.08;

const round = (value: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Gera o indivíduo no spawn, só a partir do Rng: comprimento enviesado para os menores (r²),
 * peso por W = a·L^b com fator de condição, e variação de cor. Mesmo estado do Rng, mesmo peixe.
 */
export function spawnIndividual(rng: Rng, species: FishSpecies): FishIndividual {
  const minLength = lengthForWeightCm(species, species.minWeightKg);
  const maxLength = lengthForWeightCm(species, species.maxWeightKg);
  const r = rng.next();
  const lengthCm = clamp(round(minLength + (maxLength - minLength) * r * r, 1), minLength, maxLength);
  const condition = 1 + rng.range(-CONDITION_FACTOR_SPREAD, CONDITION_FACTOR_SPREAD);
  const weightKg = clamp(
    round(expectedWeightKg(species, lengthCm) * condition, 3),
    species.minWeightKg,
    species.maxWeightKg,
  );
  const color: ColorVariation = {
    hueShiftDeg: round(rng.range(-HUE_SHIFT_MAX_DEG, HUE_SHIFT_MAX_DEG), 2),
    lightnessShift: round(rng.range(-LIGHTNESS_SHIFT_MAX, LIGHTNESS_SHIFT_MAX), 3),
    spotSeed: rng.int(0, 0xffffffff),
  };
  return { speciesId: species.id, lengthCm, weightKg, rarity: species.secret ? 'legendary' : individualRarity(species, weightKg), color };
}
