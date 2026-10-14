import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import type { Rng } from '../utils/rng.ts';
import { LAKE, TERRAIN, distanceToLakeCenter, isOnPier } from './layout.ts';
import type { HeightField } from './terrain.ts';

interface Placement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

interface ScatterRule {
  readonly count: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly maxHeight: number;
}

/** Árvores, arbustos, rochas e flores em InstancedMesh com geometria procedural. Matrizes calculadas uma vez. */
export class Vegetation {
  readonly group = new Group();
  private readonly layers: { mesh: InstancedMesh; max: number }[] = [];
  private readonly rng: Rng;
  private readonly heightAt: HeightField;

  constructor(rng: Rng, heightAt: HeightField) {
    this.rng = rng;
    this.heightAt = heightAt;
    this.group.name = 'vegetation';

    const trees = this.scatter({ count: 320, minDistance: LAKE.radius * 1.35, maxDistance: 165, maxHeight: 30 });
    const trunk = new CylinderGeometry(0.16, 0.26, 2.2, 6).translate(0, 1.1, 0);
    const crown = new ConeGeometry(1.3, 3.6, 7).translate(0, 3.6, 0);
    this.addLayer('tree-trunks', trunk, new MeshStandardMaterial({ roughness: 1 }), trees, [0x5b3a24, 0x4a2f1d], true);
    this.addLayer('tree-crowns', crown, new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees, [0x2f5a2c, 0x3b6b31, 0x4c6e2a], true);

    const bushes = this.scatter({ count: 300, minDistance: LAKE.radius * 1.2, maxDistance: 120, maxHeight: 22 });
    const bush = new IcosahedronGeometry(0.8, 1).scale(1, 0.65, 1).translate(0, 0.35, 0);
    this.addLayer('bushes', bush, new MeshStandardMaterial({ roughness: 0.95, flatShading: true }), bushes, [0x456b2e, 0x5a7a34, 0x3e5e2a], true);

    const rocks = this.scatter({ count: 140, minDistance: LAKE.radius * 1.05, maxDistance: 170, maxHeight: 60 });
    const rock = new DodecahedronGeometry(0.7, 0).scale(1.3, 0.7, 1);
    this.addLayer('rocks', rock, new MeshStandardMaterial({ roughness: 0.85, flatShading: true }), rocks, [0x7d766e, 0x8a8278, 0x6b655e], true);

    const flowers = this.scatter({ count: 700, minDistance: LAKE.radius * 1.25, maxDistance: 80, maxHeight: 8 });
    const flower = new ConeGeometry(0.09, 0.22, 5).rotateX(Math.PI).translate(0, 0.28, 0);
    this.addLayer('flowers', flower, new MeshStandardMaterial({ roughness: 0.6 }), flowers, [0xf2e14c, 0xe86a8a, 0xf5f2ea, 0xb27ae8], false);
  }

  /** Desenha só uma fração das instâncias (a ordem é aleatória, então o subconjunto continua espalhado). */
  setDensity(density: number): void {
    const d = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
    for (const layer of this.layers) layer.mesh.count = Math.floor(layer.max * d);
  }

  private scatter(rule: ScatterRule): Placement[] {
    const placements: Placement[] = [];
    const half = TERRAIN.size / 2 - 5;
    const maxAttempts = rule.count * 12;
    for (let attempt = 0; attempt < maxAttempts && placements.length < rule.count; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = this.rng.range(rule.minDistance, rule.maxDistance);
      const x = LAKE.centerX + Math.cos(angle) * distance;
      const z = LAKE.centerZ + Math.sin(angle) * distance;
      if (Math.abs(x) > half || Math.abs(z) > half || isOnPier(x, z, 2.5)) continue;
      if (distanceToLakeCenter(x, z) < rule.minDistance) continue;
      const y = this.heightAt(x, z);
      if (y < LAKE.waterLevel + 0.2 || y > rule.maxHeight) continue;
      placements.push({ x, y, z, scale: this.rng.range(0.7, 1.4), rotation: this.rng.range(0, Math.PI * 2) });
    }
    return placements;
  }

  private addLayer(
    name: string,
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    placements: readonly Placement[],
    palette: readonly number[],
    castShadow: boolean,
  ): void {
    const mesh = new InstancedMesh(geometry, material, Math.max(1, placements.length));
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const dummy = new Object3D();
    const color = new Color();
    placements.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.05, p.z);
      dummy.rotation.set(0, p.rotation, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(palette[i % palette.length] ?? 0xffffff));
    });
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.layers.push({ mesh, max: placements.length });
    this.group.add(mesh);
  }
}
