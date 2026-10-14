import type { GameEvent, GameStateMachine, GameState } from '../core/stateMachine.ts';
import type { Clock } from '../utils/clock.ts';
import type { Rng } from '../utils/rng.ts';
import {
  castPower,
  computeCast,
  DEFAULT_CAST_CONFIG,
  validateCastConfig,
  type CastConfig,
  type CastResult,
} from '../fishing/cast.ts';
import { DEFAULT_REEL_CONFIG, ReelLine, validateReelConfig, type ReelConfig } from '../fishing/reel.ts';
import {
  DEFAULT_BITE_CONFIG,
  FishBrain,
  planBite,
  validateBiteConfig,
  type BiteConfig,
  type EscapeReason,
  type FishSignal,
} from '../fish/fishBrain.ts';
import {
  computePoints,
  hookWindowMs,
  pickSpecies,
  rollWeightKg,
  SPECIES,
  validateSpeciesTable,
  type FishSpecies,
  type SpeciesId,
} from '../fish/species.ts';

export interface SessionConfig {
  readonly cast: CastConfig;
  readonly reel: ReelConfig;
  readonly bite: BiteConfig;
  readonly species: readonly FishSpecies[];
  /** Passo fixo da simulação: o resultado não depende de como o tempo chega em update(). */
  readonly stepMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  cast: DEFAULT_CAST_CONFIG,
  reel: DEFAULT_REEL_CONFIG,
  bite: DEFAULT_BITE_CONFIG,
  species: SPECIES,
  stepMs: 20,
};

export type Outcome = 'caught' | 'escaped';

export interface JournalEntry {
  readonly castNumber: number;
  readonly speciesId: SpeciesId;
  readonly weightKg: number;
  readonly points: number;
  readonly outcome: Outcome;
  readonly reason: EscapeReason | null;
  readonly atMs: number;
}

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type OutcomeListener = (entry: JournalEntry) => void;

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** Liga as regras de pesca à GameStateMachine, de CASTING até CAUGHT/ESCAPED. */
export class FishingSession {
  private readonly cfg: SessionConfig;
  private gameTime = 0;
  private accumulator = 0;
  private lastNow: number;
  private chargeStartedAt: number | null = null;
  /** Nunca volta a zero: dá ids únicos aos eventos mesmo após reinício. */
  private castSerial = 0;
  private castNumber = 0;
  private flight: { readonly cast: CastResult; remainingMs: number } | null = null;
  private lure: CastResult | null = null;
  private fish: FishBrain | null = null;
  private line: ReelLine | null = null;
  private reeling = false;
  private resolved = true;
  private totalScore = 0;
  private readonly entries: JournalEntry[] = [];
  private readonly listeners = new Set<OutcomeListener>();

