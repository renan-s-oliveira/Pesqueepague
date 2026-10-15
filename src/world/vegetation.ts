import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../utils/rng.ts';
import { LAKE, PIER, TERRAIN, distanceToLakeCenter, isOnPier } from './layout.ts';
import type { HeightField } from './terrain.ts';

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotation: number;
  /** Variação de matiz/brilho por instância, em [-1, 1]. */
  readonly hue: number;
}

export interface ScatterRule {
  readonly count: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly maxHeight: number;
  readonly minScale: number;
  readonly maxScale: number;
}

export type VegetationKind = 'palm' | 'broadleaf' | 'bush' | 'reed' | 'rock' | 'log' | 'leaf-litter' | 'flower';

export interface VegetationStats {
  readonly instances: number;
  readonly meshes: number;
  readonly byKind: Readonly<Record<string, number>>;
}

export interface WindInput {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

/** Ponto de vista de referência para LOD e culling: a ponta do píer, onde o jogador fica. */
export const VIEWPOINT = { x: PIER.x, z: PIER.zEnd } as const;

/** Distribuição determinística pelo RNG: posição em anel em volta do lago, escala, rotação e matiz por instância. */
export function scatterPlacements(rng: Rng, heightAt: HeightField, rule: ScatterRule): Placement[] {
  const placements: Placement[] = [];
  const half = TERRAIN.size / 2 - 5;
  const maxAttempts = rule.count * 12;
  for (let attempt = 0; attempt < maxAttempts && placements.length < rule.count; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(rule.minDistance, rule.maxDistance);
    const x = LAKE.centerX + Math.cos(angle) * distance;
    const z = LAKE.centerZ + Math.sin(angle) * distance;
    const scale = rng.range(rule.minScale, rule.maxScale);
    const rotation = rng.range(0, Math.PI * 2);
    const hue = rng.range(-1, 1);
    if (Math.abs(x) > half || Math.abs(z) > half || isOnPier(x, z, 2.5)) continue;
    if (distanceToLakeCenter(x, z) < rule.minDistance) continue;
    const y = heightAt(x, z);
    if (y < LAKE.waterLevel + 0.2 || y > rule.maxHeight) continue;
    placements.push({ x, y, z, scale, rotation, hue });
  }
  return placements;
}

interface SpeciesSpec {
  readonly kind: VegetationKind;
  readonly rule: ScatterRule;
  /** Geometria por nível de LOD (0 = perto). */
  readonly lods: readonly BufferGeometry[];
  /** Distância (ao ponto de vista) em que cada LOD termina; a última é o culling. */
  readonly lodDistances: readonly number[];
  readonly sway: number;
  readonly castShadow: boolean;
  readonly roughness: number;
}

interface Layer {
  readonly kind: VegetationKind;
  readonly mesh: InstancedMesh;
  readonly max: number;
}

const WIND_SHADER_HEADER = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform float uSway;
`;

/** Balanço: cresce com o quadrado da altura local, fase por instância, vento convertido para o espaço local. */
const WIND_SHADER_BODY = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 origin = instanceMatrix[3].xyz;
  float phase = origin.x * 0.21 + origin.z * 0.17;
  float height = max(transformed.y, 0.0);
  float gust = 0.65 + sin(uTime * 1.7 + phase) * 0.25 + sin(uTime * 3.3 + phase * 1.7) * 0.1;
  vec3 localWind = transpose(mat3(instanceMatrix)) * vec3(uWind.x, 0.0, uWind.y);
  float len = max(length(localWind), 1e-4);
  float amount = uSway * min(uWind.z, 14.0) * 0.012 * height * height * gust;
  transformed.xz += (localWind.xz / len) * amount;
  transformed.x += sin(uTime * 4.1 + phase + transformed.y) * uSway * 0.01 * height * min(uWind.z, 14.0) * 0.1;
}
#endif
`;

/**
 * Vegetação tropical procedural: palmeiras, árvores de copa larga, arbustos, juncos, rochas, troncos caídos
 * com raízes, folhas no chão e flores. Cada espécie em InstancedMesh por nível de LOD (2 a 3), com culling por
 * distância ao píer, variação de escala, rotação e matiz por instância e balanço de vento no vertex shader.
 */
export class Vegetation {
  readonly group = new Group();
  private readonly layers: Layer[] = [];
  private readonly time = { value: 0 };
  private readonly wind = { value: new Vector3(1, 0, 0) };
  private density = 1;

