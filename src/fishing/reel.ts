/** Recolhimento com tensão: sobe ao recolher, cai ao pausar, rompe após snapAfterMs acima do limite. */
export interface ReelConfig {
  readonly reelSpeedMps: number;
  /** Tensão adicionada por segundo ao recolher, somada ao puxão do peixe. */
  readonly tensionRisePerSec: number;
  /** Tensão aliviada por segundo com o molinete parado. */
  readonly tensionRelaxPerSec: number;
  readonly tensionLimit: number;
  readonly maxTension: number;
  readonly snapAfterMs: number;
  /** Metros por segundo que o peixe puxa de linha, por unidade de puxão, com o molinete parado. */
  readonly driftFactor: number;
  readonly maxDistanceM: number;
}

export const DEFAULT_REEL_CONFIG: ReelConfig = {
  reelSpeedMps: 2,
  tensionRisePerSec: 0.35,
  tensionRelaxPerSec: 0.6,
  tensionLimit: 1,
  maxTension: 1.5,
  snapAfterMs: 1200,
  driftFactor: 1,
  maxDistanceM: 60,
};

export type ReelStatus = 'fighting' | 'caught' | 'snapped';

export function validateReelConfig(cfg: ReelConfig): ReelConfig {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`reel.${key} deve ser finito e > 0`);
    }
  }
  if (cfg.maxTension < cfg.tensionLimit) throw new RangeError('reel.maxTension deve ser >= reel.tensionLimit');
  return cfg;
}

export class ReelLine {
  private distance: number;
  private tensionValue = 0;
  private overLimit = 0;
  private current: ReelStatus = 'fighting';

  constructor(
    initialDistanceM: number,
    private readonly cfg: ReelConfig = DEFAULT_REEL_CONFIG,
  ) {
    if (!Number.isFinite(initialDistanceM) || initialDistanceM < 0) {
      throw new RangeError(`distância inicial inválida: ${String(initialDistanceM)}`);
    }
    this.distance = Math.min(initialDistanceM, cfg.maxDistanceM);
  }

  get status(): ReelStatus {
    return this.current;
  }

  get tension(): number {
    return this.tensionValue;
  }

  get distanceM(): number {
    return this.distance;
  }

  get overLimitMs(): number {
    return this.overLimit;
  }

  /** Avança dtMs com o molinete recolhendo ou não; fishPull é a tensão/s que o peixe aplica. */
  step(dtMs: number, reeling: boolean, fishPull: number): ReelStatus {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    if (!Number.isFinite(fishPull) || fishPull < 0) throw new RangeError(`fishPull inválido: ${String(fishPull)}`);
    if (this.current !== 'fighting') return this.current;

    const dt = dtMs / 1000;
    const { cfg } = this;
    if (reeling) {
      this.tensionValue += (cfg.tensionRisePerSec + fishPull) * dt;
      this.distance -= cfg.reelSpeedMps * dt;
    } else {
      this.tensionValue += (fishPull * 0.5 - cfg.tensionRelaxPerSec) * dt;
      this.distance = Math.min(cfg.maxDistanceM, this.distance + fishPull * cfg.driftFactor * dt);
    }
    this.tensionValue = Math.min(cfg.maxTension, Math.max(0, this.tensionValue));

    if (this.tensionValue > cfg.tensionLimit) {
      this.overLimit += dtMs;
      if (this.overLimit >= cfg.snapAfterMs) {
        this.current = 'snapped';
        return this.current;
      }
    } else {
      this.overLimit = 0;
    }

    if (this.distance <= 0) {
      this.distance = 0;
      this.current = 'caught';
    }
    return this.current;
  }
}
