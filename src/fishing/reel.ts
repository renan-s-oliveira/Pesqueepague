import type { LineSpec } from './linePhysics.ts';

/**
 * ReelLine: modelo de jogo usado pela sessão (tensão normalizada, rompe após snapAfterMs acima do
 * limite). DragReel: molinete físico em timestep fixo, com drag ajustável, recolhimento variável e
 * rompimento quando a tensão passa da resistência da linha.
 */
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

export interface DragReelConfig {
  readonly maxDragN: number;
  readonly maxRetrieveMps: number;
  /** Rigidez da linha esticada entre molinete e peixe, em N por metro de alongamento. */
  readonly lineStiffnessNpm: number;
  readonly spoolCapacityM: number;
  readonly fixedDtMs: number;
  readonly maxStepsPerUpdate: number;
}

export const DEFAULT_DRAG_REEL_CONFIG: DragReelConfig = {
  maxDragN: 120,
  maxRetrieveMps: 1.2,
  lineStiffnessNpm: 40,
  spoolCapacityM: 150,
  fixedDtMs: 1000 / 240,
  maxStepsPerUpdate: 64,
};

export interface DragReelInput {
  /** Fração da velocidade máxima de recolhimento, em [0, 1]. */
  readonly retrieve: number;
  /** Velocidade do peixe se afastando (negativa quando vem na direção do pescador). */
  readonly fishSpeedMps: number;
}

export type DragReelStatus = 'ok' | 'snapped';

export function validateDragReelConfig(cfg: DragReelConfig): DragReelConfig {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`dragReel.${key} deve ser finito e > 0`);
    }
  }
  if (!Number.isInteger(cfg.maxStepsPerUpdate)) throw new RangeError('dragReel.maxStepsPerUpdate deve ser inteiro');
  return cfg;
}

export class DragReel {
  private dragN: number;
  private stretchM = 0;
  private lineOut: number;
  private tensionValue = 0;
  private peak = 0;
  private slipping = false;
  private current: DragReelStatus = 'ok';
  private accumulatorMs = 0;

  constructor(
    private readonly line: LineSpec,
    initialLineOutM: number,
    dragN: number,
    private readonly cfg: DragReelConfig = DEFAULT_DRAG_REEL_CONFIG,
  ) {
    validateDragReelConfig(cfg);
    if (!(Number.isFinite(line.breakingStrengthN) && line.breakingStrengthN > 0)) {
      throw new RangeError(`linha ${line.id} sem resistência válida`);
    }
    if (!Number.isFinite(initialLineOutM) || initialLineOutM < 0 || initialLineOutM > cfg.spoolCapacityM) {
      throw new RangeError(`linha solta inválida: ${String(initialLineOutM)}`);
    }
    this.lineOut = initialLineOutM;
    this.dragN = this.checkDrag(dragN);
  }

  get status(): DragReelStatus {
    return this.current;
  }

  get tensionN(): number {
    return this.tensionValue;
  }

  get peakTensionN(): number {
    return this.peak;
  }

  get lineOutM(): number {
    return this.lineOut;
  }

  get dragSettingN(): number {
    return this.dragN;
  }

  /** Verdadeiro se, no último passo, o carretel cedeu linha pelo drag. */
  get isSlipping(): boolean {
    return this.slipping;
  }

  setDrag(dragN: number): void {
    this.dragN = this.checkDrag(dragN);
  }

  update(dtMs: number, input: DragReelInput): DragReelStatus {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    if (!(input.retrieve >= 0 && input.retrieve <= 1)) throw new RangeError(`retrieve deve estar em [0, 1]: ${String(input.retrieve)}`);
    if (!Number.isFinite(input.fishSpeedMps)) throw new RangeError(`fishSpeedMps inválido: ${String(input.fishSpeedMps)}`);
    this.accumulatorMs += dtMs;
    let steps = 0;
    while (this.accumulatorMs >= this.cfg.fixedDtMs && steps < this.cfg.maxStepsPerUpdate && this.current === 'ok') {
      this.fixedStep(this.cfg.fixedDtMs / 1000, input);
      this.accumulatorMs -= this.cfg.fixedDtMs;
      steps++;
    }
    if (steps === this.cfg.maxStepsPerUpdate) this.accumulatorMs = 0;
    return this.current;
  }

  private fixedStep(dt: number, input: DragReelInput): void {
    const { cfg } = this;
    const retrieveMps = input.retrieve * cfg.maxRetrieveMps;
    this.stretchM = Math.max(0, this.stretchM + (input.fishSpeedMps + retrieveMps) * dt);
    this.lineOut = Math.max(0, this.lineOut - retrieveMps * dt);
    let tension = this.stretchM * cfg.lineStiffnessNpm;
    this.slipping = tension > this.dragN;
    if (this.slipping) {
      // O carretel cede o excedente: a tensão fica no valor do drag e a linha sai.
      const excessM = (tension - this.dragN) / cfg.lineStiffnessNpm;
      this.stretchM -= excessM;
      this.lineOut = Math.min(cfg.spoolCapacityM, this.lineOut + excessM);
      tension = this.dragN;
    }
    this.tensionValue = tension;
    this.peak = Math.max(this.peak, tension);
    if (tension > this.line.breakingStrengthN) {
      this.current = 'snapped';
      this.tensionValue = 0;
      this.stretchM = 0;
    }
  }

  private checkDrag(dragN: number): number {
    if (!Number.isFinite(dragN) || dragN < 0 || dragN > this.cfg.maxDragN) {
      throw new RangeError(`drag deve estar em [0, ${String(this.cfg.maxDragN)}] N; recebido: ${String(dragN)}`);
    }
    return dragN;
  }
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