  constructor(rng: Rng, heightAt: HeightField) {
    this.group.name = 'vegetation';
    const r = LAKE.radius;
    for (const spec of buildSpecies(r)) {
      const placements = scatterPlacements(rng, heightAt, spec.rule);
      this.addSpecies(spec, placements);
    }
  }

  /** Desenha só uma fração das instâncias de cada camada (a ordem é aleatória, então o subconjunto segue espalhado). */
  setDensity(density: number): void {
    this.density = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
    for (const layer of this.layers) layer.mesh.count = Math.floor(layer.max * this.density);
  }

  /** Tempo e vento (de weather.getWind()) para o balanço no shader. Não aloca. */
  update(elapsedSeconds: number, wind: WindInput): void {
    this.time.value = elapsedSeconds;
    const len = Math.hypot(wind.x, wind.z);
    if (len > 1e-4) this.wind.value.set(wind.x / len, wind.z / len, wind.speed);
    else this.wind.value.z = wind.speed;
  }

  getStats(): VegetationStats {
    const byKind: Record<string, number> = {};
    let instances = 0;
    for (const layer of this.layers) {
      byKind[layer.kind] = (byKind[layer.kind] ?? 0) + layer.mesh.count;
      instances += layer.mesh.count;
    }
    return { instances, meshes: this.layers.length, byKind };
  }

  private addSpecies(spec: SpeciesSpec, placements: readonly Placement[]): void {
    const buckets: Placement[][] = spec.lods.map(() => []);
    for (const p of placements) {
      const d = Math.hypot(p.x - VIEWPOINT.x, p.z - VIEWPOINT.z);
      const lod = spec.lodDistances.findIndex((limit) => d <= limit);
      if (lod >= 0) buckets[lod]?.push(p);
    }
    const material = this.createMaterial(spec);
    spec.lods.forEach((geometry, lod) => {
      const bucket = buckets[lod] ?? [];
      if (bucket.length === 0) {
        geometry.dispose();
        return;
      }
      this.addLayer(spec, `${spec.kind}-lod${lod}`, geometry, material, bucket, lod === 0 ? spec.castShadow : false);
    });
  }

  private createMaterial(spec: SpeciesSpec): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: spec.roughness, metalness: 0, side: DoubleSide });
    if (spec.sway > 0) {
      const sway = { value: spec.sway };
      material.onBeforeCompile = (shader) => {
        shader.uniforms['uTime'] = this.time;
        shader.uniforms['uWind'] = this.wind;
        shader.uniforms['uSway'] = sway;
        shader.vertexShader = WIND_SHADER_HEADER + shader.vertexShader.replace('#include <begin_vertex>', WIND_SHADER_BODY);
      };
      material.customProgramCacheKey = () => 'vegetation-wind';
    }
    return material;
  }

  private addLayer(
    spec: SpeciesSpec,
    name: string,
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    placements: readonly Placement[],
    castShadow: boolean,
  ): void {
    const mesh = new InstancedMesh(geometry, material, placements.length);
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
      const h = p.hue;
      color.setRGB(0.92 + h * 0.08, 0.9 + Math.abs(h) * 0.1 - 0.05, 0.86 - h * 0.1);
      mesh.setColorAt(i, color);
    });
    mesh.count = Math.floor(placements.length * this.density);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.layers.push({ kind: spec.kind, mesh, max: placements.length });
    this.group.add(mesh);
  }
}

