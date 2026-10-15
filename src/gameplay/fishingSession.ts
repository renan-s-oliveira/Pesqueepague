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
import {
  DEFAULT_DRAG_REEL_CONFIG,
  DragReel,
  validateDragReelConfig,
  type DragReelConfig,
} from '../fishing/reel.ts';
import { LINE_SPECS, validateLineSpec, type LineSpec } from '../fishing/linePhysics.ts';
import {
  DEFAULT_BITE_CONFIG,
  fightProfile,
  FishBrain,
  planBite,
  validateBiteConfig,
  type BiteConfig,
  type EscapeReason,
  type FishSignal,
} from '../fish/fishBrain.ts';
import { SPECIES_BEHAVIOR } from '../fish/behavior.ts';
import { RodPhysics } from '../fishing/rodPhysics.ts';
import { spawnIndividual, type FishIndividual } from '../progression/types.ts';
import {
  computePoints,
  hookWindowMs,
  LURE_IDS,
  pickSpecies,
  SPECIES,
  validateSpeciesTable,
  type FishSpecies,
  type LureId,
  type SpeciesId,
} from '../fish/species.ts';

/** Captura confirmada: o indivíduo é o mesmo objeto sorteado no spawn, com peso imutável. */
export interface CaughtFish {
  readonly individual: FishIndividual;
  readonly lureId: LureId;
  readonly location: { readonly distanceM: number };
  readonly hour: number;
}

export type CatchListener = (fish: CaughtFish) => void;

/** Tensão (N) equivalente na ponteira durante a beliscada/mordida: só um micromovimento. */
const NIBBLE_TIP_N = 0.6;
const BITE_TIP_N = 1.5;
const TIP_KICK_MS = 120;
/** Drag padrão do molinete, em newtons. */
export const DEFAULT_DRAG_N = 60;
/** Converte o puxão do perfil de luta (tensão/s do catálogo) em velocidade do peixe (m/s). */
const PULL_TO_MPS = 2;
/** Velocidade (m/s) com que a linha esticada relaxa quando a tensão domina o peixe. */
const LINE_RECOVERY_MPS = 1;
/** Linha solta abaixo disso conta como peixe trazido até o pescador. */
const CATCH_LINE_OUT_M = 0.05;
/** Abaixo desta fração da resistência da linha o peixe recupera fôlego. */
const SLACK_TENSION_FRACTION = 0.2;

/** Controles contínuos da briga e do arremesso, alimentados pelo ActionState do input. */
export interface SessionControls {
  /** Velocidade de recolhimento em [0, 1]. */
  readonly reelSpeed: number;
  /** Drag do molinete em [0, 1] (fração do drag máximo do molinete). */
  readonly drag: number;
  /** Posição da vara em [-1, 1] nos dois eixos. */
  readonly rodX: number;
  readonly rodY: number;
  /** Direção do arremesso em radianos. */
  readonly castYaw: number;
}

export interface SessionConfig {
  readonly cast: CastConfig;
  readonly line: LineSpec;
  readonly dragReel: DragReelConfig;
  readonly bite: BiteConfig;
  readonly species: readonly FishSpecies[];
  readonly lureId: LureId;
  /** Hora do dia (0–24) no momento da captura. */
  readonly hourOfDay: () => number;
  /** Passo fixo da simulação: o resultado não depende de como o tempo chega em update(). */
  readonly stepMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  cast: DEFAULT_CAST_CONFIG,
  line: LINE_SPECS.mono020,
  dragReel: DEFAULT_DRAG_REEL_CONFIG,
  bite: DEFAULT_BITE_CONFIG,
  species: SPECIES,
  lureId: 'worm',
  hourOfDay: () => 12,
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
  private individual: FishIndividual | null = null;
  private readonly rod = new RodPhysics();
  private tipKick: { tensionN: number; leftMs: number } | null = null;
  private readonly catchListeners = new Set<CatchListener>();
  private line: DragReel | null = null;
  private controlsState: SessionControls;
  private lureIdState: LureId;
  private stamina = 1;
  private burstLeftMs = 0;
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
    validateLineSpec(this.cfg.line);
    validateDragReelConfig(this.cfg.dragReel);
    validateBiteConfig(this.cfg.bite);
    validateSpeciesTable(this.cfg.species);
    if (!Number.isFinite(this.cfg.stepMs) || this.cfg.stepMs <= 0) throw new RangeError('stepMs deve ser > 0');
    this.controlsState = {
      reelSpeed: 1,
      drag: Math.min(1, DEFAULT_DRAG_N / this.cfg.dragReel.maxDragN),
      rodX: 0,
      rodY: 0,
      castYaw: 0,
    };
    this.lureIdState = this.cfg.lureId;
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

