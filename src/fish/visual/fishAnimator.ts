/**
 * Animação procedural do peixe sobre os ossos de FishModel: onda senoidal na coluna (amplitude e
 * frequência crescem com a velocidade), cauda com atraso de fase, nadadeiras peitorais com ritmo
 * próprio cada uma, guelras e boca no ritmo da respiração, curvatura do corpo nas mudanças de
 * direção e ruído determinístico por semente para o ciclo não se repetir. Cada estado é um clipe de
 * parâmetros; a troca de estado mistura os parâmetros com suavização. Tudo avança em passo fixo,
 * sem alocar memória por passo.
 */
import { Mesh, type Object3D } from 'three';
import { Rng } from '../../utils/rng.ts';
import { JAW_BONE, OPERCLE_LEFT_BONE, OPERCLE_RIGHT_BONE, type FishModel } from './fishModel.ts';

export const FISH_ANIM_STATES = [
  'slowSwim',
  'fastSwim',
  'approach',
  'bite',
  'hookReaction',
  'flee',
  'resist',
  'outOfWater',
  'releaseSwim',
] as const;
export type FishAnimState = (typeof FISH_ANIM_STATES)[number];

/** Parâmetros de um clipe; todos são misturados linearmente entre estados. Ângulos em radianos. */
export interface FishClipParams {
  /** Esforço de nado normalizado (0 parado, 1 sprint): dá a amplitude e a frequência da onda. */
  readonly speed: number;
  readonly freqBoostHz: number;
  readonly ampBoost: number;
  /** Atraso de fase extra no osso da cauda. */
  readonly tailLag: number;
  /** Curvatura fixa do corpo (lado definido por bendSide). */
  readonly bendStatic: number;
  /** Curvatura oscilante (puxões laterais). */
  readonly bendOsc: number;
  readonly bendOscHz: number;
  readonly pectoral: number;
  readonly pectoralHz: number;
  readonly breathHz: number;
  /** Abertura máxima dos opérculos. */
  readonly gill: number;
  readonly jawOpen: number;
  /** Abertura extra da boca em pulsos (mordida, boca ofegante fora d'água). */
  readonly jawPulse: number;
  readonly jawPulseHz: number;
  /** Irregularidade: modula amplitude, frequência e curvatura com ruído. */
  readonly noise: number;
  /** Rolagem do corpo (debate de lado fora d'água). */
  readonly roll: number;
}

export interface FishClip {
  readonly params: FishClipParams;
  /** Duração da mistura ao entrar no estado, em segundos. */
  readonly blendInS: number;
  /** Clipes de ação única: ao fim de durationS o animador passa sozinho para `next`. */
  readonly durationS?: number;
  readonly next?: FishAnimState;
}

const BASE: FishClipParams = {
  speed: 0.25,
  freqBoostHz: 0,
  ampBoost: 0,
  tailLag: 0.5,
  bendStatic: 0,
  bendOsc: 0,
  bendOscHz: 0,
  pectoral: 0.25,
  pectoralHz: 0.9,
  breathHz: 0.8,
  gill: 0.25,
  jawOpen: 0.04,
  jawPulse: 0,
  jawPulseHz: 0,
  noise: 0.2,
  roll: 0,
};

