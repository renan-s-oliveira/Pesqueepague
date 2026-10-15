/**
 * Arremesso: potência pelo tempo segurado e trajetória balística. computeCast/trajectoryAt são a
 * forma analítica no vácuo usada pela sessão; simulateCast integra em timestep fixo com direção,
 * peso da isca, arrasto aerodinâmico quadrático e vento recebido por parâmetro.
 */
export interface CastConfig {
  /** Tempo segurado que leva a potência a 1. */
  readonly maxHoldMs: number;
  readonly minSpeedMps: number;
  readonly maxSpeedMps: number;
  readonly gravity: number;
  readonly launchAngleRad: number;
  readonly launchHeightM: number;
}

export const DEFAULT_CAST_CONFIG: CastConfig = {
  maxHoldMs: 1500,
  minSpeedMps: 6,
  maxSpeedMps: 18,
  gravity: 9.81,
  launchAngleRad: Math.PI / 6,
  launchHeightM: 1.8,
};

export interface CastResult {
  readonly power: number;
  readonly speedMps: number;
  readonly vxMps: number;
  readonly vyMps: number;
  /** Distância horizontal até o ponto de queda. */
  readonly distanceM: number;
  readonly flightMs: number;
}

export interface TrajectoryPoint {
  readonly x: number;
  readonly y: number;
}

export function validateCastConfig(cfg: CastConfig): CastConfig {
  const positive: (keyof CastConfig)[] = ['maxHoldMs', 'minSpeedMps', 'maxSpeedMps', 'gravity'];
  for (const key of positive) {
    if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) throw new RangeError(`cast.${key} deve ser finito e > 0`);
  }
  if (cfg.maxSpeedMps < cfg.minSpeedMps) throw new RangeError('cast.maxSpeedMps deve ser >= cast.minSpeedMps');
  if (!(cfg.launchAngleRad > 0 && cfg.launchAngleRad < Math.PI / 2)) {
    throw new RangeError('cast.launchAngleRad deve estar em (0, π/2)');
  }
  if (!Number.isFinite(cfg.launchHeightM) || cfg.launchHeightM < 0) {
    throw new RangeError('cast.launchHeightM deve ser finito e >= 0');
  }
  return cfg;
}

/** Potência em [0, 1], linear até maxHoldMs. */
export function castPower(holdMs: number, cfg: CastConfig = DEFAULT_CAST_CONFIG): number {
  if (!Number.isFinite(holdMs) || holdMs < 0) {
    throw new RangeError(`holdMs deve ser finito e >= 0; recebido: ${String(holdMs)}`);
  }
  return Math.min(1, holdMs / cfg.maxHoldMs);
}

export function computeCast(power: number, cfg: CastConfig = DEFAULT_CAST_CONFIG): CastResult {
  if (!Number.isFinite(power) || power < 0 || power > 1) {
    throw new RangeError(`power deve estar em [0, 1]; recebido: ${String(power)}`);
  }
  const speedMps = cfg.minSpeedMps + (cfg.maxSpeedMps - cfg.minSpeedMps) * power;
  const vxMps = speedMps * Math.cos(cfg.launchAngleRad);
  const vyMps = speedMps * Math.sin(cfg.launchAngleRad);
  // Raiz positiva de h + vy·t − g·t²/2 = 0.
  const flightS = (vyMps + Math.sqrt(vyMps * vyMps + 2 * cfg.gravity * cfg.launchHeightM)) / cfg.gravity;
  return { power, speedMps, vxMps, vyMps, distanceM: vxMps * flightS, flightMs: flightS * 1000 };
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Vento horizontal em m/s, no mesmo referencial do mundo (x, z). */
export interface Wind {
  readonly x: number;
  readonly z: number;
}

export const NO_WIND: Wind = { x: 0, z: 0 };

export interface BallisticCastInput {
  readonly power: number;
  /** Ângulo de elevação em (−π/2, π/2). */
  readonly elevationRad: number;
  /** Direção no plano: 0 aponta para +x, π/2 para +z. */
  readonly directionRad: number;
  readonly lureMassKg: number;
  readonly wind: Wind;
}

export interface BallisticConfig {
  readonly minSpeedMps: number;
  readonly maxSpeedMps: number;
  readonly gravity: number;
  readonly launchHeightM: number;
  readonly airDensityKgM3: number;
  /** Coeficiente de arrasto da isca (esfera ≈ 0,47). */
  readonly dragCoefficient: number;
  readonly lureAreaM2: number;
  readonly fixedDtMs: number;
  readonly maxFlightMs: number;
}

export const DEFAULT_BALLISTIC_CONFIG: BallisticConfig = {
  minSpeedMps: DEFAULT_CAST_CONFIG.minSpeedMps,
  maxSpeedMps: 30,
  gravity: DEFAULT_CAST_CONFIG.gravity,
  launchHeightM: DEFAULT_CAST_CONFIG.launchHeightM,
  airDensityKgM3: 1.2,
  dragCoefficient: 0.47,
  lureAreaM2: 3e-4,
  fixedDtMs: 1000 / 240,
  maxFlightMs: 20_000,
};

export interface BallisticCastResult {
  readonly landing: Vec3;
  readonly flightMs: number;
  readonly maxHeightM: number;
  /** Uma amostra por passo fixo, do lançamento à queda. */
  readonly path: readonly Vec3[];
}

export function validateBallisticConfig(cfg: BallisticConfig): BallisticConfig {
  const positive: (keyof BallisticConfig)[] = ['minSpeedMps', 'maxSpeedMps', 'gravity', 'fixedDtMs', 'maxFlightMs', 'lureAreaM2'];
  for (const key of positive) {
    if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) throw new RangeError(`ballistic.${key} deve ser finito e > 0`);
  }
  if (cfg.maxSpeedMps < cfg.minSpeedMps) throw new RangeError('ballistic.maxSpeedMps deve ser >= ballistic.minSpeedMps');
  for (const key of ['launchHeightM', 'airDensityKgM3', 'dragCoefficient'] as const) {
    if (!Number.isFinite(cfg[key]) || cfg[key] < 0) throw new RangeError(`ballistic.${key} deve ser finito e >= 0`);
  }
  return cfg;
}