function painted(geometry: BufferGeometry, hex: number): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new Color(hex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const result = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!result) throw new Error('vegetação: falha ao juntar as geometrias de uma espécie (atributos diferentes entre as partes)');
  result.computeBoundingSphere();
  return result;
}

const TRUNK = 0x6b4a30;
const BARK_DARK = 0x4a3322;
const LEAF = 0x3f7a2e;
const LEAF_LIGHT = 0x5f9a3a;
const PALM_LEAF = 0x4e8a34;

function palmFronds(count: number, length: number, segments: number, top: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const frond = new PlaneGeometry(0.75, length, 1, segments);
    const pos = frond.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + length / 2) / length;
      pos.setX(v, pos.getX(v) * (1 - t * 0.7));
      pos.setZ(v, -t * t * length * 0.45);
    }
    frond.translate(0, length / 2, 0).rotateX(-Math.PI / 2 + 0.35).rotateY((i / count) * Math.PI * 2 + i * 0.3).translate(0, top, 0);
    parts.push(painted(frond, i % 2 === 0 ? PALM_LEAF : LEAF_LIGHT));
  }
  return parts;
}

function palm(lod: number): BufferGeometry {
  const sides = lod === 0 ? 7 : 4;
  const trunk = new CylinderGeometry(0.13, 0.22, 5.6, sides, lod === 0 ? 4 : 1).translate(0, 2.8, 0);
  const pos = trunk.getAttribute('position');
  for (let v = 0; v < pos.count; v++) {
    const t = pos.getY(v) / 5.6;
    pos.setX(v, pos.getX(v) + t * t * 0.7);
  }
  const fronds = lod === 0 ? palmFronds(8, 3.2, 3, 5.5) : palmFronds(5, 3, 1, 5.5);
  return merged([painted(trunk, TRUNK), ...fronds.map((f) => f.translate(0.7, 0, 0))]);
}

function broadleaf(lod: number): BufferGeometry {
  const trunk = painted(new CylinderGeometry(0.2, 0.34, 3, lod === 0 ? 7 : 4).translate(0, 1.5, 0), BARK_DARK);
  if (lod >= 2) return merged([trunk, painted(new IcosahedronGeometry(2.6, 0).scale(1.2, 0.7, 1.2).translate(0, 4, 0), LEAF)]);
  const detail = lod === 0 ? 1 : 0;
  return merged([
    trunk,
    painted(new IcosahedronGeometry(2.2, detail).scale(1.25, 0.72, 1.2).translate(0, 4.1, 0), LEAF),
    painted(new IcosahedronGeometry(1.6, detail).scale(1.2, 0.7, 1.1).translate(1.4, 3.6, 0.4), LEAF_LIGHT),
    painted(new IcosahedronGeometry(1.5, detail).scale(1.1, 0.7, 1.2).translate(-1.2, 3.8, -0.6), LEAF),
  ]);
}

function bush(lod: number): BufferGeometry {
  if (lod >= 1) return merged([painted(new IcosahedronGeometry(0.85, 0).scale(1.2, 0.65, 1.1).translate(0, 0.35, 0), LEAF)]);
  return merged([
    painted(new IcosahedronGeometry(0.8, 1).scale(1.1, 0.65, 1).translate(0, 0.35, 0), LEAF),
    painted(new IcosahedronGeometry(0.55, 1).scale(1, 0.7, 1).translate(0.6, 0.3, 0.2), LEAF_LIGHT),
  ]);
}

function reeds(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = 1.1 + (i % 3) * 0.35;
    parts.push(painted(new ConeGeometry(0.035, h, 3).translate(Math.cos(a) * 0.18, h / 2, Math.sin(a) * 0.18).rotateZ((i % 2 ? 1 : -1) * 0.08), i % 2 ? 0x6f8a3a : 0x587a30));
  }
  parts.push(painted(new CylinderGeometry(0.05, 0.05, 0.25, 4).translate(0.1, 1.5, 0), 0x5a3a22));
  return merged(parts);
}

