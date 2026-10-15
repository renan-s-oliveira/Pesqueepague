import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, DoubleSide } from 'three';
import type { Rng } from '../utils/rng.ts';
import { LAKE } from './layout.ts';

interface Bird {
  readonly radius: number;
  readonly height: number;
  readonly speed: number;
  readonly phase: number;
  readonly flap: number;
  readonly centerX: number;
  readonly centerZ: number;
}

interface Insect {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly phase: number;
  readonly range: number;
}

export interface FaunaStats {
  readonly birds: number;
  readonly insects: number;
}

/** Duas asas em V; o bater de asas é feito escalando Y por instância (sem alocar). */
function birdGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([0, 0, 0.25, 0, 0, -0.2, -0.7, 0.15, 0, 0, 0, 0.25, 0.7, 0.15, 0, 0, 0, -0.2]);
  g.setAttribute('position', new BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Pássaros circulando sobre o lago e insetos voando perto da margem. Instanciados, animação procedural
 * determinística (seed + tempo); quantidade ativa pelo preset.
 */
export class Fauna {
  readonly group = new Group();
  private readonly birds: Bird[] = [];
  private readonly insects: Insect[] = [];
  private readonly birdMesh: InstancedMesh;
  private readonly insectMesh: InstancedMesh;
  private readonly dummy = new Object3D();

  constructor(rng: Rng, maxBirds = 14, maxInsects = 60) {
    this.group.name = 'fauna';
    for (let i = 0; i < maxBirds; i++) {
      this.birds.push({
        radius: rng.range(18, 60),
        height: rng.range(12, 30),
        speed: rng.range(0.12, 0.3) * (rng.next() < 0.5 ? -1 : 1),
        phase: rng.range(0, Math.PI * 2),
        flap: rng.range(6, 10),
        centerX: LAKE.centerX + rng.range(-20, 20),
        centerZ: LAKE.centerZ + rng.range(-25, 10),
      });
    }
    for (let i = 0; i < maxInsects; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = LAKE.radius * rng.range(0.85, 1.25);
      this.insects.push({ x: LAKE.centerX + Math.cos(a) * d, y: rng.range(0.4, 2.2), z: LAKE.centerZ + Math.sin(a) * d, phase: rng.range(0, 100), range: rng.range(0.3, 1.2) });
    }
    this.birdMesh = new InstancedMesh(birdGeometry(), new MeshStandardMaterial({ color: 0x2b2622, roughness: 0.9, side: DoubleSide }), maxBirds);
    this.birdMesh.name = 'fauna-birds';
    this.insectMesh = new InstancedMesh(new OctahedronGeometry(0.035, 0), new MeshBasicMaterial({ color: new Color(0x2a2a1a) }), maxInsects);
    this.insectMesh.name = 'fauna-insects';
    for (const m of [this.birdMesh, this.insectMesh]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.update(0);
  }

  /** Fração ativa pelo preset (0..1). */
  setDensity(density: number): void {
    const d = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
    this.birdMesh.count = Math.max(1, Math.floor(this.birds.length * d));
    this.insectMesh.count = Math.max(1, Math.floor(this.insects.length * d));
  }

  update(elapsedSeconds: number): void {
    const t = elapsedSeconds;
    const dummy = this.dummy;
    for (let i = 0; i < this.birdMesh.count; i++) {
      const b = this.birds[i];
      if (!b) break;
      const a = b.phase + t * b.speed;
      dummy.position.set(b.centerX + Math.cos(a) * b.radius, b.height + Math.sin(t * 0.3 + b.phase) * 1.5, b.centerZ + Math.sin(a) * b.radius);
      dummy.rotation.set(0, -a + (b.speed > 0 ? Math.PI : 0), Math.sin(a) * 0.2);
      dummy.scale.set(1.3, 0.4 + Math.abs(Math.sin(t * b.flap + b.phase)) * 1.6, 1.3);
      dummy.updateMatrix();
      this.birdMesh.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < this.insectMesh.count; i++) {
      const s = this.insects[i];
      if (!s) break;
      const p = s.phase + t;
      dummy.position.set(s.x + Math.sin(p * 1.3) * s.range, s.y + Math.sin(p * 2.9) * 0.25, s.z + Math.cos(p * 1.7) * s.range);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.insectMesh.setMatrixAt(i, dummy.matrix);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
    this.insectMesh.instanceMatrix.needsUpdate = true;
  }

  getStats(): FaunaStats {
    return { birds: this.birdMesh.count, insects: this.insectMesh.count };
  }
}
