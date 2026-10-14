/** Arremesso: potência pelo tempo segurado e trajetória balística simplificada (sem arrasto nem linha). */
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

/** Posição da isca no instante tMs do voo (limitado ao intervalo do voo). */
export function trajectoryAt(cast: CastResult, tMs: number, cfg: CastConfig = DEFAULT_CAST_CONFIG): TrajectoryPoint {
  if (!Number.isFinite(tMs)) throw new RangeError(`tMs deve ser finito; recebido: ${String(tMs)}`);
  const t = Math.min(Math.max(tMs, 0), cast.flightMs) / 1000;
  const y = cfg.launchHeightM + cast.vyMps * t - (cfg.gravity * t * t) / 2;
  return { x: cast.vxMps * t, y: Math.max(0, y) };
}