function rock(lod: number): BufferGeometry {
  return merged([painted(new DodecahedronGeometry(0.7, lod === 0 ? 1 : 0).scale(1.3, 0.7, 1), 0x7d766e)]);
}

function fallenLog(): BufferGeometry {
  const parts = [painted(new CylinderGeometry(0.22, 0.28, 3.4, 7).rotateZ(Math.PI / 2).translate(0, 0.22, 0), BARK_DARK)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push(
      painted(
        new CylinderGeometry(0.03, 0.08, 0.9, 4).rotateZ(Math.PI / 2 - 0.4).rotateY(a).translate(1.75 + Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.25),
        TRUNK,
      ),
    );
  }
  return merged(parts);
}

function leafLitter(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const tones = [0x8a6a32, 0x6e5a2a, 0x9a7a3a, 0x5f6a2a];
  for (let i = 0; i < 6; i++) {
    const a = i * 2.39;
    parts.push(painted(new PlaneGeometry(0.22, 0.12).rotateX(-Math.PI / 2).rotateY(a).translate(Math.cos(a) * 0.35 * (i % 3), 0.04, Math.sin(a) * 0.3 * (i % 2)), tones[i % 4] ?? 0x8a6a32));
  }
  return merged(parts);
}

function flower(): BufferGeometry {
  return merged([
    painted(new CylinderGeometry(0.012, 0.012, 0.28, 3).translate(0, 0.14, 0), 0x4a7a2e),
    painted(new ConeGeometry(0.09, 0.14, 5).rotateX(Math.PI).translate(0, 0.32, 0), 0xe86a8a),
  ]);
}

function buildSpecies(r: number): SpeciesSpec[] {
  const rule = (count: number, minDistance: number, maxDistance: number, maxHeight: number, minScale = 0.7, maxScale = 1.4): ScatterRule => ({
    count,
    minDistance,
    maxDistance,
    maxHeight,
    minScale,
    maxScale,
  });
  return [
    { kind: 'palm', rule: rule(120, r * 1.3, 120, 18, 0.75, 1.35), lods: [palm(0), palm(1)], lodDistances: [55, 190], sway: 1, castShadow: true, roughness: 0.85 },
    { kind: 'broadleaf', rule: rule(260, r * 1.5, 170, 32), lods: [broadleaf(0), broadleaf(1), broadleaf(2)], lodDistances: [50, 110, 230], sway: 0.5, castShadow: true, roughness: 0.9 },
    { kind: 'bush', rule: rule(320, r * 1.2, 120, 22), lods: [bush(0), bush(1)], lodDistances: [45, 140], sway: 0.7, castShadow: false, roughness: 0.95 },
    { kind: 'reed', rule: rule(260, r * 1.02, r * 1.3, 2.5, 0.8, 1.3), lods: [reeds()], lodDistances: [80], sway: 1.6, castShadow: false, roughness: 0.8 },
    { kind: 'rock', rule: rule(140, r * 1.05, 170, 60, 0.6, 1.8), lods: [rock(0), rock(1)], lodDistances: [50, 220], sway: 0, castShadow: false, roughness: 0.85 },
    { kind: 'log', rule: rule(36, r * 1.15, 90, 14, 0.8, 1.3), lods: [fallenLog()], lodDistances: [110], sway: 0, castShadow: false, roughness: 1 },
    { kind: 'leaf-litter', rule: rule(500, r * 1.1, 70, 10, 0.8, 1.5), lods: [leafLitter()], lodDistances: [60], sway: 0, castShadow: false, roughness: 1 },
    { kind: 'flower', rule: rule(600, r * 1.25, 80, 8), lods: [flower()], lodDistances: [60], sway: 2, castShadow: false, roughness: 0.6 },
  ];
}
