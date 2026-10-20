import type { Rng } from '../utils/rng.ts';
import type { FishIndividual } from '../progression/types.ts';
import { SPECIES, fightPull, hookWindowMs, type FishSpecies, type LureId, type SpeciesId } from './species.ts';

/** Passo fixo da IA do peixe: o resultado não depende de como o tempo chega em advance(). */
export const BEHAVIOR_STEP_MS = 20;

export const BEHAVIOR_STATES = [
  'patrol',
  'curious',
  'approach',
  'nibble',
  'bite',
  'hooked',
  'flee',
  'alert',
  'tired',
] as const;
export type BehaviorState = (typeof BEHAVIOR_STATES)[number];

/** Profundidade do fundo (m) num ponto do lago. O mundo implementa; o peixe só consulta. */
export interface DepthProvider {
  depthAt(x: number, z: number): number;
}

export const WEATHERS = ['clear', 'cloudy', 'rain'] as const;
export type Weather = (typeof WEATHERS)[number];
export const LURE_MOTIONS = ['still', 'slow', 'fast'] as const;
export type LureMotion = (typeof LURE_MOTIONS)[number];

export interface Environment {
  /** Hora do dia em [0, 24). */
  readonly hour: number;
  readonly weather: Weather;
  readonly waterTempC: number;
}

export interface LureState {
  readonly lureId: LureId;
  readonly motion: LureMotion;
  readonly x: number;
  readonly z: number;
  readonly depthM: number;
}

export interface Stimulus {
  readonly env: Environment;
  readonly lure: LureState | null;
  readonly playerDistanceM: number;
  readonly playerMoving: boolean;
  /** Tensão da linha em [0, 1] durante a briga; sem valor, 0.5. */
  readonly lineTension?: number;
}

export interface Point {
  readonly x: number;
  readonly z: number;
}

/** Pesos de comportamento por espécie (multiplicadores sobre a chance de mordida). */
export interface SpeciesBehavior {
  readonly night: number;
  readonly twilight: number;
  readonly weather: Readonly<Record<Weather, number>>;
  readonly motion: Readonly<Record<LureMotion, number>>;
  /** 0..1: quanto o jogador por perto assusta. */
  readonly wariness: number;
  /** Raio (m) em que o peixe percebe a isca. */
  readonly senseRadiusM: number;
  /** Fôlego gasto por segundo de briga em tensão máxima, antes do efeito do tamanho. */
  readonly staminaDrainPerSec: number;
}

export const SPECIES_BEHAVIOR: Readonly<Record<SpeciesId, SpeciesBehavior>> = {
  ...Object.fromEntries(SPECIES.map((s) => [s.id, {
    night: s.family === 'catfish' ? 1.5 : .65, twilight: 1.25,
    weather: { clear: 1, cloudy: 1.1, rain: s.family === 'catfish' ? 1.3 : .85 },
    motion: { still: s.family === 'carp' ? 1.3 : .6, slow: 1, fast: s.family === 'predator' ? 1.4 : .65 },
    wariness: s.difficulty, senseRadiusM: 3 + s.difficulty * 5, staminaDrainPerSec: .2 - s.difficulty * .12,
  }])) as Record<SpeciesId, SpeciesBehavior>,
  lambari: {
    night: 0.5,
    twilight: 1.2,
    weather: { clear: 1, cloudy: 1, rain: 0.8 },
    motion: { still: 1, slow: 1.1, fast: 0.6 },
    wariness: 0.3,
    senseRadiusM: 3,
    staminaDrainPerSec: 0.25,
  },
  tilapia: {
    night: 1.25,
    twilight: 1.1,
    weather: { clear: 1, cloudy: 1.05, rain: 1.2 },
    motion: { still: 1.1, slow: 1, fast: 0.5 },
    wariness: 0.5,
    senseRadiusM: 4,
    staminaDrainPerSec: 0.15,
  },
  tucunare: {
    night: 0.35,
    twilight: 1.3,
    weather: { clear: 1, cloudy: 0.9, rain: 0.65 },
    motion: { still: 0.4, slow: 0.9, fast: 1.4 },
    wariness: 0.8,
    senseRadiusM: 6,
    staminaDrainPerSec: 0.1,
  },
};

