import type { Rng } from '../utils/rng.ts';
import { fightPull, type FishSpecies } from './species.ts';

export interface BiteConfig {
  readonly approachMinMs: number;
  readonly approachMaxMs: number;
  readonly nibbleIntervalMinMs: number;
  readonly nibbleIntervalMaxMs: number;
  /** Tentativas (beliscadas) antes de o peixe perder o interesse. */
  readonly maxNibbles: number;
  /** Janela de fisgada de um peixe com dificuldade 0. */
  readonly hookWindowBaseMs: number;
}

export const DEFAULT_BITE_CONFIG: BiteConfig = {
  approachMinMs: 1500,
  approachMaxMs: 5000,
  nibbleIntervalMinMs: 400,
  nibbleIntervalMaxMs: 1400,
  maxNibbles: 6,
  hookWindowBaseMs: 900,
};

export function validateBiteConfig(cfg: BiteConfig): BiteConfig {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`bite.${key} deve ser finito e > 0`);
    }
  }
  if (cfg.approachMaxMs < cfg.approachMinMs) throw new RangeError('bite.approachMaxMs deve ser >= approachMinMs');
  if (cfg.nibbleIntervalMaxMs < cfg.nibbleIntervalMinMs) {
    throw new RangeError('bite.nibbleIntervalMaxMs deve ser >= nibbleIntervalMinMs');
  }
  if (!Number.isInteger(cfg.maxNibbles)) throw new RangeError('bite.maxNibbles deve ser inteiro');
  return cfg;
}

/** Roteiro sorteado na chegada do peixe; tempos em ms desde a chegada. */
export interface BitePlan {
  readonly nibbleTimesMs: readonly number[];
  readonly biteAtMs: number | null;
  /** Quando o peixe desiste se não morder (igual a biteAtMs quando morde). */
  readonly leaveAtMs: number;
}

export function planBite(rng: Rng, species: FishSpecies, cfg: BiteConfig = DEFAULT_BITE_CONFIG): BitePlan {
  let t = rng.range(cfg.approachMinMs, cfg.approachMaxMs);
  const nibbleTimesMs: number[] = [];
  for (let i = 0; i < cfg.maxNibbles; i++) {
    const at = Math.round(t);
    if (rng.next() < species.biteChance) return { nibbleTimesMs, biteAtMs: at, leaveAtMs: at };
    nibbleTimesMs.push(at);
    t += rng.range(cfg.nibbleIntervalMinMs, cfg.nibbleIntervalMaxMs);
  }
  return { nibbleTimesMs, biteAtMs: null, leaveAtMs: Math.round(t) };
}

/** Probabilidade de o peixe morder antes de desistir. */
export function biteProbability(species: FishSpecies, cfg: BiteConfig = DEFAULT_BITE_CONFIG): number {
  return 1 - (1 - species.biteChance) ** cfg.maxNibbles;
}

export type FishPhase = 'approach' | 'nibble' | 'bite' | 'fight' | 'escape';
export type EscapeReason = 'lost_interest' | 'missed_hook' | 'line_snapped';

export type FishSignal =
  | { readonly type: 'nibble'; readonly atMs: number }
  | { readonly type: 'bite'; readonly atMs: number }
  | { readonly type: 'escape'; readonly reason: EscapeReason; readonly atMs: number };

const FISH_TRANSITIONS: Readonly<Record<FishPhase, readonly FishPhase[]>> = {
  approach: ['nibble', 'bite', 'escape'],
  nibble: ['nibble', 'bite', 'escape'],
  bite: ['fight', 'escape'],
  fight: ['escape'],
  escape: [],
};

export class FishBrain {
  private elapsed = 0;
  private nextNibble = 0;
  private current: FishPhase = 'approach';
  private reason: EscapeReason | null = null;
  private burstLeftMs = 0;

  constructor(
    readonly species: FishSpecies,
    readonly weightKg: number,
    readonly plan: BitePlan,
    readonly hookWindowMs: number,
  ) {
    if (!Number.isFinite(hookWindowMs) || hookWindowMs <= 0) {
      throw new RangeError(`hookWindowMs deve ser > 0; recebido: ${String(hookWindowMs)}`);
    }
  }

  get phase(): FishPhase {
    return this.current;
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  get escapeReason(): EscapeReason | null {
    return this.reason;
  }

  /** Avança o roteiro e devolve o que aconteceu, em ordem. */
  advance(dtMs: number): FishSignal[] {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    this.elapsed += dtMs;
    const signals: FishSignal[] = [];
    if (this.current === 'fight' || this.current === 'escape') return signals;

    const { plan } = this;
    if (this.current !== 'bite') {
      for (;;) {
        const at = plan.nibbleTimesMs[this.nextNibble];
        if (at === undefined || at > this.elapsed) break;
        this.nextNibble++;
        this.goTo('nibble');
        signals.push({ type: 'nibble', atMs: at });
      }
      if (plan.biteAtMs !== null && this.elapsed >= plan.biteAtMs) {
        this.goTo('bite');
        signals.push({ type: 'bite', atMs: plan.biteAtMs });
      } else if (plan.biteAtMs === null && this.elapsed >= plan.leaveAtMs) {
        this.escape('lost_interest');
        signals.push({ type: 'escape', reason: 'lost_interest', atMs: plan.leaveAtMs });
        return signals;
      }
    }

    if (this.current === 'bite' && plan.biteAtMs !== null && this.elapsed > plan.biteAtMs + this.hookWindowMs) {
      this.escape('missed_hook');
      signals.push({ type: 'escape', reason: 'missed_hook', atMs: plan.biteAtMs + this.hookWindowMs });
    }
    return signals;
  }

  /** Fisga: só vale na fase bite e dentro da janela. */
  hook(): boolean {
    const { biteAtMs } = this.plan;
    if (this.current !== 'bite' || biteAtMs === null || this.elapsed > biteAtMs + this.hookWindowMs) return false;
    this.goTo('fight');
    return true;
  }

  escape(reason: EscapeReason): void {
    if (this.current === 'escape') return;
    this.goTo('escape');
    this.reason = reason;
  }

  /** Tensão/s aplicada na luta; arrancadas sorteadas pelo perfil de resistência. */
  pull(dtMs: number, rng: Rng): number {
    if (this.current !== 'fight') return 0;
    let bursting = this.burstLeftMs > 0;
    if (bursting) {
      this.burstLeftMs = Math.max(0, this.burstLeftMs - dtMs);
    } else if (rng.next() < (this.species.resistance.burstChancePerSec * dtMs) / 1000) {
      this.burstLeftMs = this.species.resistance.burstMs;
      bursting = true;
    }
    return fightPull(this.species, this.weightKg, bursting);
  }

  private goTo(next: FishPhase): void {
    if (!FISH_TRANSITIONS[this.current].includes(next)) {
      throw new Error(`transição de peixe inválida: ${this.current} -> ${next}`);
    }
    this.current = next;
  }
}