function validateBallisticInput(input: BallisticCastInput): void {
  if (!Number.isFinite(input.power) || input.power < 0 || input.power > 1) {
    throw new RangeError(`power deve estar em [0, 1]; recebido: ${String(input.power)}`);
  }
  if (!(Math.abs(input.elevationRad) < Math.PI / 2)) throw new RangeError('elevationRad deve estar em (−π/2, π/2)');
  if (!Number.isFinite(input.directionRad)) throw new RangeError('directionRad deve ser finito');
  if (!(Number.isFinite(input.lureMassKg) && input.lureMassKg > 0)) throw new RangeError('lureMassKg deve ser finito e > 0');
  if (!(Number.isFinite(input.wind.x) && Number.isFinite(input.wind.z))) throw new RangeError('wind deve ser finito');
}

/** Aceleração de arrasto a = −½·ρ·Cd·A·|v|·v / m, com v relativo ao ar. */
export function dragAcceleration(relativeVelocity: Vec3, lureMassKg: number, cfg: BallisticConfig = DEFAULT_BALLISTIC_CONFIG): Vec3 {
  const speed = Math.hypot(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z);
  const k = (0.5 * cfg.airDensityKgM3 * cfg.dragCoefficient * cfg.lureAreaM2 * speed) / lureMassKg;
  return { x: -k * relativeVelocity.x, y: -k * relativeVelocity.y, z: -k * relativeVelocity.z };
}

export function simulateCast(input: BallisticCastInput, cfg: BallisticConfig = DEFAULT_BALLISTIC_CONFIG): BallisticCastResult {
  validateBallisticInput(input);
  const speed = cfg.minSpeedMps + (cfg.maxSpeedMps - cfg.minSpeedMps) * input.power;
  const horizontal = speed * Math.cos(input.elevationRad);
  let vx = horizontal * Math.cos(input.directionRad);
  let vy = speed * Math.sin(input.elevationRad);
  let vz = horizontal * Math.sin(input.directionRad);
  let x = 0;
  let y = cfg.launchHeightM;
  let z = 0;
  let maxHeightM = y;
  const dt = cfg.fixedDtMs / 1000;
  const path: Vec3[] = [{ x, y, z }];
  let tMs = 0;

  while (tMs < cfg.maxFlightMs) {
    const drag = dragAcceleration({ x: vx - input.wind.x, y: vy, z: vz - input.wind.z }, input.lureMassKg, cfg);
    vx += drag.x * dt;
    vy += (drag.y - cfg.gravity) * dt;
    vz += drag.z * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    const nz = z + vz * dt;
    if (ny <= 0) {
      // Interpola o instante exato em que a isca toca a água.
      const f = y / (y - ny);
      const landing = { x: x + (nx - x) * f, y: 0, z: z + (nz - z) * f };
      path.push(landing);
      return { landing, flightMs: tMs + cfg.fixedDtMs * f, maxHeightM, path };
    }
    x = nx;
    y = ny;
    z = nz;
    tMs += cfg.fixedDtMs;
    maxHeightM = Math.max(maxHeightM, y);
    path.push({ x, y, z });
  }
  throw new RangeError(`o arremesso não tocou a água em ${String(cfg.maxFlightMs)} ms; revise vento e potência`);
}

/** Posição da isca no instante tMs do voo (limitado ao intervalo do voo). */
export function trajectoryAt(cast: CastResult, tMs: number, cfg: CastConfig = DEFAULT_CAST_CONFIG): TrajectoryPoint {
  if (!Number.isFinite(tMs)) throw new RangeError(`tMs deve ser finito; recebido: ${String(tMs)}`);
  const t = Math.min(Math.max(tMs, 0), cast.flightMs) / 1000;
  const y = cfg.launchHeightM + cast.vyMps * t - (cfg.gravity * t * t) / 2;
  return { x: cast.vxMps * t, y: Math.max(0, y) };
}
