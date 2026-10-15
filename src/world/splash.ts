import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';
import type { Rng } from '../utils/rng.ts';

export type SplashKind = 'lure' | 'jump' | 'catch';

export const SPLASH_KINDS: readonly SplashKind[] = ['lure', 'jump', 'catch'];

export function isSplashKind(value: unknown): value is SplashKind {
  return typeof value === 'string' && (SPLASH_KINDS as readonly string[]).includes(value);
}

interface SplashShape {
  /** Partículas no orçamento cheio (preset Alto/Ultra). */
  readonly count: number;
  readonly upSpeed: number;
  readonly spread: number;
  readonly life: number;
}

/** Isca tocando a água, peixe saltando e a turbulência da captura. */
const SHAPES: Readonly<Record<SplashKind, SplashShape>> = {
  lure: { count: 18, upSpeed: 1.6, spread: 0.7, life: 0.55 },
  jump: { count: 40, upSpeed: 2.6, spread: 1.2, life: 0.8 },
  catch: { count: 60, upSpeed: 3.2, spread: 1.8, life: 1 },
};

const GRAVITY = 9.8;
/** Partícula morta fica fora de qualquer frustum; o buffer não muda de tamanho. */
const PARKED_Y = -1e4;

/**
 * Pool fixo de gotas de splash: buffers alocados uma vez no construtor e gotas recicladas pelo
 * cursor circular (a mais antiga cede o lugar). emit() e update() não alocam objetos.
 */
export class SplashPool {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly rng: Rng;
  private readonly surfaceY: number;
  private cursor = 0;
  private active = 0;
  private budget = 1;

  constructor(rng: Rng, capacity: number, surfaceY: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      throw new RangeError('capacidade do splash deve ser inteiro entre 1 e 10000');
    }
    if (!Number.isFinite(surfaceY)) throw new RangeError('altura da superfície da água deve ser um número finito');
    this.rng = rng;
    this.capacity = capacity;
    this.surfaceY = surfaceY;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = PARKED_Y;

    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    geometry.setAttribute('position', this.attribute);
    const material = new PointsMaterial({ color: 0xe8f2f4, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false });
    this.points = new Points(geometry, material);
    this.points.name = 'splash-particles';
    this.points.frustumCulled = false;
  }

  get activeCount(): number {
    return this.active;
  }

  /** Fração 0..1 das gotas de cada splash, vinda do preset gráfico. */
  setBudget(budget: number): void {
    this.budget = Number.isFinite(budget) ? Math.min(1, Math.max(0, budget)) : 1;
  }

  /** Dispara um splash em (x, z) na superfície. Devolve quantas gotas saíram. */
  emit(x: number, z: number, kind: SplashKind, strength = 1): number {
    if (!(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(strength)) || strength <= 0) return 0;
    const shape = SHAPES[kind];
    const s = Math.min(strength, 2);
    const n = Math.min(this.capacity, Math.max(1, Math.round(shape.count * this.budget * s)));
    const p = this.positions;
    const v = this.velocities;
    for (let j = 0; j < n; j++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if ((this.life[i] ?? 0) <= 0) this.active += 1;
      const angle = this.rng.range(0, Math.PI * 2);
      const out = this.rng.range(0.2, 1) * shape.spread * s;
      const k = i * 3;
      p[k] = x + Math.cos(angle) * 0.05;
      p[k + 1] = this.surfaceY + 0.02;
      p[k + 2] = z + Math.sin(angle) * 0.05;
      v[k] = Math.cos(angle) * out;
      v[k + 1] = this.rng.range(0.5, 1) * shape.upSpeed * s;
      v[k + 2] = Math.sin(angle) * out;
      this.life[i] = this.rng.range(0.6, 1) * shape.life;
    }
    this.attribute.needsUpdate = true;
    return n;
  }

  update(deltaSeconds: number): void {
    if (this.active === 0 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const p = this.positions;
    const v = this.velocities;
    const dt = Math.min(deltaSeconds, 0.1);
    for (let i = 0; i < this.capacity; i++) {
      const left = this.life[i] ?? 0;
      if (left <= 0) continue;
      const k = i * 3;
      const vy = (v[k + 1] ?? 0) - GRAVITY * dt;
      const y = (p[k + 1] ?? 0) + vy * dt;
      const remaining = left - dt;
      if (remaining <= 0 || (vy < 0 && y < this.surfaceY)) {
        this.life[i] = 0;
        p[k + 1] = PARKED_Y;
        this.active -= 1;
        continue;
      }
      this.life[i] = remaining;
      v[k + 1] = vy;
      p[k] = (p[k] ?? 0) + (v[k] ?? 0) * dt;
      p[k + 1] = y;
      p[k + 2] = (p[k + 2] ?? 0) + (v[k + 2] ?? 0) * dt;
    }
    this.attribute.needsUpdate = true;
  }
}
