import { Rng } from '../utils/rng.ts';

/**
 * Sons procedurais do jogo: cada um é renderizado em código num Float32Array, sem arquivo externo.
 * Mesmo id, sampleRate e seed geram exatamente as mesmas amostras.
 */

export const LOOP_IDS = ['forest', 'water', 'birds', 'menuMusic'] as const;
export type LoopId = (typeof LOOP_IDS)[number];

export const SFX_IDS = ['cast', 'splash', 'line', 'bite', 'catch', 'fail'] as const;
export type SfxId = (typeof SFX_IDS)[number];

export type SoundId = LoopId | SfxId;
export const SOUND_IDS: readonly SoundId[] = [...LOOP_IDS, ...SFX_IDS];

export function isLoopId(value: unknown): value is LoopId {
  return typeof value === 'string' && (LOOP_IDS as readonly string[]).includes(value);
}

export function isSfxId(value: unknown): value is SfxId {
  return typeof value === 'string' && (SFX_IDS as readonly string[]).includes(value);
}

/** Preenche `out` inteiro com o som; `out.length` define a duração. */
export type SoundGenerator = (out: Float32Array, sampleRate: number, rng: Rng) => void;

export interface SoundSpec {
  readonly seconds: number;
  readonly loop: boolean;
  /** Crossfade da emenda do loop, em segundos; 0 quando o gerador já emenda sozinho. */
  readonly seamSeconds: number;
  /** Nível da voz antes do ganho de música/efeitos. */
  readonly gain: number;
  readonly generate: SoundGenerator;
}

export const MIN_SAMPLE_RATE = 3000;
const TAU = Math.PI * 2;

function onePoleCoef(cutoffHz: number, sampleRate: number): number {
  return 1 - Math.exp((-TAU * cutoffHz) / sampleRate);
}

function noise(rng: Rng): number {
  return rng.next() * 2 - 1;
}

function add(out: Float32Array, index: number, value: number): void {
  if (index >= 0 && index < out.length) out[index] = (out[index] ?? 0) + value;
}

function normalize(out: Float32Array, peak: number): void {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max === 0) return;
  const k = peak / max;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * k;
}

/** Rampa curta no começo e no fim para o efeito não estalar. */
function fadeEdges(out: Float32Array, sampleRate: number, inSeconds: number, outSeconds: number): void {
  const fadeIn = Math.min(out.length, Math.round(inSeconds * sampleRate));
  for (let i = 0; i < fadeIn; i++) out[i] = (out[i] ?? 0) * (i / fadeIn);
  const fadeOut = Math.min(out.length, Math.round(outSeconds * sampleRate));
  for (let i = 0; i < fadeOut; i++) {
    const idx = out.length - 1 - i;
    out[idx] = (out[idx] ?? 0) * (i / fadeOut);
  }
}

/** Filtro de estado variável (Chamberlin); devolve a saída passa-faixa. */
class BandPass {
  private low = 0;
  private band = 0;

  process(input: number, cutoffHz: number, damping: number, sampleRate: number): number {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, sampleRate / 8)) / sampleRate);
    this.low += f * this.band;
    const high = input - this.low - damping * this.band;
    this.band += f * high;
    return this.band;
  }
}

/** Gota d'água: seno curto com glissando para cima e decaimento rápido. */
function addDroplet(out: Float32Array, sampleRate: number, start: number, freq: number, amp: number): void {
  const len = Math.floor(0.09 * sampleRate);
  for (let k = 0; k < len; k++) {
    const tau = k / sampleRate;
    add(out, start + k, amp * Math.sin(TAU * freq * tau * (1 + 4 * tau)) * Math.exp(-tau / 0.025));
  }
}

/** Tom com glissando linear, ataque de 10 ms e decaimento até o fim. */
function addTone(
  out: Float32Array,
  sampleRate: number,
  startSeconds: number,
  durationSeconds: number,
  f0: number,
  f1: number,
  amp: number,
): void {
  const start = Math.floor(startSeconds * sampleRate);
  const len = Math.floor(durationSeconds * sampleRate);
  let phase = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len;
    const tau = k / sampleRate;
    const freq = f0 + (f1 - f0) * u;
    phase += (TAU * freq) / sampleRate;
    const env = Math.min(1, tau / 0.01) * (1 - u) ** 2;
    add(out, start + k, amp * env * (Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase)));
  }
}