export interface BehaviorConfig {
  readonly noticePerSec: number;
  readonly curiousMinMs: number;
  readonly curiousMaxMs: number;
  readonly approachMinMs: number;
  readonly approachMaxMs: number;
  readonly nibbleIntervalMinMs: number;
  readonly nibbleIntervalMaxMs: number;
  readonly maxNibbles: number;
  readonly hookWindowBaseMs: number;
  readonly fleeMs: number;
  readonly alertDecayPerSec: number;
  readonly scareRadiusM: number;
  /** Alerta a partir do qual o peixe para de se interessar (e foge se estiver perto da isca). */
  readonly alertThreshold: number;
  readonly tiredBelow: number;
  readonly recoverAbove: number;
  readonly staminaRecoverPerSec: number;
}

export const DEFAULT_BEHAVIOR_CONFIG: BehaviorConfig = {
  noticePerSec: 1.5,
  curiousMinMs: 400,
  curiousMaxMs: 1200,
  approachMinMs: 800,
  approachMaxMs: 2500,
  nibbleIntervalMinMs: 400,
  nibbleIntervalMaxMs: 1400,
  maxNibbles: 6,
  hookWindowBaseMs: 900,
  fleeMs: 1500,
  alertDecayPerSec: 0.25,
  scareRadiusM: 4,
  alertThreshold: 0.6,
  tiredBelow: 0.25,
  recoverAbove: 0.45,
  staminaRecoverPerSec: 0.04,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function weatherCooling(weather: Weather): number {
  if (weather === 'rain') return 1.5;
  return weather === 'cloudy' ? 0.5 : 0;
}

/** Temperatura simulada da água: senoide diária com pico às 15h, mais fria com nuvens e chuva. */
export function simulatedWaterTempC(hour: number, weather: Weather): number {
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new RangeError(`hora deve estar em [0, 24); recebido: ${String(hour)}`);
  return 26 + 2.5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) - weatherCooling(weather);
}

export function environment(hour: number, weather: Weather): Environment {
  return { hour, weather, waterTempC: simulatedWaterTempC(hour, weather) };
}

export type DayPeriod = 'night' | 'twilight' | 'day';

export function dayPeriod(hour: number): DayPeriod {
  if (hour < 5.5 || hour >= 19) return 'night';
  if (hour < 8 || hour >= 17) return 'twilight';
  return 'day';
}

/** Isca preferida rende mais quanto mais alto na lista da espécie; as outras rendem metade. */
export function lureFactor(species: FishSpecies, lureId: LureId): number {
  const rank = species.preferredLures.indexOf(lureId);
  return rank < 0 ? 0.5 : 1.5 - 0.1 * rank;
}

function temperatureFactor(species: FishSpecies, tempC: number): number {
  const { min, max } = species.preferredTempC;
  const off = tempC < min ? min - tempC : tempC > max ? tempC - max : 0;
  return Math.max(0.3, 1 - 0.08 * off);
}

function depthFactor(species: FishSpecies, lureDepthM: number, bottomM: number): number {
  const d = Math.min(lureDepthM, bottomM);
  return d >= species.depthRangeM.min && d <= species.depthRangeM.max ? 1 : 0.5;
}

function timeFactor(traits: SpeciesBehavior, hour: number): number {
  const period = dayPeriod(hour);
  if (period === 'night') return traits.night;
  return period === 'twilight' ? traits.twilight : 1;
}

/** Chance de uma beliscada virar mordida, com isca, movimento, hora, clima, temperatura, profundidade e alerta. */
export function biteChancePerNibble(species: FishSpecies, stimulus: Stimulus, bottomDepthM: number, alert = 0): number {
  const { lure, env } = stimulus;
  if (!lure) return 0;
  const traits = SPECIES_BEHAVIOR[species.id];
  const p =
    species.biteChance *
    lureFactor(species, lure.lureId) *
    traits.motion[lure.motion] *
    timeFactor(traits, env.hour) *
    traits.weather[env.weather] *
    temperatureFactor(species, env.waterTempC) *
    depthFactor(species, lure.depthM, bottomDepthM) *
    (1 - 0.7 * clamp(alert, 0, 1));
  return clamp(p, 0.01, 0.95);
}