export const FISH_CLIPS: Readonly<Record<FishAnimState, FishClip>> = {
  slowSwim: { params: BASE, blendInS: 0.6 },
  fastSwim: {
    params: { ...BASE, speed: 0.85, tailLag: 0.7, pectoral: 0.08, pectoralHz: 1.5, breathHz: 1.6, gill: 0.4, noise: 0.3 },
    blendInS: 0.4,
  },
  // Chega devagar, freando e corrigindo com as peitorais, boca entreaberta.
  approach: {
    params: { ...BASE, speed: 0.35, pectoral: 0.45, pectoralHz: 1.8, breathHz: 1.2, gill: 0.35, jawOpen: 0.08, noise: 0.25 },
    blendInS: 0.5,
  },
  bite: {
    params: { ...BASE, speed: 0.5, freqBoostHz: 0.5, pectoral: 0.3, pectoralHz: 2, breathHz: 1.4, gill: 0.6, jawOpen: 0.15, jawPulse: 0.45, jawPulseHz: 3 },
    blendInS: 0.12,
    durationS: 0.5,
    next: 'approach',
  },
  // Sacudida em C para um lado, ao sentir o anzol.
  hookReaction: {
    params: {
      ...BASE,
      speed: 1,
      freqBoostHz: 3,
      ampBoost: 0.25,
      tailLag: 0.8,
      bendStatic: 0.5,
      bendOsc: 0.2,
      bendOscHz: 2.5,
      pectoral: 0.5,
      pectoralHz: 3,
      breathHz: 2,
      gill: 0.7,
      jawOpen: 0.2,
      jawPulse: 0.2,
      jawPulseHz: 4,
      noise: 0.6,
    },
    blendInS: 0.08,
    durationS: 0.7,
    next: 'flee',
  },
  flee: {
    params: { ...BASE, speed: 1, freqBoostHz: 1.5, ampBoost: 0.1, tailLag: 0.8, pectoral: 0.05, pectoralHz: 1.5, breathHz: 2.2, gill: 0.6, noise: 0.4 },
    blendInS: 0.25,
  },
  // Cabo de guerra: puxões laterais lentos, peitorais abertas, irregular.
  resist: {
    params: {
      ...BASE,
      speed: 0.7,
      freqBoostHz: 0.8,
      ampBoost: 0.15,
      tailLag: 0.7,
      bendStatic: 0.15,
      bendOsc: 0.35,
      bendOscHz: 0.6,
      pectoral: 0.5,
      pectoralHz: 2.2,
      breathHz: 2,
      gill: 0.6,
      jawOpen: 0.1,
      noise: 0.7,
    },
    blendInS: 0.35,
  },
  outOfWater: {
    params: {
      ...BASE,
      speed: 0.6,
      freqBoostHz: 2.5,
      ampBoost: 0.45,
      tailLag: 1.2,
      pectoral: 0.6,
      pectoralHz: 3,
      breathHz: 1.8,
      gill: 0.9,
      jawOpen: 0.2,
      jawPulse: 0.35,
      jawPulseHz: 1.8,
      noise: 1,
      roll: 0.5,
    },
    blendInS: 0.2,
  },
  // Solto na água: arranca nadando, ainda ofegante, e volta ao nado lento.
  releaseSwim: {
    params: { ...BASE, speed: 0.55, ampBoost: 0.05, tailLag: 0.6, pectoral: 0.2, pectoralHz: 1.4, breathHz: 1.8, gill: 0.5, noise: 0.3 },
    blendInS: 0.3,
    durationS: 3,
    next: 'slowSwim',
  },
};

type MutableParams = { -readonly [K in keyof FishClipParams]: number };
const PARAM_KEYS = Object.keys(BASE) as readonly (keyof FishClipParams)[];

/** Ossos e peças que o animador mexe. As rotações de repouso são lidas na criação do animador. */
export interface FishRig {
  /** Coluna do focinho ao pedúnculo, em cadeia (cada osso filho do anterior). */
  readonly spine: readonly Object3D[];
  readonly jaw: Object3D;
  readonly opercleL: Object3D;
  readonly opercleR: Object3D;
  readonly pectoralL: Object3D | null;
  readonly pectoralR: Object3D | null;
}

