/** Ciclo de dia e noite puro (sem three): hora, direção do sol/lua e paleta interpolada por hora. */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Cores em sRGB 0..1 e intensidades já calibradas para não saturar nem zerar a sombra. */
export interface AtmospherePalette {
  readonly skyTop: [number, number, number];
  readonly skyHorizon: [number, number, number];
  readonly ground: [number, number, number];
  readonly sun: [number, number, number];
  readonly fog: [number, number, number];
  /** Intensidade da luz direcional (sol de dia, lua de noite). */
  readonly keyIntensity: number;
  /** Luz de céu: nunca abaixo de 0,35 para a sombra não ficar preta. */
  readonly hemiIntensity: number;
  /** 0 = noite fechada, 1 = dia pleno. */
  readonly daylight: number;
}

interface Keyframe {
  readonly hour: number;
  readonly top: number;
  readonly horizon: number;
  readonly ground: number;
  readonly sun: number;
  readonly key: number;
  readonly hemi: number;
  readonly daylight: number;
}

const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, top: 0x0b1426, horizon: 0x1c2a44, ground: 0x0d0f14, sun: 0x8fa6d8, key: 0.3, hemi: 0.35, daylight: 0 },
  { hour: 5, top: 0x16223f, horizon: 0x4a4566, ground: 0x15151a, sun: 0x9aa8d0, key: 0.3, hemi: 0.38, daylight: 0.05 },
  { hour: 6.5, top: 0x5a7fb5, horizon: 0xf0a986, ground: 0x4a3e36, sun: 0xffb98a, key: 1.2, hemi: 0.6, daylight: 0.55 },
  { hour: 9, top: 0x4a83c4, horizon: 0xbcd3e6, ground: 0x5a5244, sun: 0xfff1dc, key: 2.6, hemi: 0.85, daylight: 0.9 },
  { hour: 12, top: 0x3f7cc4, horizon: 0xc4dcef, ground: 0x5f5646, sun: 0xfff6e8, key: 2.9, hemi: 0.95, daylight: 1 },
  { hour: 16, top: 0x4579b8, horizon: 0xdfcaa6, ground: 0x5c4e3e, sun: 0xffe0b0, key: 2.6, hemi: 0.9, daylight: 0.95 },
  { hour: 17.5, top: 0x3d6fa8, horizon: 0xf2b37a, ground: 0x5a4a3c, sun: 0xffc27a, key: 2.4, hemi: 0.9, daylight: 0.8 },
  { hour: 19, top: 0x2a3c66, horizon: 0xc77a5e, ground: 0x3a3030, sun: 0xff9a6a, key: 0.9, hemi: 0.55, daylight: 0.35 },
  { hour: 20.5, top: 0x111d36, horizon: 0x2e3352, ground: 0x111216, sun: 0x8fa6d8, key: 0.3, hemi: 0.38, daylight: 0.05 },
  { hour: 24, top: 0x0b1426, horizon: 0x1c2a44, ground: 0x0d0f14, sun: 0x8fa6d8, key: 0.3, hemi: 0.35, daylight: 0 },
];

/** Normaliza para [0, 24). Rejeita valor não finito em vez de propagar NaN para o shader. */
export function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) throw new RangeError(`hora inválida: ${hour}`);
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/** Sol nasce às 6h a leste, culmina ao meio-dia e se põe às 18h a oeste (lado do lago visto do píer). */
export function sunDirectionAt(hour: number, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  const angle = ((normalizeHour(hour) - 6) / 12) * Math.PI;
  const x = -Math.cos(angle) * 0.75;
  const y = Math.sin(angle) * 0.8;
  const z = -0.55;
  const len = Math.hypot(x, y, z);
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

/** Lua em oposição ao sol, levemente deslocada para não ficar exatamente no nadir solar. */
export function moonDirectionAt(hour: number, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  sunDirectionAt(hour, out);
  const x = -out.x;
  const y = -out.y;
  const z = out.z * 0.6 - 0.3;
  const len = Math.hypot(x, y, z);
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

const toRgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpRgb = (a: number, b: number, t: number): [number, number, number] => {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)];
};

/** Paleta da hora, interpolada linearmente entre quadros-chave: mesma hora, mesma paleta. */
export function paletteAt(hour: number): AtmospherePalette {
  const h = normalizeHour(hour);
  let i = 0;
  while (i < KEYFRAMES.length - 2 && (KEYFRAMES[i + 1]?.hour ?? 24) <= h) i++;
  const a = KEYFRAMES[i]!;
  const b = KEYFRAMES[i + 1]!;
  const t = (h - a.hour) / (b.hour - a.hour);
  const skyHorizon = lerpRgb(a.horizon, b.horizon, t);
  const ground = lerpRgb(a.ground, b.ground, t);
  return {
    skyTop: lerpRgb(a.top, b.top, t),
    skyHorizon,
    ground,
    sun: lerpRgb(a.sun, b.sun, t),
    fog: [lerp(skyHorizon[0], ground[0], 0.25), lerp(skyHorizon[1], ground[1], 0.25), lerp(skyHorizon[2], ground[2], 0.25)],
    keyIntensity: lerp(a.key, b.key, t),
    hemiIntensity: lerp(a.hemi, b.hemi, t),
    daylight: lerp(a.daylight, b.daylight, t),
  };
}

export interface TimeOfDayOptions {
  /** Segundos reais para um dia inteiro. Padrão: 1440 (1 hora do jogo por minuto). */
  readonly dayLengthSeconds?: number;
  readonly paused?: boolean;
}

/** Relógio do dia: avança com o delta do loop (determinístico com o relógio manual do e2e). */
export class TimeOfDay {
  private current: number;
  private readonly hoursPerSecond: number;
  paused: boolean;

  constructor(hour = 16, options: TimeOfDayOptions = {}) {
    const dayLength = options.dayLengthSeconds ?? 1440;
    if (!Number.isFinite(dayLength) || dayLength <= 0) throw new RangeError('duração do dia deve ser positiva');
    this.current = normalizeHour(hour);
    this.hoursPerSecond = 24 / dayLength;
    this.paused = options.paused ?? false;
  }

  get hour(): number {
    return this.current;
  }

  setTime(hour: number): void {
    this.current = normalizeHour(hour);
  }

  update(deltaSeconds: number): void {
    if (this.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.current = normalizeHour(this.current + deltaSeconds * this.hoursPerSecond);
  }

  /** Sol acima do horizonte o bastante para ser a luz principal. */
  get isDay(): boolean {
    return sunDirectionAt(this.current).y > 0.03;
  }
}