/** Perfil de resistência do momento da briga, por espécie, tamanho e cansaço (fôlego 0..1). */
export interface FightProfile {
  readonly basePull: number;
  readonly burstPull: number;
  readonly burstChancePerSec: number;
  readonly burstMs: number;
}

function weightRatio(species: FishSpecies, weightKg: number): number {
  const span = species.maxWeightKg - species.minWeightKg;
  return span > 0 ? clamp((weightKg - species.minWeightKg) / span, 0, 1) : 1;
}

export function fightProfile(species: FishSpecies, weightKg: number, stamina: number): FightProfile {
  const s = clamp(stamina, 0, 1);
  const fatigue = 0.35 + 0.65 * s;
  return {
    basePull: fightPull(species, weightKg, false) * fatigue,
    burstPull: fightPull(species, weightKg, true) * fatigue,
    burstChancePerSec: species.resistance.burstChancePerSec * s * (0.8 + 0.4 * weightRatio(species, weightKg)),
    burstMs: Math.round(species.resistance.burstMs * (0.5 + 0.5 * s)),
  };
}

export type BehaviorSignal =
  | { readonly type: 'state'; readonly from: BehaviorState; readonly to: BehaviorState; readonly atMs: number }
  | { readonly type: 'nibble'; readonly atMs: number };

const TRANSITIONS: Readonly<Record<BehaviorState, readonly BehaviorState[]>> = {
  patrol: ['curious', 'alert'],
  curious: ['approach', 'patrol', 'flee'],
  approach: ['nibble', 'patrol', 'flee'],
  nibble: ['bite', 'patrol', 'flee'],
  bite: ['hooked', 'flee'],
  hooked: ['tired', 'flee'],
  tired: ['hooked', 'flee'],
  flee: ['alert'],
  alert: ['patrol', 'flee'],
};

export interface CaughtFish {
  readonly speciesId: SpeciesId;
  readonly weightKg: number;
  readonly lengthCm: number;
}

function validateStimulus(s: Stimulus): void {
  simulatedWaterTempC(s.env.hour, s.env.weather);
  if (!Number.isFinite(s.env.waterTempC)) throw new RangeError('waterTempC deve ser finito');
  if (!Number.isFinite(s.playerDistanceM) || s.playerDistanceM < 0) {
    throw new RangeError(`playerDistanceM deve ser >= 0; recebido: ${String(s.playerDistanceM)}`);
  }
  if (s.lineTension !== undefined && !(s.lineTension >= 0 && s.lineTension <= 1)) {
    throw new RangeError(`lineTension deve estar em [0, 1]; recebido: ${String(s.lineTension)}`);
  }
}

/**
 * Máquina de estados leve do peixe. O indivíduo (peso e comprimento) chega pronto do spawn e
 * não muda depois; toda decisão aleatória sai do Rng, um passo fixo de 20 ms por vez.
 */
export class FishBehavior {
  private current: BehaviorState = 'patrol';
  private elapsed = 0;
  private pending = 0;
  private timerMs = 0;
  private nibbles = 0;
  private alertLevel = 0;
  private staminaLevel = 1;
  private burstLeftMs = 0;
  private pullNow = 0;
  private readonly hookWindow: number;
  private readonly bottomM: number;

  constructor(
    readonly species: FishSpecies,
    readonly individual: FishIndividual,
    private readonly rng: Rng,
    depth: DepthProvider,
    readonly home: Point,
    private readonly cfg: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  ) {
    if (individual.speciesId !== species.id) {
      throw new RangeError(`indivíduo de ${individual.speciesId} não serve para a espécie ${species.id}`);
    }
    const bottom = depth.depthAt(home.x, home.z);
    if (!Number.isFinite(bottom) || bottom < 0) throw new RangeError(`profundidade inválida em (${home.x}, ${home.z}): ${String(bottom)}`);
    this.bottomM = bottom;
    this.hookWindow = hookWindowMs(species, cfg.hookWindowBaseMs);
  }