/** Ambiente de floresta: vento (ruído em passa-baixa duplo com rajadas) e folhas (ruído agudo). */
export const generateForest: SoundGenerator = (out, sampleRate, rng) => {
  const aWind = onePoleCoef(350, sampleRate);
  const aLeaves = onePoleCoef(2500, sampleRate);
  const phase = rng.range(0, TAU);
  let wind = 0;
  let wind2 = 0;
  let leaves = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const n = noise(rng);
    wind += aWind * (n - wind);
    wind2 += aWind * (wind - wind2);
    leaves += aLeaves * (n - leaves);
    const gust = 0.55 + 0.3 * Math.sin((TAU * t) / 7.1 + phase) + 0.15 * Math.sin((TAU * t) / 2.9 + phase * 1.7);
    out[i] = wind2 * 6 * gust + (n - leaves) * 0.25 * gust * gust;
  }
  normalize(out, 0.8);
};

/** Água na margem: marola em ruído filtrado e gotas esparsas. */
export const generateWater: SoundGenerator = (out, sampleRate, rng) => {
  const aLow = onePoleCoef(500, sampleRate);
  const aHigh = onePoleCoef(1800, sampleRate);
  let low = 0;
  let high = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const n = noise(rng);
    low += aLow * (n - low);
    high += aHigh * (n - high);
    const lap = Math.max(0, Math.sin(TAU * t * 0.45)) ** 2 * (0.6 + 0.4 * Math.sin(TAU * t * 0.17));
    out[i] = low * 4 * (0.35 + lap) + (high - low) * 1.5 * lap;
  }
  const drops = Math.max(1, Math.round((out.length / sampleRate) * 1.2));
  for (let d = 0; d < drops; d++) {
    addDroplet(out, sampleRate, rng.int(0, out.length - 1), rng.range(700, 1600), rng.range(0.05, 0.15));
  }
  normalize(out, 0.8);
};

/** Pássaros: cantos de 2 a 5 notas com glissando e vibrato, espaçados ao acaso. */
export const generateBirds: SoundGenerator = (out, sampleRate, rng) => {
  const seconds = out.length / sampleRate;
  const calls = Math.max(1, Math.round(seconds * 0.7));
  for (let c = 0; c < calls; c++) {
    let t0 = rng.range(0, Math.max(0, seconds - 1.2));
    const notes = rng.int(2, 5);
    const base = rng.range(2200, 4200);
    const amp = rng.range(0.3, 1);
    for (let n = 0; n < notes; n++) {
      const dur = rng.range(0.05, 0.12);
      const f0 = base * rng.range(0.9, 1.25);
      const f1 = base * rng.range(0.7, 1.4);
      const start = Math.floor(t0 * sampleRate);
      const len = Math.max(1, Math.floor(dur * sampleRate));
      let phase = 0;
      for (let k = 0; k < len; k++) {
        const u = k / len;
        const freq = f0 + (f1 - f0) * u + 120 * Math.sin((TAU * 35 * k) / sampleRate);
        phase += (TAU * freq) / sampleRate;
        add(out, start + k, amp * Math.sin(phase) * Math.sin(Math.PI * u) ** 2);
      }
      t0 += dur + rng.range(0.03, 0.09);
    }
  }
  normalize(out, 0.6);
};

const MENU_CHORDS: readonly (readonly number[])[] = [
  [130.81, 164.81, 196.0, 246.94], // Cmaj7
  [110.0, 130.81, 164.81, 196.0], // Am7
  [87.31, 110.0, 130.81, 164.81], // Fmaj7
  [98.0, 123.47, 146.83, 164.81], // G6
];

/**
 * Música de menu: pad com quatro acordes em senos levemente desafinados.
 * A cauda do último acorde dá a volta para o início, então o loop emenda sem crossfade.
 */