/** Monta o rig a partir de um FishModel: ossos pelo nome e peitorais como as malhas presas à cabeça. */
export function rigFromFishModel(model: FishModel): FishRig {
  const bones = model.skeleton.bones;
  const spine = bones
    .filter((b) => /^spine_\d+$/.test(b.name))
    .sort((a, b) => Number(a.name.slice(6)) - Number(b.name.slice(6)));
  const byName = (name: string): Object3D => {
    const bone = bones.find((b) => b.name === name);
    if (!bone) throw new Error(`FishModel sem o osso "${name}"; o rig do animador depende dele`);
    return bone;
  };
  const head = spine[0];
  if (!head || spine.length < 2) throw new Error('FishModel precisa de ao menos 2 ossos na coluna para animar');
  const fins = head.children.filter((c): c is Mesh => c instanceof Mesh);
  return {
    spine,
    jaw: byName(JAW_BONE),
    opercleL: byName(OPERCLE_LEFT_BONE),
    opercleR: byName(OPERCLE_RIGHT_BONE),
    pectoralL: fins.find((m) => m.position.z < 0) ?? null,
    pectoralR: fins.find((m) => m.position.z > 0) ?? null,
  };
}

export interface FishAnimatorOptions {
  /** Semente do indivíduo: fase inicial, ritmo próprio e ruído. */
  readonly seed: number;
  /** Passo fixo, em ms (o mesmo da sessão de pesca, 20 ms). */
  readonly fixedDtMs?: number;
  readonly maxStepsPerUpdate?: number;
  readonly initialState?: FishAnimState;
}

