/**
 * Linha como cadeia Verlet presa na ponteira e na isca, com comprimento variável e timestep fixo.
 * A gravidade curva a linha numa catenária; abaixo do nível da água o ponto flutua com arrasto.
 * A tensão vem do alongamento elástico (rigidez × deformação) e, acima da resistência da linha,
 * a linha rompe e a ponta da isca fica solta.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LineSpec {
  readonly id: string;
  readonly breakingStrengthN: number;
  /** Força por unidade de deformação (≈ E·A da linha). */
  readonly stiffnessN: number;
}

/** Valores típicos de catálogo, arredondados. */
export const LINE_SPECS = {
  mono020: { id: 'mono020', breakingStrengthN: 40, stiffnessN: 600 },
  mono030: { id: 'mono030', breakingStrengthN: 80, stiffnessN: 1300 },
  braid020: { id: 'braid020', breakingStrengthN: 140, stiffnessN: 6000 },
} as const satisfies Record<string, LineSpec>;

export interface LineConfig {
  readonly points: number;
  readonly gravity: number;
  readonly waterLevelY: number;
  /** Fração da velocidade perdida por passo em contato com a água, em [0, 1). */
  readonly waterDrag: number;
  /** Fração da velocidade perdida por passo no ar, em [0, 1). */
  readonly airDamping: number;
  readonly iterations: number;
  readonly minLengthM: number;
  readonly maxLengthM: number;
  readonly fixedDtMs: number;
  readonly maxStepsPerUpdate: number;
}

export const DEFAULT_LINE_CONFIG: LineConfig = {
  points: 24,
  gravity: 9.81,
  waterLevelY: 0,
  waterDrag: 0.3,
  airDamping: 0.01,
  iterations: 16,
  minLengthM: 0.5,
  maxLengthM: 150,
  fixedDtMs: 1000 / 120,
  maxStepsPerUpdate: 32,
};

export function validateLineSpec(spec: LineSpec): LineSpec {
  if (!(Number.isFinite(spec.breakingStrengthN) && spec.breakingStrengthN > 0)) {
    throw new RangeError(`line.${spec.id}.breakingStrengthN deve ser finito e > 0`);
  }
  if (!(Number.isFinite(spec.stiffnessN) && spec.stiffnessN > 0)) {
    throw new RangeError(`line.${spec.id}.stiffnessN deve ser finito e > 0`);
  }
  return spec;
}

export function validateLineConfig(cfg: LineConfig): LineConfig {
  const positive: (keyof LineConfig)[] = ['points', 'gravity', 'iterations', 'minLengthM', 'maxLengthM', 'fixedDtMs', 'maxStepsPerUpdate'];
  for (const key of positive) {
    if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) throw new RangeError(`line.${key} deve ser finito e > 0`);
  }
  if (!Number.isInteger(cfg.points) || cfg.points < 3) throw new RangeError('line.points deve ser inteiro >= 3');
  if (cfg.maxLengthM < cfg.minLengthM) throw new RangeError('line.maxLengthM deve ser >= line.minLengthM');
  for (const key of ['waterDrag', 'airDamping'] as const) {
    if (!(cfg[key] >= 0 && cfg[key] < 1)) throw new RangeError(`line.${key} deve estar em [0, 1)`);
  }
  if (!Number.isFinite(cfg.waterLevelY)) throw new RangeError('line.waterLevelY deve ser finito');
  return cfg;
}