  /** Tensão normalizada: tensão atual (N) sobre a resistência da linha, em [0, 1]. */
  get tension(): number {
    return this.line ? Math.min(1, this.line.tensionN / this.cfg.line.breakingStrengthN) : 0;
  }

  /** Tensão na linha, em newtons. */
  get tensionN(): number {
    return this.line?.tensionN ?? 0;
  }

  get lineDistanceM(): number | null {
    return this.line?.lineOutM ?? null;
  }

  get controls(): SessionControls {
    return this.controlsState;
  }

  /** Drag aplicado no molinete, em newtons. */
  get dragN(): number {
    return this.controlsState.drag * this.cfg.dragReel.maxDragN;
  }

  get lureId(): LureId {
    return this.lureIdState;
  }

  /** Flexão atual da vara (rad): micromovimento na mordida, curva na briga. */
  get rodBendRad(): number {
    return this.rod.bendRad;
  }

  get currentIndividual(): FishIndividual | null {
    return this.individual;
  }

  onCatch(listener: CatchListener): () => void {
    this.catchListeners.add(listener);
    return () => {
      this.catchListeners.delete(listener);
    };
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
    this.line = new DragReel(
      this.cfg.line,
      Math.min(this.lure.distanceM, this.cfg.dragReel.spoolCapacityM),
      this.dragN,
      this.cfg.dragReel,
    );
    this.stamina = 1;
    this.burstLeftMs = 0;
    return OK;
  }

  setReeling(on: boolean): void {
    this.reeling = on;
  }

  /** Controles contínuos (teclado, gamepad ou toque): valores não finitos mantêm o anterior. */
  setControls(controls: SessionControls): void {
    const clamp = (v: number, lo: number, hi: number, cur: number): number =>
      Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : cur;
    const cur = this.controlsState;
    this.controlsState = {
      reelSpeed: clamp(controls.reelSpeed, 0, 1, cur.reelSpeed),
      drag: clamp(controls.drag, 0, 1, cur.drag),
      rodX: clamp(controls.rodX, -1, 1, cur.rodX),
      rodY: clamp(controls.rodY, -1, 1, cur.rodY),
      castYaw: Number.isFinite(controls.castYaw) ? controls.castYaw : cur.castYaw,
    };
    this.line?.setDrag(this.dragN);
  }

  /** Troca a isca da sessão; vale para as próximas capturas. */
  setLure(lureId: LureId): ActionResult {
    if (!(LURE_IDS as readonly string[]).includes(lureId)) return fail(`isca desconhecida: ${String(lureId)}`);
    this.lureIdState = lureId;
    return OK;
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
    this.tickSimulation(dtMs);
    this.rod.setLineTension(this.tipTensionN(dtMs));
    this.rod.update(dtMs);
  }

  private tipTensionN(dtMs: number): number {
    if (this.state === 'REELING' && this.line) return this.line.tensionN;
    if (!this.tipKick) return 0;
    this.tipKick.leftMs -= dtMs;
    const { tensionN } = this.tipKick;
    if (this.tipKick.leftMs <= 0) this.tipKick = null;
    return tensionN;
  }