export const generateMenuPad: SoundGenerator = (out, sampleRate, rng) => {
  const chordLen = Math.floor(out.length / MENU_CHORDS.length);
  const overlap = Math.min(chordLen, Math.floor(1.5 * sampleRate));
  const shimmer = rng.range(0.08, 0.12);
  MENU_CHORDS.forEach((notes, c) => {
    const start = c * chordLen;
    const span = chordLen + overlap;
    for (let k = 0; k < span; k++) {
      const t = (start + k) / sampleRate;
      const ramp = k < overlap ? k / overlap : k >= chordLen ? (span - k) / overlap : 1;
      const env = ramp * ramp * (3 - 2 * ramp);
      let s = 0;
      for (const f of notes) {
        s += Math.sin(TAU * f * 0.997 * t) + Math.sin(TAU * f * 1.003 * t) + 0.25 * Math.sin(TAU * 2 * f * t);
      }
      const tremolo = 1 + 0.15 * Math.sin(TAU * shimmer * t);
      add(out, (start + k) % out.length, s * env * tremolo);
    }
  });
  normalize(out, 0.5);
};

/** Arremesso: zunido de ruído em passa-faixa que sobe e desce. */
export const generateCast: SoundGenerator = (out, sampleRate, rng) => {
  const filter = new BandPass();
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    const cutoff = 300 + 2600 * Math.sin(Math.PI * Math.min(1, u * 1.3));
    out[i] = filter.process(noise(rng), cutoff, 0.6, sampleRate) * Math.sin(Math.PI * u) ** 1.5;
  }
  normalize(out, 0.7);
  fadeEdges(out, sampleRate, 0.003, 0.01);
};

/** Impacto da boia: baque grave, chiado de água e respingos. */
export const generateSplash: SoundGenerator = (out, sampleRate, rng) => {
  const a = onePoleCoef(2200, sampleRate);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    phase += (TAU * (55 + 90 * Math.exp(-t / 0.04))) / sampleRate;
    lp += a * (noise(rng) - lp);
    out[i] = Math.sin(phase) * Math.exp(-t / 0.09) + lp * 3 * Math.exp(-t / 0.12);
  }
  for (let d = 0; d < 6; d++) {
    const start = Math.floor(rng.range(0.05, 0.45) * sampleRate);
    addDroplet(out, sampleRate, start, rng.range(800, 2000), rng.range(0.1, 0.3));
  }
  normalize(out, 0.9);
  fadeEdges(out, sampleRate, 0.002, 0.02);
};

/** Linha: catraca do molinete (cliques regulares) e chiado da linha correndo. */
export const generateLine: SoundGenerator = (out, sampleRate, rng) => {
  const interval = Math.max(1, Math.floor(sampleRate / 28));
  const clickLen = Math.floor(0.012 * sampleRate);
  for (let s = 0; s < out.length; s += interval) {
    const amp = rng.range(0.6, 1);
    for (let k = 0; k < clickLen; k++) {
      const tau = k / sampleRate;
      const click = noise(rng) * Math.exp(-tau / 0.002) + 0.6 * Math.sin(TAU * 3200 * tau) * Math.exp(-tau / 0.004);
      add(out, s + k, amp * click);
    }
  }
  const a = onePoleCoef(4000, sampleRate);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const n = noise(rng);
    lp += a * (n - lp);
    add(out, i, 0.05 * (n - lp));
  }
  normalize(out, 0.6);
  fadeEdges(out, sampleRate, 0.002, 0.02);
};

/** Mordida: dois "ploc" rápidos com bolhas. */
export const generateBite: SoundGenerator = (out, sampleRate, rng) => {
  const a = onePoleCoef(1200, sampleRate);
  for (const startSeconds of [0, 0.13]) {
    const start = Math.floor(startSeconds * sampleRate);
    const len = Math.floor(0.12 * sampleRate);
    const amp = rng.range(0.8, 1);
    let phase = 0;
    let lp = 0;
    for (let k = 0; k < len; k++) {
      const tau = k / sampleRate;
      phase += (TAU * (180 + 420 * Math.exp(-tau / 0.025))) / sampleRate;
      lp += a * (noise(rng) - lp);
      add(out, start + k, amp * Math.sin(phase) * Math.exp(-tau / 0.04) + lp * 0.9 * Math.exp(-tau / 0.06));
    }
  }
  normalize(out, 0.9);
  fadeEdges(out, sampleRate, 0.002, 0.02);
};