export const FISH_ANIM_STEP_MS = 20;
const NOISE_SIZE = 256;
const WAVE_LAG = 0.9;
const TWO_PI = Math.PI * 2;
const TURN_SMOOTH_S = 0.15;
const MAX_TURN_BEND = 0.6;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class FishAnimator {
  private readonly rig: FishRig;
  private readonly stepS: number;
  private readonly maxSteps: number;
  private readonly noiseTable: Float32Array;
  private readonly noiseOffset: Float32Array;
  private readonly rest: Float32Array;
  private readonly rateJitter: number;
  private readonly from: MutableParams = { ...BASE };
  private readonly cur: MutableParams = { ...BASE };
  private target: FishClipParams = BASE;
  private current: FishAnimState;
  private blendT = 0;
  private blendDur = 0;
  private clipT = 0;
  private accumulatorMs = 0;
  private timeS = 0;
  private swimPhase: number;
  private bendPhase: number;
  private breathPhase: number;
  private jawPhase = 0;
  private pecPhaseL: number;
  private pecPhaseR: number;
  private rollPhase: number;
  private bendSide: number;
  private speedScale = 1;
  private turnTarget = 0;
  private turnBend = 0;

  constructor(rig: FishRig, options: FishAnimatorOptions) {
    if (rig.spine.length < 2) throw new RangeError('o rig precisa de ao menos 2 ossos na coluna');
    const dtMs = options.fixedDtMs ?? FISH_ANIM_STEP_MS;
    if (!(Number.isFinite(dtMs) && dtMs > 0)) throw new RangeError(`fixedDtMs deve ser > 0; recebido: ${String(dtMs)}`);
    const maxSteps = options.maxStepsPerUpdate ?? 16;
    if (!(Number.isInteger(maxSteps) && maxSteps > 0)) throw new RangeError('maxStepsPerUpdate deve ser inteiro > 0');
    this.rig = rig;
    this.stepS = dtMs / 1000;
    this.maxSteps = maxSteps;

    const rng = new Rng(options.seed >>> 0);
    this.noiseTable = new Float32Array(NOISE_SIZE);
    for (let i = 0; i < NOISE_SIZE; i++) this.noiseTable[i] = rng.range(-1, 1);
    // Um deslocamento por canal: amplitude, frequência, curvatura, peitoral E, peitoral D.
    this.noiseOffset = new Float32Array(5);
    for (let i = 0; i < 5; i++) this.noiseOffset[i] = rng.range(0, NOISE_SIZE);
    this.rateJitter = rng.range(0.92, 1.08);
    this.swimPhase = rng.range(0, TWO_PI);
    this.bendPhase = rng.range(0, TWO_PI);
    this.breathPhase = rng.range(0, TWO_PI);
    this.pecPhaseL = rng.range(0, TWO_PI);
    this.pecPhaseR = rng.range(0, TWO_PI);
    this.rollPhase = rng.range(0, TWO_PI);
    this.bendSide = rng.next() < 0.5 ? -1 : 1;

    // Rotações de repouso (x, y, z) de cada peça, para o animador somar por cima delas.
    const parts = this.parts();
    this.rest = new Float32Array(parts.length * 3);
    parts.forEach((p, i) => {
      if (!p) return;
      this.rest[i * 3] = p.rotation.x;
      this.rest[i * 3 + 1] = p.rotation.y;
      this.rest[i * 3 + 2] = p.rotation.z;
    });

    this.current = options.initialState ?? 'slowSwim';
    this.target = FISH_CLIPS[this.current].params;
    Object.assign(this.cur, this.target);
    Object.assign(this.from, this.target);
    this.apply();
  }

  get state(): FishAnimState {
    return this.current;
  }

  /** Progresso da mistura para o estado atual, de 0 a 1. */
  get blendWeight(): number {
    return this.blendDur <= 0 ? 1 : Math.min(1, this.blendT / this.blendDur);
  }

  /** Tempo simulado acumulado, em segundos. */
  get elapsedS(): number {
    return this.timeS;
  }

  /** Parâmetros efetivos neste passo (mistura entre o estado anterior e o atual). */
  get params(): Readonly<FishClipParams> {
    return this.cur;
  }

  /** Troca de estado com mistura suave a partir da pose atual. Repetir o estado atual não reinicia o clipe. */
  setState(next: FishAnimState): void {
    const clip = FISH_CLIPS[next];
    if (!clip) throw new RangeError(`estado de animação desconhecido: ${String(next)}`);
    if (next === this.current) return;
    Object.assign(this.from, this.cur);
    this.target = clip.params;
    this.current = next;
    this.blendT = 0;
    this.blendDur = clip.blendInS;
    this.clipT = 0;
    if (next === 'hookReaction') {
      // Cada fisgada sacode para o lado oposto; a curva herdada troca de sinal junto para não saltar.
      this.bendSide = -this.bendSide;
      this.from.bendStatic = -this.from.bendStatic;
      this.from.bendOsc = -this.from.bendOsc;
    }
  }

  /** Escala a velocidade do clipe pela velocidade real da simulação (1 = a do clipe). */
  setSpeedScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) throw new RangeError(`speedScale inválido: ${String(scale)}`);
    this.speedScale = Math.min(2, scale);
  }

  /** Taxa de giro do rumo em rad/s (positivo gira em +y); o corpo curva para dentro da curva. */
  setTurnRate(radPerS: number): void {
    if (!Number.isFinite(radPerS)) throw new RangeError(`turnRate inválido: ${String(radPerS)}`);
    this.turnTarget = Math.max(-MAX_TURN_BEND, Math.min(MAX_TURN_BEND, radPerS * 0.25));
  }

  /** Avança o tempo de frame em passos fixos e aplica a pose. */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    const stepMs = this.stepS * 1000;
    this.accumulatorMs += dtMs;
    let steps = 0;
    while (this.accumulatorMs >= stepMs && steps < this.maxSteps) {
      this.step(this.stepS);
      this.accumulatorMs -= stepMs;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulatorMs = 0;
    if (steps > 0) this.apply();
  }

  private parts(): readonly (Object3D | null)[] {
    const r = this.rig;
    return [...r.spine, r.jaw, r.opercleL, r.opercleR, r.pectoralL, r.pectoralR];
  }

  /** Ruído de valor 1D suave em [-1, 1]. */
  private noise(channel: number, t: number): number {
    const x = t + (this.noiseOffset[channel] ?? 0);
    const i = Math.floor(x);
    const f = x - i;
    const a = this.noiseTable[((i % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE] ?? 0;
    const b = this.noiseTable[(((i + 1) % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE] ?? 0;
    return a + (b - a) * smoothstep(f);
  }

  private step(dt: number): void {
    this.blendT += dt;
    const s = smoothstep(this.blendWeight);
    if (s >= 1) Object.assign(this.cur, this.target);
    else for (const k of PARAM_KEYS) this.cur[k] = this.from[k] + (this.target[k] - this.from[k]) * s;

    this.timeS += dt;
    const p = this.cur;
    const t = this.timeS * 0.7;
    const speed = Math.min(1.5, p.speed * this.speedScale);
    const freqHz = (0.6 + 3.4 * speed + p.freqBoostHz) * this.rateJitter * (1 + 0.15 * p.noise * this.noise(1, t));
    this.swimPhase = (this.swimPhase + TWO_PI * freqHz * dt) % TWO_PI;
    this.bendPhase = (this.bendPhase + TWO_PI * p.bendOscHz * dt) % TWO_PI;
    this.breathPhase = (this.breathPhase + TWO_PI * p.breathHz * this.rateJitter * dt) % TWO_PI;
    this.jawPhase = (this.jawPhase + TWO_PI * p.jawPulseHz * dt) % TWO_PI;
    this.pecPhaseL = (this.pecPhaseL + TWO_PI * p.pectoralHz * (1 + 0.2 * this.noise(3, t)) * dt) % TWO_PI;
    this.pecPhaseR = (this.pecPhaseR + TWO_PI * p.pectoralHz * (1 + 0.2 * this.noise(4, t)) * dt) % TWO_PI;
    this.rollPhase = (this.rollPhase + TWO_PI * freqHz * 0.5 * dt) % TWO_PI;
    this.turnBend += (this.turnTarget - this.turnBend) * (1 - Math.exp(-dt / TURN_SMOOTH_S));

    const clip = FISH_CLIPS[this.current];
    this.clipT += dt;
    if (clip.durationS !== undefined && clip.next && this.clipT >= clip.durationS) this.setState(clip.next);
  }

  private apply(): void {
    const p = this.cur;
    const r = this.rig;
    const rest = this.rest;
    const t = this.timeS * 0.7;
    const n = r.spine.length;
    const speed = Math.min(1.5, p.speed * this.speedScale);
    const amp = (0.05 + 0.13 * speed + p.ampBoost) * (1 + 0.35 * p.noise * this.noise(0, t));
    const bend =
      this.bendSide * (p.bendStatic + p.bendOsc * Math.sin(this.bendPhase)) + this.turnBend + 0.08 * p.noise * this.noise(2, t);
    const bendPerBone = bend / (n - 1);

    const head = r.spine[0] as Object3D;
    head.rotation.x = (rest[0] ?? 0) + p.roll * Math.sin(this.rollPhase);
    head.rotation.y = (rest[1] ?? 0) + 0.15 * amp * Math.sin(this.swimPhase + 0.6);
    for (let i = 1; i < n; i++) {
      const bone = r.spine[i] as Object3D;
      const u = i / (n - 1);
      const lag = i * WAVE_LAG + (i === n - 1 ? p.tailLag : 0);
      bone.rotation.y = (rest[i * 3 + 1] ?? 0) + amp * (0.35 + 0.65 * u) * Math.sin(this.swimPhase - lag) + bendPerBone;
    }

    const breath = 0.5 + 0.5 * Math.sin(this.breathPhase);
    const flare = p.gill * (0.5 + 0.5 * Math.sin(this.breathPhase - 0.6));
    const jawI = n * 3;
    r.jaw.rotation.z = (rest[jawI + 2] ?? 0) - (p.jawOpen + 0.1 * breath + p.jawPulse * Math.max(0, Math.sin(this.jawPhase)));
    r.opercleL.rotation.y = (rest[jawI + 4] ?? 0) - flare;
    r.opercleR.rotation.y = (rest[jawI + 7] ?? 0) + flare;
    if (r.pectoralL) r.pectoralL.rotation.y = (rest[jawI + 10] ?? 0) - p.pectoral * Math.sin(this.pecPhaseL);
    if (r.pectoralR) r.pectoralR.rotation.y = (rest[jawI + 13] ?? 0) + p.pectoral * Math.sin(this.pecPhaseR);
  }
}