function assertVec(v: Vec3, name: string): void {
  if (!(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) {
    throw new RangeError(`${name} deve ter coordenadas finitas`);
  }
}

export class VerletLine {
  private readonly pos: Float64Array;
  private readonly prev: Float64Array;
  private length: number;
  private start: Vec3;
  private end: Vec3;
  private tensionValue = 0;
  private peak = 0;
  private brokenFlag = false;
  private accumulatorMs = 0;

  constructor(
    private readonly spec: LineSpec,
    lengthM: number,
    start: Vec3,
    end: Vec3,
    private readonly cfg: LineConfig = DEFAULT_LINE_CONFIG,
  ) {
    validateLineSpec(spec);
    validateLineConfig(cfg);
    assertVec(start, 'start');
    assertVec(end, 'end');
    this.length = this.clampLength(lengthM);
    this.start = start;
    this.end = end;
    this.pos = new Float64Array(cfg.points * 3);
    for (let i = 0; i < cfg.points; i++) {
      const t = i / (cfg.points - 1);
      this.pos[i * 3] = start.x + (end.x - start.x) * t;
      this.pos[i * 3 + 1] = start.y + (end.y - start.y) * t;
      this.pos[i * 3 + 2] = start.z + (end.z - start.z) * t;
    }
    this.prev = this.pos.slice();
    this.tensionValue = this.computeTension();
  }

  get lengthM(): number {
    return this.length;
  }

  get tensionN(): number {
    return this.tensionValue;
  }

  get peakTensionN(): number {
    return this.peak;
  }

  get broken(): boolean {
    return this.brokenFlag;
  }

  get lineSpec(): LineSpec {
    return this.spec;
  }

  /** Solta (lança) ou recolhe linha; o comprimento fica em [minLengthM, maxLengthM]. */
  setLength(lengthM: number): void {
    this.length = this.clampLength(lengthM);
  }

  /** Ponteira da vara e posição da isca/peixe; a isca deixa de ser presa depois do rompimento. */
  setAnchors(start: Vec3, end: Vec3): void {
    assertVec(start, 'start');
    assertVec(end, 'end');
    this.start = start;
    this.end = end;
  }

  /** Novo arremesso: evita transportar velocidade e rompimentos da pescaria anterior. */
  reset(start: Vec3, end: Vec3, lengthM: number): void {
    this.setAnchors(start, end);
    this.setLength(lengthM);
    this.brokenFlag = false;
    this.accumulatorMs = 0;
    this.peak = 0;
    const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const sag = Math.min(1.5, Math.max(0, this.length - distance) * 0.5);
    for (let i = 0; i < this.cfg.points; i++) {
      const t = i / (this.cfg.points - 1);
      this.pos[i * 3] = start.x + (end.x - start.x) * t;
      this.pos[i * 3 + 1] = start.y + (end.y - start.y) * t - Math.sin(Math.PI * t) * sag;
      this.pos[i * 3 + 2] = start.z + (end.z - start.z) * t;
    }
    this.prev.set(this.pos);
    this.tensionValue = this.computeTension();
  }

  points(): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i < this.cfg.points; i++) {
      out.push({ x: this.pos[i * 3]!, y: this.pos[i * 3 + 1]!, z: this.pos[i * 3 + 2]! });
    }
    return out;
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError(`dtMs inválido: ${String(dtMs)}`);
    this.accumulatorMs += dtMs;
    let steps = 0;
    while (this.accumulatorMs >= this.cfg.fixedDtMs && steps < this.cfg.maxStepsPerUpdate) {
      this.fixedStep(this.cfg.fixedDtMs / 1000);
      this.accumulatorMs -= this.cfg.fixedDtMs;
      steps++;
    }
    if (steps === this.cfg.maxStepsPerUpdate) this.accumulatorMs = 0;
  }

  private fixedStep(dt: number): void {
    const { cfg, pos, prev } = this;
    const n = cfg.points;
    for (let i = 0; i < n; i++) {
      if (i === 0 || (i === n - 1 && !this.brokenFlag)) continue;
      const k = i * 3;
      const inWater = pos[k + 1]! <= cfg.waterLevelY;
      const keep = 1 - (inWater ? cfg.waterDrag : cfg.airDamping);
      for (let c = 0; c < 3; c++) {
        const cur = pos[k + c]!;
        const accel = c === 1 ? -cfg.gravity : 0;
        pos[k + c] = cur + (cur - prev[k + c]!) * keep + accel * dt * dt;
        prev[k + c] = cur;
      }
    }

    const rest = this.length / (n - 1);
    for (let it = 0; it < cfg.iterations; it++) {
      this.pin();
      // Alternar o sentido evita favorecer sempre uma das pontas.
      for (let i = 0; i < n - 1; i++) this.satisfy(it % 2 === 0 ? i : n - 2 - i, rest);
      this.floatOnWater();
    }
    this.pin();

    if (this.brokenFlag) {
      this.tensionValue = 0;
      return;
    }
    this.tensionValue = this.computeTension();
    this.peak = Math.max(this.peak, this.tensionValue);
    if (this.tensionValue > this.spec.breakingStrengthN) {
      this.brokenFlag = true;
      this.tensionValue = 0;
    }
  }

  /** Tensão elástica: só existe quando a distância entre as pontas passa do comprimento. */
  private computeTension(): number {
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const dz = this.end.z - this.start.z;
    const strain = Math.hypot(dx, dy, dz) / this.length - 1;
    return strain > 0 ? this.spec.stiffnessN * strain : 0;
  }

  private pin(): void {
    const set = (i: number, v: Vec3): void => {
      const k = i * 3;
      this.pos[k] = v.x;
      this.pos[k + 1] = v.y;
      this.pos[k + 2] = v.z;
      this.prev[k] = v.x;
      this.prev[k + 1] = v.y;
      this.prev[k + 2] = v.z;
    };
    set(0, this.start);
    if (!this.brokenFlag) set(this.cfg.points - 1, this.end);
  }

  private satisfy(i: number, rest: number): void {
    const { pos } = this;
    const a = i * 3;
    const b = a + 3;
    const dx = pos[b]! - pos[a]!;
    const dy = pos[b + 1]! - pos[a + 1]!;
    const dz = pos[b + 2]! - pos[a + 2]!;
    const d = Math.hypot(dx, dy, dz);
    if (d === 0) return;
    // Linha não resiste a compressão: só corrige quando o segmento está esticado.
    if (d <= rest) return;
    const freeA = i === 0 ? 0 : 1;
    const freeB = i + 1 === this.cfg.points - 1 && !this.brokenFlag ? 0 : 1;
    const correction = (d - rest) / d / Math.max(1, freeA + freeB);
    pos[a] = pos[a]! + dx * correction * freeA;
    pos[a + 1] = pos[a + 1]! + dy * correction * freeA;
    pos[a + 2] = pos[a + 2]! + dz * correction * freeA;
    pos[b] = pos[b]! - dx * correction * freeB;
    pos[b + 1] = pos[b + 1]! - dy * correction * freeB;
    pos[b + 2] = pos[b + 2]! - dz * correction * freeB;
  }

  private floatOnWater(): void {
    for (let i = 1; i < this.cfg.points - (this.brokenFlag ? 0 : 1); i++) {
      const k = i * 3 + 1;
      if (this.pos[k]! < this.cfg.waterLevelY) this.pos[k] = this.cfg.waterLevelY;
    }
  }

  private clampLength(lengthM: number): number {
    if (!Number.isFinite(lengthM) || lengthM <= 0) throw new RangeError(`comprimento inválido: ${String(lengthM)}`);
    return Math.min(this.cfg.maxLengthM, Math.max(this.cfg.minLengthM, lengthM));
  }
}