/** Captura: arpejo maior ascendente sobre um respingo curto. */
export const generateCatch: SoundGenerator = (out, sampleRate, rng) => {
  const a = onePoleCoef(2500, sampleRate);
  let lp = 0;
  const splashLen = Math.min(out.length, Math.floor(0.2 * sampleRate));
  for (let i = 0; i < splashLen; i++) {
    lp += a * (noise(rng) - lp);
    out[i] = lp * 1.5 * Math.exp(-i / sampleRate / 0.05);
  }
  [523.25, 659.25, 783.99, 1046.5].forEach((f, n) => addTone(out, sampleRate, 0.05 + n * 0.11, 0.7, f, f, 0.5));
  normalize(out, 0.8);
  fadeEdges(out, sampleRate, 0.002, 0.03);
};

/** Falha: estalo da linha seguido de dois tons descendentes. */
export const generateFail: SoundGenerator = (out, sampleRate, rng) => {
  const a = onePoleCoef(3000, sampleRate);
  let lp = 0;
  const snapLen = Math.min(out.length, Math.floor(0.06 * sampleRate));
  for (let i = 0; i < snapLen; i++) {
    const n = noise(rng);
    lp += a * (n - lp);
    out[i] = (n - lp) * 1.2 * Math.exp(-i / sampleRate / 0.01);
  }
  addTone(out, sampleRate, 0.08, 0.3, 392, 370, 0.6);
  addTone(out, sampleRate, 0.38, 0.5, 330, 247, 0.6);
  normalize(out, 0.8);
  fadeEdges(out, sampleRate, 0.002, 0.03);
};

export const SOUND_SPECS: Readonly<Record<SoundId, SoundSpec>> = {
  forest: { seconds: 12, loop: true, seamSeconds: 0.5, gain: 0.5, generate: generateForest },
  water: { seconds: 10, loop: true, seamSeconds: 0.5, gain: 0.35, generate: generateWater },
  birds: { seconds: 14, loop: true, seamSeconds: 0.3, gain: 0.25, generate: generateBirds },
  menuMusic: { seconds: 16, loop: true, seamSeconds: 0, gain: 0.5, generate: generateMenuPad },
  cast: { seconds: 0.5, loop: false, seamSeconds: 0, gain: 0.8, generate: generateCast },
  splash: { seconds: 0.7, loop: false, seamSeconds: 0, gain: 0.9, generate: generateSplash },
  line: { seconds: 0.6, loop: false, seamSeconds: 0, gain: 0.5, generate: generateLine },
  bite: { seconds: 0.4, loop: false, seamSeconds: 0, gain: 0.9, generate: generateBite },
  catch: { seconds: 1.4, loop: false, seamSeconds: 0, gain: 0.8, generate: generateCatch },
  fail: { seconds: 0.9, loop: false, seamSeconds: 0, gain: 0.8, generate: generateFail },
};

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate < MIN_SAMPLE_RATE) {
    throw new RangeError(`sampleRate deve ser finito e >= ${MIN_SAMPLE_RATE}; recebido: ${String(sampleRate)}`);
  }
}

/** Quantidade de amostras do som `id` nesta taxa. */
export function soundLength(id: SoundId, sampleRate: number): number {
  assertSampleRate(sampleRate);
  return Math.max(1, Math.round(SOUND_SPECS[id].seconds * sampleRate));
}

/** Renderiza o som em `out` (use `soundLength` para o tamanho), com crossfade na emenda dos loops. */
export function renderSound(id: SoundId, out: Float32Array, sampleRate: number, seed: number): void {
  assertSampleRate(sampleRate);
  const spec = SOUND_SPECS[id];
  const rng = new Rng(seed);
  const seam = Math.round(spec.seamSeconds * sampleRate);
  if (seam === 0 || seam >= out.length) {
    spec.generate(out, sampleRate, rng);
    return;
  }
  const tmp = new Float32Array(out.length + seam);
  spec.generate(tmp, sampleRate, rng);
  out.set(tmp.subarray(0, out.length));
  for (let i = 0; i < seam; i++) {
    const w = i / seam;
    out[i] = (tmp[i] ?? 0) * w + (tmp[out.length + i] ?? 0) * (1 - w);
  }
}
