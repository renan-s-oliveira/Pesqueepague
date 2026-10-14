import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';
import type { Rng } from '../utils/rng.ts';

export interface ParticleBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Pólen/vaga-lumes num pool fixo: buffers alocados uma vez, partículas recicladas, só a contagem ativa muda. */
export class AmbientParticles {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly phase: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly rng: Rng;
  private readonly bounds: ParticleBounds;
  private active = 0;

  constructor(rng: Rng, capacity: number, bounds: ParticleBounds) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      throw new RangeError('capacidade de partículas deve ser inteiro entre 1 e 10000');
    }
    this.rng = rng;
    this.bounds = bounds;
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.respawn(i);

    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    geometry.setAttribute('position', this.attribute);
    const material = new PointsMaterial({
      color: 0xffd98a,
      size: 0.14,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geometry, material);
    this.points.name = 'ambient-particles';
    this.points.frustumCulled = false;
    this.setActiveCount(capacity);
  }

  setActiveCount(count: number): void {
    this.active = Number.isFinite(count) ? Math.min(this.capacity, Math.max(0, Math.floor(count))) : this.capacity;
    this.points.geometry.setDrawRange(0, this.active);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    const p = this.positions;
    const v = this.velocities;
    for (let i = 0; i < this.active; i++) {
      const lifeLeft = (this.life[i] ?? 0) - deltaSeconds;
      this.life[i] = lifeLeft;
      if (lifeLeft <= 0) {
        this.respawn(i);
        continue;
      }
      const sway = Math.sin(elapsedSeconds * 0.8 + (this.phase[i] ?? 0)) * 0.25;
      const k = i * 3;
      p[k] = (p[k] ?? 0) + ((v[k] ?? 0) + sway) * deltaSeconds;
      p[k + 1] = (p[k + 1] ?? 0) + (v[k + 1] ?? 0) * deltaSeconds;
      p[k + 2] = (p[k + 2] ?? 0) + ((v[k + 2] ?? 0) - sway * 0.5) * deltaSeconds;
    }
    this.attribute.needsUpdate = true;
  }

  private respawn(i: number): void {
    const b = this.bounds;
    const k = i * 3;
    this.positions[k] = this.rng.range(b.minX, b.maxX);
    this.positions[k + 1] = this.rng.range(b.minY, b.maxY);
    this.positions[k + 2] = this.rng.range(b.minZ, b.maxZ);
    this.velocities[k] = this.rng.range(-0.15, 0.15);
    this.velocities[k + 1] = this.rng.range(-0.05, 0.12);
    this.velocities[k + 2] = this.rng.range(-0.15, 0.15);
    this.life[i] = this.rng.range(4, 12);
    this.phase[i] = this.rng.range(0, Math.PI * 2);
  }
}
