/**
 * Vara (blank) como cadeia de segmentos com mola angular e amortecedor, em timestep fixo.
 * A tensão da linha aplicada na ponteira gera, em cada junta, um torque igual à tensão vezes o
 * braço até a ponteira; em equilíbrio a flexão é proporcional à tensão (θ = τ / k). Sem carga,
 * a mola devolve o blank ao repouso com uma vibração subamortecida que decai.
 */
export interface RodConfig {
  readonly segments: number;
  readonly lengthM: number;
  /** Rigidez angular da junta do cabo; as demais interpolam linearmente até a da ponteira. */
  readonly buttStiffnessNmPerRad: number;
  readonly tipStiffnessNmPerRad: number;
  readonly dampingNmsPerRad: number;
  readonly segmentInertiaKgM2: number;
  /** Limite de flexão por junta, para a vara não dobrar sobre si mesma. */
  readonly maxBendPerJointRad: number;
  readonly fixedDtMs: number;
  /** Passos máximos por update; o atraso além disso é descartado para não travar o frame. */
  readonly maxStepsPerUpdate: number;
}

export const DEFAULT_ROD_CONFIG: RodConfig = {
  segments: 8,
  lengthM: 2.4,
  buttStiffnessNmPerRad: 60,
  tipStiffnessNmPerRad: 6,
  dampingNmsPerRad: 0.08,
  segmentInertiaKgM2: 0.01,
  maxBendPerJointRad: 1,
  fixedDtMs: 1000 / 240,
  maxStepsPerUpdate: 64,
};

export interface RodPoint {
  readonly x: number;
  readonly y: number;
}

export function validateRodConfig(cfg: RodConfig): RodConfig {
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`rod.${key} deve ser finito e > 0`);
    }
  }
  if (!Number.isInteger(cfg.segments) || cfg.segments < 2) throw new RangeError('rod.segments deve ser inteiro >= 2');
  if (!Number.isInteger(cfg.maxStepsPerUpdate)) throw new RangeError('rod.maxStepsPerUpdate deve ser inteiro');
  return cfg;
}

export class RodPhysics {
  private readonly angle: Float64Array;
  private readonly velocity: Float64Array;
  private readonly stiffness: Float64Array;
  private readonly leverArm: Float64Array;
  private tensionN = 0;
  private accumulatorMs = 0;

  constructor(private readonly cfg: RodConfig = DEFAULT_ROD_CONFIG) {
    validateRodConfig(cfg);
    const n = cfg.segments;
    this.angle = new Float64Array(n);
    this.velocity = new Float64Array(n);
    this.stiffness = new Float64Array(n);
    this.leverArm = new Float64Array(n);
    const segmentM = cfg.lengthM / n;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.stiffness[i] = cfg.buttStiffnessNmPerRad + (cfg.tipStiffnessNmPerRad - cfg.buttStiffnessNmPerRad) * t;
      this.leverArm[i] = segmentM * (n - i);
    }
  }

  /** Componente da tensão da linha perpendicular ao blank, em newtons. */
  setLineTension(tensionN: number): void {
    if (!Number.isFinite(tensionN) || tensionN < 0) throw new RangeError(`tensão inválida: ${String(tensionN)}`);
    this.tensionN = tensionN;
  }

  get lineTensionN(): number {
    return this.tensionN;
  }

  /** Flexão total (soma das juntas), em radianos. */
  get bendRad(): number {
    let sum = 0;
    for (const a of this.angle) sum += a;
    return sum;
  }

  /** Energia mecânica (mola + cinética); zero só no repouso sem carga. */
  get energyJ(): number {
    let e = 0;
    for (let i = 0; i < this.cfg.segments; i++) {
      const a = this.angle[i]!;
      const w = this.velocity[i]!;
      e += 0.5 * this.stiffness[i]! * a * a + 0.5 * this.cfg.segmentInertiaKgM2 * w * w;
    }
    return e;
  }

  jointAngles(): readonly number[] {
    return Array.from(this.angle);
  }

  /** Flexão de equilíbrio para uma tensão, sem simular (θ_i = T·r_i / k_i, limitado). */
  staticBendRad(tensionN: number): number {
    let sum = 0;
    for (let i = 0; i < this.cfg.segments; i++) sum += this.clampBend((tensionN * this.leverArm[i]!) / this.stiffness[i]!);
    return sum;
  }

  /** Pontos do blank no plano da vara, do cabo à ponteira; a flexão curva para baixo (−y). */
  points(baseAngleRad: number): RodPoint[] {
    const segmentM = this.cfg.lengthM / this.cfg.segments;
    const out: RodPoint[] = [{ x: 0, y: 0 }];
    let heading = baseAngleRad;
    let x = 0;
    let y = 0;
    for (const a of this.angle) {
      heading -= a;
      x += Math.cos(heading) * segmentM;
      y += Math.sin(heading) * segmentM;
      out.push({ x, y });
    }
    return out;
  }

  isAtRest(epsilonJ = 1e-6): boolean {
    return this.tensionN === 0 && this.energyJ < epsilonJ;
  }

  /** Avança o tempo de frame em passos fixos de cfg.fixedDtMs. */
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
    const { cfg } = this;
    for (let i = 0; i < cfg.segments; i++) {
      const a = this.angle[i]!;
      const torque = this.tensionN * this.leverArm[i]! - this.stiffness[i]! * a - cfg.dampingNmsPerRad * this.velocity[i]!;
      // Euler semi-implícito: estável para k/I e dt da configuração padrão.
      const w = this.velocity[i]! + (torque / cfg.segmentInertiaKgM2) * dt;
      const next = this.clampBend(a + w * dt);
      this.velocity[i] = next === a + w * dt ? w : 0;
      this.angle[i] = next;
    }
  }

  private clampBend(a: number): number {
    const max = this.cfg.maxBendPerJointRad;
    return Math.min(max, Math.max(-max, a));
  }
}