  private tickSimulation(dtMs: number): void {
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
        const profile = fightProfile(this.fish.species, this.fish.weightKg, this.stamina);
        if (this.burstLeftMs > 0) this.burstLeftMs = Math.max(0, this.burstLeftMs - dtMs);
        else if (this.rng.next() < (profile.burstChancePerSec * dtMs) / 1000) this.burstLeftMs = profile.burstMs;
        const tensionFraction = Math.min(1, this.line.tensionN / this.cfg.line.breakingStrengthN);
        // A tensão freia o peixe: em linha frouxa ele arranca; esticada, cede e a linha relaxa.
        const pullMps = (this.burstLeftMs > 0 ? profile.burstPull : profile.basePull) * PULL_TO_MPS;
        const fishSpeedMps = pullMps * (1 - tensionFraction) - LINE_RECOVERY_MPS * tensionFraction;
        const status = this.line.update(dtMs, {
          retrieve: this.reeling ? this.controlsState.reelSpeed : 0,
          fishSpeedMps,
        });
        const drain = SPECIES_BEHAVIOR[this.fish.species.id].staminaDrainPerSec * (dtMs / 1000);
        const delta = tensionFraction < SLACK_TENSION_FRACTION ? drain * 0.5 : -drain * tensionFraction;
        this.stamina = Math.min(1, Math.max(0, this.stamina + delta));
        if (status === 'snapped') {
          this.fish.escape('line_snapped');
          this.finish('escaped', 'line_snapped');
        } else if (this.line.lineOutM <= CATCH_LINE_OUT_M) {
          this.finish('caught', null);
        }
        return;
      }
      default:
        return;
    }
  }

  private handleSignal(signal: FishSignal): void {
    if (signal.type === 'nibble') this.tipKick = { tensionN: NIBBLE_TIP_N, leftMs: TIP_KICK_MS };
    if (signal.type === 'bite' && this.state === 'WAITING') {
      this.tipKick = { tensionN: BITE_TIP_N, leftMs: TIP_KICK_MS };
      this.dispatch({ type: 'BITE', id: `bite-${this.castSerial}` });
    } else if (signal.type === 'escape' && signal.reason === 'lost_interest' && this.state === 'WAITING') {
      this.spawnFish();
    } else if (signal.type === 'escape' && signal.reason === 'missed_hook' && this.state === 'HOOKED') {
      this.finish('escaped', 'missed_hook');
    }
  }

  private spawnFish(): void {
    const species = pickSpecies(this.rng, this.cfg.species);
    const individual = spawnIndividual(this.rng, species);
    const plan = planBite(this.rng, species, this.cfg.bite);
    this.individual = individual;
    this.fish = FishBrain.fromIndividual(species, individual, plan, hookWindowMs(species, this.cfg.bite.hookWindowBaseMs));
  }

  /** Fecha o arremesso uma única vez: impede captura ou fuga dupla. */
  private finish(outcome: Outcome, reason: EscapeReason | null): void {
    if (this.resolved || !this.fish) return;
    const result = this.dispatch({
      type: outcome === 'caught' ? 'FISH_LANDED' : reason === 'line_snapped' ? 'LINE_BROKEN' : 'FISH_ESCAPED',
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
    if (outcome === 'caught' && this.individual && this.lure) {
      const caught: CaughtFish = {
        individual: this.individual,
        lureId: this.lureIdState,
        location: { distanceM: this.lure.distanceM },
        hour: this.cfg.hourOfDay(),
      };
      for (const listener of [...this.catchListeners]) listener(caught);
    }
    for (const listener of [...this.listeners]) listener(entry);
  }

  private clearCast(): void {
    this.flight = null;
    this.lure = null;
    this.fish = null;
    this.individual = null;
    this.tipKick = null;
    this.line = null;
    this.stamina = 1;
    this.burstLeftMs = 0;
    this.reeling = false;
    this.resolved = true;
  }

  private dispatch(event: GameEvent): ActionResult {
    const result = this.machine.dispatch(event);
    if (result.status === 'applied') return OK;
    return fail(result.status === 'rejected' ? result.reason : `evento duplicado: ${event.type}`);
  }
}