  get state(): BehaviorState {
    return this.current;
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  get alert(): number {
    return this.alertLevel;
  }

  get stamina(): number {
    return this.staminaLevel;
  }

  get weightKg(): number {
    return this.individual.weightKg;
  }

  get lengthCm(): number {
    return this.individual.lengthCm;
  }

  /** Tensão/s que o peixe aplica na linha no último passo (0 fora da briga). */
  get pullPerSec(): number {
    return this.pullNow;
  }

  get isOnLine(): boolean {
    return this.current === 'hooked' || this.current === 'tired';
  }

  advance(dtMs: number, stimulus: Stimulus): BehaviorSignal[] {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    validateStimulus(stimulus);
    this.pending += dtMs;
    const out: BehaviorSignal[] = [];
    while (this.pending >= BEHAVIOR_STEP_MS) {
      this.pending -= BEHAVIOR_STEP_MS;
      this.step(stimulus, out);
    }
    return out;
  }

  /** Fisga: só vale na mordida, dentro da janela. */
  hook(): boolean {
    if (this.current !== 'bite') return false;
    this.go('hooked', []);
    return true;
  }

  /** Linha arrebentou ou o peixe se soltou: foge com o alerta no máximo. */
  breakFree(): void {
    if (!this.isOnLine) return;
    this.alertLevel = 1;
    this.timerMs = this.cfg.fleeMs;
    this.pullNow = 0;
    this.go('flee', []);
  }

  /** O peixe embarcado: peso e comprimento são os do spawn. */
  catchResult(): CaughtFish {
    if (!this.isOnLine) throw new Error(`o peixe não está fisgado (estado: ${this.current})`);
    const { speciesId, weightKg, lengthCm } = this.individual;
    return { speciesId, weightKg, lengthCm };
  }

  private step(s: Stimulus, out: BehaviorSignal[]): void {
    this.elapsed += BEHAVIOR_STEP_MS;
    const dt = BEHAVIOR_STEP_MS / 1000;
    const { cfg } = this;
    if (!this.isOnLine) this.perceivePlayer(s, dt);
    const scared = this.alertLevel >= cfg.alertThreshold;

    switch (this.current) {
      case 'patrol': {
        if (scared) return this.go('alert', out);
        const appeal = this.appeal(s);
        if (appeal > 0 && this.rng.next() < appeal * cfg.noticePerSec * dt) {
          this.timerMs = this.rng.range(cfg.curiousMinMs, cfg.curiousMaxMs);
          this.go('curious', out);
        }
        return;
      }
      case 'curious': {
        if (scared) return this.flee(out);
        if (!s.lure) return this.go('patrol', out);
        if ((this.timerMs -= BEHAVIOR_STEP_MS) > 0) return;
        if (this.rng.next() < 0.4 + 0.6 * this.appeal(s)) {
          this.timerMs = this.rng.range(cfg.approachMinMs, cfg.approachMaxMs);
          this.go('approach', out);
        } else {
          this.go('patrol', out);
        }
        return;
      }
      case 'approach': {
        if (scared) return this.flee(out);
        if (!s.lure) return this.go('patrol', out);
        if ((this.timerMs -= BEHAVIOR_STEP_MS) > 0) return;
        this.nibbles = 1;
        this.timerMs = this.rng.range(cfg.nibbleIntervalMinMs, cfg.nibbleIntervalMaxMs);
        this.go('nibble', out);
        out.push({ type: 'nibble', atMs: this.elapsed });
        return;
      }
      case 'nibble': {
        if (scared) return this.flee(out);
        if (!s.lure) return this.go('patrol', out);
        if ((this.timerMs -= BEHAVIOR_STEP_MS) > 0) return;
        if (this.rng.next() < biteChancePerNibble(this.species, s, this.bottomM, this.alertLevel)) {
          this.timerMs = this.hookWindow;
          return this.go('bite', out);
        }
        if (this.nibbles >= cfg.maxNibbles) {
          this.alertLevel = Math.min(1, this.alertLevel + 0.2);
          return this.go('patrol', out);
        }
        this.nibbles++;
        this.timerMs = this.rng.range(cfg.nibbleIntervalMinMs, cfg.nibbleIntervalMaxMs);
        out.push({ type: 'nibble', atMs: this.elapsed });
        return;
      }
      case 'bite': {
        if ((this.timerMs -= BEHAVIOR_STEP_MS) >= 0) return;
        this.alertLevel = Math.min(1, this.alertLevel + 0.5);
        return this.flee(out);
      }
      case 'hooked':
      case 'tired':
        return this.fight(s, dt, out);
      case 'flee': {
        if ((this.timerMs -= BEHAVIOR_STEP_MS) > 0) return;
        this.alertLevel = Math.max(this.alertLevel, cfg.alertThreshold);
        return this.go('alert', out);
      }
      case 'alert': {
        if (this.alertLevel >= 1) return this.flee(out);
        if (this.alertLevel < 0.2) this.go('patrol', out);
        return;
      }
    }
  }

  private perceivePlayer(s: Stimulus, dt: number): void {
    const { cfg } = this;
    if (s.playerDistanceM < cfg.scareRadiusM) {
      const closeness = 1 - s.playerDistanceM / cfg.scareRadiusM;
      const rate = SPECIES_BEHAVIOR[this.species.id].wariness * closeness * (s.playerMoving ? 2 : 0.5);
      this.alertLevel = Math.min(1, this.alertLevel + rate * dt);
    } else {
      this.alertLevel = Math.max(0, this.alertLevel - cfg.alertDecayPerSec * dt);
    }
  }

  /** Interesse pela isca: zero fora do raio de percepção; senão a chance de mordida do momento. */
  private appeal(s: Stimulus): number {
    if (!s.lure) return 0;
    const dist = Math.hypot(s.lure.x - this.home.x, s.lure.z - this.home.z);
    if (dist > SPECIES_BEHAVIOR[this.species.id].senseRadiusM) return 0;
    return biteChancePerNibble(this.species, s, this.bottomM, this.alertLevel);
  }

  private fight(s: Stimulus, dt: number, out: BehaviorSignal[]): void {
    const { cfg, species } = this;
    const tension = s.lineTension ?? 0.5;
    if (this.current === 'hooked') {
      const sizeDrain = 1 / (0.6 + 0.8 * weightRatio(species, this.weightKg));
      const drain = SPECIES_BEHAVIOR[species.id].staminaDrainPerSec * (0.3 + 0.7 * tension) * sizeDrain;
      this.staminaLevel = Math.max(0, this.staminaLevel - drain * dt);
    } else {
      this.staminaLevel = Math.min(1, this.staminaLevel + cfg.staminaRecoverPerSec * (1 - tension) * dt);
    }
    const profile = fightProfile(species, this.weightKg, this.staminaLevel);
    let bursting = this.burstLeftMs > 0;
    if (bursting) {
      this.burstLeftMs = Math.max(0, this.burstLeftMs - BEHAVIOR_STEP_MS);
    } else if (this.current === 'hooked' && this.rng.next() < profile.burstChancePerSec * dt) {
      this.burstLeftMs = profile.burstMs;
      bursting = true;
    }
    this.pullNow = bursting ? profile.burstPull : profile.basePull;
    if (this.current === 'hooked' && this.staminaLevel <= cfg.tiredBelow) this.go('tired', out);
    else if (this.current === 'tired' && this.staminaLevel >= cfg.recoverAbove) this.go('hooked', out);
  }

  private flee(out: BehaviorSignal[]): void {
    this.timerMs = this.cfg.fleeMs;
    this.go('flee', out);
  }

  private go(next: BehaviorState, out: BehaviorSignal[]): void {
    if (!TRANSITIONS[this.current].includes(next)) {
      throw new Error(`transição de peixe inválida: ${this.current} -> ${next}`);
    }
    out.push({ type: 'state', from: this.current, to: next, atMs: this.elapsed });
    this.current = next;
  }
}