  constructor(
    private readonly machine: GameStateMachine,
    private readonly rng: Rng,
    private readonly clock: Clock,
    config: Partial<SessionConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_SESSION_CONFIG, ...config };
    validateCastConfig(this.cfg.cast);
    validateReelConfig(this.cfg.reel);
    validateBiteConfig(this.cfg.bite);
    validateSpeciesTable(this.cfg.species);
    if (!Number.isFinite(this.cfg.stepMs) || this.cfg.stepMs <= 0) throw new RangeError('stepMs deve ser > 0');
    this.lastNow = clock.now();
  }

  get state(): GameState {
    return this.machine.state;
  }

  get score(): number {
    return this.totalScore;
  }

  get journal(): readonly JournalEntry[] {
    return [...this.entries];
  }

  get isCharging(): boolean {
    return this.chargeStartedAt !== null;
  }

  get chargePower(): number {
    return this.chargeStartedAt === null ? 0 : castPower(this.clock.now() - this.chargeStartedAt, this.cfg.cast);
  }

  get currentCast(): CastResult | null {
    return this.flight?.cast ?? this.lure;
  }

  get currentFish(): FishBrain | null {
    return this.fish;
  }

  get tension(): number {
    return this.line?.tension ?? 0;
  }

  get lineDistanceM(): number | null {
    return this.line?.distanceM ?? null;
  }

  onOutcome(listener: OutcomeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  beginCharge(): ActionResult {
    if (this.state !== 'IDLE') return fail(`só é possível arremessar em IDLE (estado atual: ${this.state})`);
    if (this.chargeStartedAt !== null) return fail('já há um arremesso em carga');
    this.chargeStartedAt = this.clock.now();
    return OK;
  }

  releaseCast(): ActionResult {
    if (this.chargeStartedAt === null) return fail('nenhum arremesso em carga');
    const power = this.chargePower;
    this.chargeStartedAt = null;
    const cast = computeCast(power, this.cfg.cast);
    const result = this.dispatch({ type: 'CAST', id: `cast-${this.castSerial + 1}` });
    if (!result.ok) return result;
    this.castSerial++;
    this.castNumber++;
    this.flight = { cast, remainingMs: cast.flightMs };
    this.lure = null;
    this.resolved = false;
    return OK;
  }

  hook(): ActionResult {
    if (this.state !== 'HOOKED' || !this.fish || !this.lure) return fail('não há mordida para fisgar');
    if (!this.fish.hook()) return fail('fora da janela de fisgada');
    const result = this.dispatch({ type: 'HOOK_SET', id: `hook-${this.castSerial}` });
    if (!result.ok) return result;
    this.line = new ReelLine(this.lure.distanceM, this.cfg.reel);
    return OK;
  }

  setReeling(on: boolean): void {
    this.reeling = on;
  }

  /** Recolhe a isca sem peixe, de volta a IDLE. */
  retrieve(): ActionResult {
    const result = this.dispatch({ type: 'REEL_IN' });
    if (result.ok) this.clearCast();
    return result;
  }

  continue(): ActionResult {
    const result = this.dispatch({ type: 'CONTINUE' });
    if (result.ok) this.clearCast();
    return result;
  }

  pause(): ActionResult {
    this.update();
    const result = this.dispatch({ type: 'PAUSE' });
    if (result.ok) this.chargeStartedAt = null;
    return result;
  }

  resume(): ActionResult {
    const result = this.dispatch({ type: 'RESUME' });
    if (result.ok) this.lastNow = this.clock.now();
    return result;
  }

  /** Volta a IDLE com placar e diário zerados, a partir de qualquer estado de jogo. */
  restart(): ActionResult {
    if (this.state !== 'PAUSED' && !this.machine.can('QUIT') && this.machine.can('PAUSE')) {
      this.dispatch({ type: 'PAUSE' });
    }
    if (this.machine.can('QUIT')) this.dispatch({ type: 'QUIT' });
    if (this.state !== 'MENU') return fail(`não é possível reiniciar a partir de ${this.state}`);
    const result = this.dispatch({ type: 'START' });
    if (!result.ok) return result;
    this.clearCast();
    this.chargeStartedAt = null;
    this.totalScore = 0;
    this.castNumber = 0;
    this.entries.length = 0;
    this.gameTime = 0;
    this.accumulator = 0;
    this.lastNow = this.clock.now();
    return OK;
  }

  /** Consome o tempo do relógio em passos fixos; em PAUSED o tempo é descartado. */
  update(): void {
    const now = this.clock.now();
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    if (this.state === 'PAUSED') return;
    this.accumulator += dt;
    const step = this.cfg.stepMs;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.tick(step);
    }
  }

  private tick(dtMs: number): void {
    this.gameTime += dtMs;
    switch (this.state) {
      case 'CASTING':
        if (!this.flight) return;
        this.flight.remainingMs -= dtMs;
        if (this.flight.remainingMs <= 0) {
          this.lure = this.flight.cast;
          this.flight = null;
          if (this.dispatch({ type: 'LURE_LANDED', id: `land-${this.castSerial}` }).ok) this.spawnFish();
        }
        return;
      case 'WAITING':
      case 'HOOKED':
        if (!this.fish) return;
        for (const signal of this.fish.advance(dtMs)) this.handleSignal(signal);
        return;
      case 'REELING': {
        if (!this.fish || !this.line) return;
        const status = this.line.step(dtMs, this.reeling, this.fish.pull(dtMs, this.rng));
        if (status === 'caught') this.finish('caught', null);
        else if (status === 'snapped') {
          this.fish.escape('line_snapped');
          this.finish('escaped', 'line_snapped');
        }
        return;
      }
      default:
        return;
    }
  }

  private handleSignal(signal: FishSignal): void {
    if (signal.type === 'bite' && this.state === 'WAITING') {
      this.dispatch({ type: 'BITE', id: `bite-${this.castSerial}` });
    } else if (signal.type === 'escape' && signal.reason === 'lost_interest' && this.state === 'WAITING') {
      this.spawnFish();
    } else if (signal.type === 'escape' && signal.reason === 'missed_hook' && this.state === 'HOOKED') {
      this.finish('escaped', 'missed_hook');
    }
  }

  private spawnFish(): void {
    const species = pickSpecies(this.rng, this.cfg.species);
    const weightKg = rollWeightKg(this.rng, species);
    const plan = planBite(this.rng, species, this.cfg.bite);
    this.fish = new FishBrain(species, weightKg, plan, hookWindowMs(species, this.cfg.bite.hookWindowBaseMs));
  }

  /** Fecha o arremesso uma única vez: impede captura ou fuga dupla. */
  private finish(outcome: Outcome, reason: EscapeReason | null): void {
    if (this.resolved || !this.fish) return;
    const result = this.dispatch({
      type: outcome === 'caught' ? 'FISH_LANDED' : 'FISH_ESCAPED',
      id: `end-${this.castSerial}`,
    });
    if (!result.ok) return;
    this.resolved = true;
    const { species, weightKg } = this.fish;
    const entry: JournalEntry = {
      castNumber: this.castNumber,
      speciesId: species.id,
      weightKg,
      points: outcome === 'caught' ? computePoints(species, weightKg) : 0,
      outcome,
      reason,
      atMs: this.gameTime,
    };
    this.entries.push(entry);
    this.totalScore += entry.points;
    this.reeling = false;
    for (const listener of [...this.listeners]) listener(entry);
  }

  private clearCast(): void {
    this.flight = null;
    this.lure = null;
    this.fish = null;
    this.line = null;
    this.reeling = false;
    this.resolved = true;
  }

  private dispatch(event: GameEvent): ActionResult {
    const result = this.machine.dispatch(event);
    if (result.status === 'applied') return OK;
    return fail(result.status === 'rejected' ? result.reason : `evento duplicado: ${event.type}`);
  }
}
