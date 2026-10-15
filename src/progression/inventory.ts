import {
  computePoints,
  getSpecies,
  SPECIES,
  type FishSpecies,
  type SpeciesId,
} from '../fish/species.ts';
import type { CatchRecord } from './types.ts';

/** Regras do viveiro. O limite diário é fictício, só para o jogo. */
export interface InventoryRules {
  /** Quantos peixes cabem guardados ao mesmo tempo. */
  readonly capacity: number;
  /** Quantos peixes de uma mesma espécie podem ser guardados no mesmo dia (UTC). */
  readonly dailyLimitPerSpecies: number;
  /** Comprimento mínimo (cm) para guardar, por espécie. */
  readonly minKeepLengthCm: Readonly<Record<SpeciesId, number>>;
}

export const DEFAULT_INVENTORY_RULES: InventoryRules = {
  capacity: 20,
  dailyLimitPerSpecies: 5,
  minKeepLengthCm: { lambari: 12, tilapia: 30, tucunare: 40 },
};

export type KeepRefusal = 'protected_species' | 'undersized' | 'daily_limit' | 'storage_full';

export type KeepDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: KeepRefusal; readonly message: string };

export type KeepCandidate = Pick<CatchRecord, 'speciesId' | 'weightKg' | 'lengthCm' | 'timestamp'>;

export interface InventoryState {
  /** O que está guardado agora no viveiro. */
  readonly stored: readonly CatchRecord[];
  /** Histórico de capturas; conta para o limite diário o que foi guardado. */
  readonly history: readonly CatchRecord[];
}

const DAY_MS = 86_400_000;

/** Dia (UTC) do timestamp, usado no limite diário. */
export function dayIndex(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS);
}

function refuse(reason: KeepRefusal, message: string): KeepDecision {
  return { allowed: false, reason, message };
}

/**
 * Decide se a captura pode ser guardada. A ordem das checagens é fixa:
 * espécie protegida, tamanho mínimo, limite diário e capacidade.
 */
export function evaluateKeep(
  candidate: KeepCandidate,
  state: InventoryState,
  rules: InventoryRules = DEFAULT_INVENTORY_RULES,
  table: readonly FishSpecies[] = SPECIES,
): KeepDecision {
  if (!Number.isFinite(candidate.lengthCm) || !Number.isFinite(candidate.weightKg) || !Number.isFinite(candidate.timestamp)) {
    throw new RangeError('captura inválida: peso, comprimento e timestamp devem ser números finitos');
  }
  const species = getSpecies(candidate.speciesId, table);
  if (species.conservationStatus === 'protected') {
    return refuse('protected_species', `${species.name} é espécie protegida: registre a captura e solte o peixe.`);
  }
  const minLength = rules.minKeepLengthCm[candidate.speciesId];
  if (candidate.lengthCm < minLength) {
    return refuse(
      'undersized',
      `${species.name} com ${candidate.lengthCm} cm está abaixo do mínimo de ${minLength} cm: solte o peixe.`,
    );
  }
  const today = dayIndex(candidate.timestamp);
  const keptToday = state.history.filter(
    (r) => r.disposition === 'kept' && r.speciesId === candidate.speciesId && dayIndex(r.timestamp) === today,
  ).length;
  if (keptToday >= rules.dailyLimitPerSpecies) {
    return refuse(
      'daily_limit',
      `Limite diário de ${rules.dailyLimitPerSpecies} ${species.name} guardados atingido: solte o peixe.`,
    );
  }
  if (state.stored.length >= rules.capacity) {
    return refuse('storage_full', `O viveiro está cheio (${rules.capacity} peixes): solte o peixe ou libere espaço.`);
  }
  return { allowed: true };
}

/** Fração dos pontos da captura paga como bônus ao soltar o peixe. */
export const RELEASE_BONUS_FRACTION = 0.5;
/** Multiplicador extra do bônus ao soltar uma espécie protegida. */
export const PROTECTED_RELEASE_MULTIPLIER = 2;

/** Recompensa de pesca esportiva ao soltar: parte dos pontos, em dobro para espécie protegida. */
export function releaseReward(
  record: Pick<CatchRecord, 'speciesId' | 'weightKg'>,
  table: readonly FishSpecies[] = SPECIES,
): number {
  const species = getSpecies(record.speciesId, table);
  const multiplier = species.conservationStatus === 'protected' ? PROTECTED_RELEASE_MULTIPLIER : 1;
  return Math.max(1, Math.round(computePoints(species, record.weightKg) * RELEASE_BONUS_FRACTION * multiplier));
}
