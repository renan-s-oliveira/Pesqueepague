import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';
import type { Rng } from '../utils/rng.ts';
import type { Wind } from './weather.ts';

const CALM: Wind = { x: 0, z: 0, speed: 0 };

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

  /** O vento (Weather.getWind) arrasta o pólen com 15% da velocidade do ar. */
  update(deltaSeconds: number, elapsedSeconds: number, wind: Wind = CALM): void {
    const p = this.positions;
    const v = this.velocities;
    const driftX = wind.x * 0.15;
    const driftZ = wind.z * 0.15;
    for (let i = 0; i < this.active; i++) {
      const lifeLeft = (this.life[i] ?? 0) - deltaSeconds;
      this.life[i] = lifeLeft;
      if (lifeLeft <= 0) {
        this.respawn(i);
        continue;
      }
      const sway = Math.sin(elapsedSeconds * 0.8 + (this.phase[i] ?? 0)) * 0.25;
      const k = i * 3;
      p[k] = (p[k] ?? 0) + ((v[k] ?? 0) + sway + driftX) * deltaSeconds;
      p[k + 1] = (p[k + 1] ?? 0) + (v[k + 1] ?? 0) * deltaSeconds;
      p[k + 2] = (p[k + 2] ?? 0) + ((v[k + 2] ?? 0) - sway * 0.5 + driftZ) * deltaSeconds;
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

const RAIN_FALL_SPEED = 9;

/**
 * Chuva no mesmo esquema de pool fixo: gotas alocadas uma vez, recicladas ao tocar o chão,
 * inclinadas pelo vento compartilhado. A intensidade do clima só muda quantas gotas desenham.
 */
export class RainParticles {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly rng: Rng;
  private readonly bounds: ParticleBounds;
  private active = 0;

  constructor(rng: Rng, capacity: number, bounds: ParticleBounds) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20000) {
      throw new RangeError('capacidade de chuva deve ser inteiro entre 1 e 20000');
    }
    this.rng = rng;
    this.bounds = bounds;
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.respawn(i, this.rng.range(bounds.minY, bounds.maxY));
    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    geometry.setAttribute('position', this.attribute);
    const material = new PointsMaterial({ color: 0xaab8c8, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false });
    this.points = new Points(geometry, material);
    this.points.name = 'rain-particles';
    this.points.frustumCulled = false;
    this.setIntensity(0);
  }

  get activeCount(): number {
    return this.active;
  }

  /** `intensity` 0..1 do clima vezes `budget` 0..1 do preset gráfico. */
  setIntensity(intensity: number, budget = 1): void {
    const i = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    const b = Number.isFinite(budget) ? Math.min(1, Math.max(0, budget)) : 0;
    this.active = Math.floor(this.capacity * i * b);
    this.points.geometry.setDrawRange(0, this.active);
    this.points.visible = this.active > 0;
  }

  update(deltaSeconds: number, wind: Wind = CALM): void {
    if (this.active === 0) return;
    const p = this.positions;
    const dx = wind.x * deltaSeconds;
    const dz = wind.z * deltaSeconds;
    const dy = RAIN_FALL_SPEED * deltaSeconds;
    const b = this.bounds;
    for (let i = 0; i < this.active; i++) {
      const k = i * 3;
      const y = (p[k + 1] ?? 0) - dy;
      if (y < b.minY) {
        this.respawn(i, b.maxY);
        continue;
      }
      p[k] = (p[k] ?? 0) + dx;
      p[k + 1] = y;
      p[k + 2] = (p[k + 2] ?? 0) + dz;
    }
    this.attribute.needsUpdate = true;
  }

  private respawn(i: number, y: number): void {
    const b = this.bounds;
    const k = i * 3;
    this.positions[k] = this.rng.range(b.minX, b.maxX);
    this.positions[k + 1] = y;
    this.positions[k + 2] = this.rng.range(b.minZ, b.maxZ);
  }
}
