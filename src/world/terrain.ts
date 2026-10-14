import { BufferAttribute, Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Rng } from '../utils/rng.ts';
import { LAKE, PIER, TERRAIN, distanceToLakeCenter, isOnPier } from './layout.ts';
import { createNoise2D, fbm, smoothstep } from './noise.ts';

export type HeightField = (x: number, z: number) => number;

export interface Terrain {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  readonly heightAt: HeightField;
}

/** Altura procedural: bacia do lago, margem ondulada e anel de montanhas. */
export function createHeightField(rng: Rng): HeightField {
  const noise = createNoise2D(rng);
  const r = LAKE.radius;
  return (x, z) => {
    const d = distanceToLakeCenter(x, z);
    const shore = smoothstep(r * 0.85, r * 1.3, d);
    const hills = (fbm(noise, x * 0.03, z * 0.03, 4) * 0.5 + 0.5) * 1.6 + 0.3;
    const ridge = fbm(noise, x * 0.012 + 40, z * 0.012 - 17, 5) * 0.5 + 0.5;
    const mountains = smoothstep(70, 150, d) * (12 + ridge * 48);
    let h = -3 + shore * 3 + shore * hills + mountains;
    if (isOnPier(x, z, 1.5)) h = Math.min(h, PIER.deckY - 0.35);
    return h;
  };
}

export function createTerrain(rng: Rng): Terrain {
  const heightAt = createHeightField(rng);
  const geometry = new PlaneGeometry(TERRAIN.size, TERRAIN.size, TERRAIN.segments, TERRAIN.segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const sand = new Color(0xc9b28a);
  const grass = new Color(0x5d7a3a);
  const dryGrass = new Color(0x8d8a4a);
  const rock = new Color(0x77706a);
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const flatness = normal.getY(i);
    color.copy(grass).lerp(dryGrass, smoothstep(4, 18, y));
    if (y < 0.6) color.lerp(sand, smoothstep(0.6, -0.4, y));
    color.lerp(rock, smoothstep(0.85, 0.6, flatness) * 0.9 + smoothstep(25, 45, y) * 0.1);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return { mesh, heightAt };
}
