import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import type { QualityLevel } from '../engine/GraphicsQualityManager.ts';
import { Rng } from '../utils/rng.ts';
import { LAKE, LAKE_BED, distanceToLakeCenter, isOnPier } from './layout.ts';
import { createNoise2D, fbm, smoothstep } from './noise.ts';
import type { HeightField } from './terrain.ts';

/** Profundidade da água (m, ≥ 0) e altura do leito por posição; a AI dos peixes consulta `depthAt`. */
export interface DepthField {
  depthAt(x: number, z: number): number;
  bedHeightAt(x: number, z: number): number;
}

const DEPTH_SEED_SALT = 0x1b873593;
const PLACEMENT_SEED_SALT = 0x68e31da4;
/** O leito escondido fica abaixo do terreno para não brigar no z-buffer com ele. */
const HIDDEN_BED_OFFSET = 0.25;
const BED_SEGMENTS = 120;
/** Metros de água até a luz cair a ~37%: rege cor do leito, cáusticas e partículas. */
const CLARITY_M = 1.6;
const MAX_WEEDS = 700;
const MAX_SUSPENDED = 600;
const MAX_SEDIMENT = 300;

/** Intensidade das cáusticas e densidade da vegetação aquática por preset. */
const UNDERWATER_QUALITY: Readonly<Record<QualityLevel, { caustics: number; causticScale: number; weeds: number }>> = {
  low: { caustics: 0.35, causticScale: 0.7, weeds: 0.35 },
  medium: { caustics: 0.6, causticScale: 0.85, weeds: 0.65 },
  high: { caustics: 0.85, causticScale: 1, weeds: 1 },
  ultra: { caustics: 1, causticScale: 1.15, weeds: 1 },
};

/**
 * Leito do lago determinístico pela seed: perfil radial em torno de LAKE com ondulações de ruído,
 * nunca abaixo da bacia do terreno (o leito é o mais alto dos dois).
 */
export function createDepthField(seed: number, terrainHeightAt: HeightField): DepthField {
  const noise = createNoise2D(new Rng((seed ^ DEPTH_SEED_SALT) >>> 0));
  const r = LAKE.radius;
  const bedHeightAt = (x: number, z: number): number => {
    const terrain = terrainHeightAt(x, z);
    const d = distanceToLakeCenter(x, z);
    const radial = 1 - smoothstep(r * 0.15, LAKE_BED.rimRadius * 0.96, d);
    const swell = 0.8 + 0.2 * fbm(noise, x * 0.08, z * 0.08, 3);
    const channel = 0.25 * Math.max(0, fbm(noise, x * 0.03 + 11, z * 0.03 - 5, 2)) * radial;
    const profile = Math.min(LAKE_BED.maxDepth, LAKE_BED.maxDepth * radial * swell + channel);
    return Math.max(terrain, LAKE.waterLevel - profile);
  };
  return {
    bedHeightAt,
    depthAt: (x, z) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      return Math.max(0, LAKE.waterLevel - bedHeightAt(x, z));
    },
  };
}

/** Fração de luz/visibilidade que chega a `depth` metros, em (0, 1]. */
export function visibilityAt(depth: number): number {
  return Math.exp(-Math.max(0, Number.isFinite(depth) ? depth : 0) / CLARITY_M);
}

const causticVertex = /* glsl */ `
attribute float aDepth;
varying vec3 vWorld;
varying float vDepth;
varying float vViewDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vDepth = aDepth;
  vec4 mv = viewMatrix * world;
  vViewDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const causticFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform float uClarity;
uniform float uDaylight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vWorld;
varying float vDepth;
varying float vViewDist;
void main() {
  // A luz chega inclinada: o padrão é projetado no leito ao longo da direção do sol.
  vec2 sunSlope = uSunDir.xz / max(0.2, uSunDir.y);
  vec2 q = (vWorld.xz + sunSlope * vDepth) * 0.9 * uScale;
  float t = uTime * 0.55;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += 0.55 * vec2(sin(q.y * 1.3 + t + fi * 1.7), sin(q.x * 1.1 - t * 1.2 + fi * 2.3));
  }
  float v = 0.5 + 0.25 * (sin(q.x * 1.9) + sin(q.y * 1.9));
  float c = pow(clamp(v, 0.0, 1.0), 5.0);
  float light = uIntensity * uDaylight * exp(-vDepth / uClarity) * smoothstep(0.02, 0.2, vDepth);
  float fade = 1.0 - smoothstep(25.0, 60.0, vViewDist);
  gl_FragColor = vec4(uSunColor * c * light * fade, 1.0);
}
`;

const particleVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uSize;
uniform float uDrift;
uniform float uClarity;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.21 + aSeed * 6.283) * uDrift;
  p.y += sin(uTime * 0.13 + aSeed * 12.0) * uDrift * 0.4;
  p.z += cos(uTime * 0.17 + aSeed * 9.0) * uDrift;
  p.y = min(p.y, -0.05);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(1.0, -mv.z);
  gl_PointSize = uSize * (0.5 + aSeed) * 30.0 / dist;
  vAlpha = (1.0 - smoothstep(10.0, 40.0, dist)) * exp(p.y / uClarity) * 0.6;
}
`;

const particleFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export interface UnderwaterStats {
  readonly bedVertices: number;
  readonly rocks: number;
  readonly logs: number;
  readonly roots: number;
  readonly weeds: number;
  readonly suspendedParticles: number;
  readonly sediment: number;
  readonly causticsIntensity: number;
  readonly maxDepth: number;
}

interface BedSpot {
  x: number;
  y: number;
  z: number;
  depth: number;
}

/**
 * Fundo do lago: leito com profundidade variável, pedras, troncos, raízes, vegetação instanciada com
 * balanço, sedimentos e partículas em suspensão, cáusticas animadas. Tudo é posicionado uma vez; o
 * frame só atualiza uniforms (não aloca).
 */
export class Underwater {
  readonly group = new Group();
  readonly depthAt: (x: number, z: number) => number;
  readonly bedHeightAt: (x: number, z: number) => number;
  private readonly time: IUniform<number> = { value: 0 };
  private readonly causticMaterial: ShaderMaterial;
  private readonly weeds: InstancedMesh;
  private readonly weedMax: number;
  private readonly suspended: Points<BufferGeometry, ShaderMaterial>;
  private readonly sediment: Points<BufferGeometry, ShaderMaterial>;
  private readonly bedVertices: number;
  private readonly counts: { rocks: number; logs: number; roots: number };
  private maxDepth = 0;
  private particleBudget = 1;

  constructor(seed: number, terrainHeightAt: HeightField) {
    const field = createDepthField(seed, terrainHeightAt);
    this.depthAt = field.depthAt;
    this.bedHeightAt = field.bedHeightAt;
    this.group.name = 'underwater';
    const rng = new Rng((seed ^ PLACEMENT_SEED_SALT) >>> 0);

    const bedGeometry = this.buildBed(terrainHeightAt);
    this.bedVertices = bedGeometry.getAttribute('position').count;
    const bed = new Mesh(bedGeometry, new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    bed.name = 'lake-bed';
    bed.receiveShadow = true;

    this.causticMaterial = new ShaderMaterial({
      uniforms: {
        uTime: this.time,
        uIntensity: { value: 1 },
        uScale: { value: 1 },
        uClarity: { value: CLARITY_M },
        uDaylight: { value: 1 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(1, 0.95, 0.85) },
      },
      vertexShader: causticVertex,
      fragmentShader: causticFragment,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const caustics = new Mesh(bedGeometry, this.causticMaterial);
    caustics.name = 'lake-caustics';
    caustics.renderOrder = -1;

    const spots = (count: number, minDepth: number, maxDistance: number): BedSpot[] => this.scatter(rng, count, minDepth, maxDistance);

    const rockSpots = spots(70, 0.15, LAKE_BED.rimRadius);
    const rocks = instanced('lake-rocks', new DodecahedronGeometry(0.45, 0).scale(1.3, 0.6, 1), new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), rockSpots, [0x4f4a43, 0x5d564c, 0x3f3b36], (s, dummy) => {
      dummy.position.set(s.x, s.y + 0.05, s.z);
      dummy.rotation.set(rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3));
      dummy.scale.setScalar(rng.range(0.5, 1.8));
    });

    const logSpots = spots(9, 0.6, LAKE.radius * 0.9);
    const logs = instanced('lake-logs', new CylinderGeometry(0.18, 0.24, 1, 7).rotateZ(Math.PI / 2), new MeshStandardMaterial({ roughness: 1 }), logSpots, [0x3a2c1e, 0x2f2418], (s, dummy) => {
      dummy.position.set(s.x, s.y + 0.15, s.z);
      dummy.rotation.set(rng.range(-0.15, 0.15), rng.range(0, Math.PI * 2), rng.range(-0.12, 0.12));
      dummy.scale.set(rng.range(2.5, 5), 1, 1);
    });

    const rootSpots = this.scatter(rng, 50, 0.05, LAKE_BED.rimRadius, LAKE.radius * 0.75);
    const roots = instanced('lake-roots', new ConeGeometry(0.07, 1.6, 5).translate(0, 0.8, 0), new MeshStandardMaterial({ roughness: 1 }), rootSpots, [0x3b2e22, 0x4a3828], (s, dummy) => {
      const toCenter = Math.atan2(LAKE.centerX - s.x, LAKE.centerZ - s.z);
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(rng.range(1.0, 1.35), toCenter + rng.range(-0.5, 0.5), 0, 'YXZ');
      dummy.scale.set(1, rng.range(0.7, 1.5), 1);
    });

    const weedSpots = spots(MAX_WEEDS, 0.35, LAKE_BED.rimRadius);
    this.weeds = instanced('lake-weeds', new ConeGeometry(0.05, 1, 4, 5).translate(0, 0.5, 0), this.createWeedMaterial(), weedSpots, [0x2f5a2a, 0x3d6b2e, 0x4a7a35, 0x29502c], (s, dummy) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      const height = Math.min(rng.range(0.4, 1.6), s.depth * 0.85);
      dummy.scale.set(rng.range(0.7, 1.4), height, rng.range(0.7, 1.4));
    });
    this.weedMax = weedSpots.length;

    this.suspended = this.createParticles('suspended-particles', rng, MAX_SUSPENDED, false, 0xc8d6c4, 0.06, 0.35);
    this.sediment = this.createParticles('sediment', rng, MAX_SEDIMENT, true, 0x8a7a5c, 0.08, 0.12);

    this.counts = { rocks: rockSpots.length, logs: logSpots.length, roots: rootSpots.length };
    this.group.add(bed, caustics, rocks, logs, roots, this.weeds, this.suspended, this.sediment);
    this.setQuality('high', 1);
  }

  /** Cáusticas e densidade da vegetação pelo preset; partículas pela fração do orçamento em [0, 1]. */
  setQuality(level: QualityLevel, particleBudget: number): void {
    const q = UNDERWATER_QUALITY[level];
    this.particleBudget = Number.isFinite(particleBudget) ? Math.min(1, Math.max(0, particleBudget)) : 1;
    setUniform(this.causticMaterial, 'uIntensity', q.caustics);
    setUniform(this.causticMaterial, 'uScale', q.causticScale);
    this.weeds.count = Math.floor(this.weedMax * q.weeds);
    this.suspended.geometry.setDrawRange(0, Math.floor(MAX_SUSPENDED * this.particleBudget));
    this.sediment.geometry.setDrawRange(0, Math.floor(MAX_SEDIMENT * this.particleBudget));
  }

  /** Luz que desce para as cáusticas: direção (unitária, apontando para o sol), cor e quanto é dia. */
  setLight(direction: Vector3, color: Color, daylight: number): void {
    const u = this.causticMaterial.uniforms;
    (u['uSunDir']?.value as Vector3 | undefined)?.copy(direction);
    (u['uSunColor']?.value as Color | undefined)?.copy(color);
    setUniform(this.causticMaterial, 'uDaylight', Math.min(1, Math.max(0, daylight)));
  }

  update(elapsedSeconds: number): void {
    this.time.value = elapsedSeconds;
  }

  getStats(): UnderwaterStats {
    return {
      bedVertices: this.bedVertices,
      rocks: this.counts.rocks,
      logs: this.counts.logs,
      roots: this.counts.roots,
      weeds: this.weeds.count,
      suspendedParticles: this.suspended.geometry.drawRange.count,
      sediment: this.sediment.geometry.drawRange.count,
      causticsIntensity: (this.causticMaterial.uniforms['uIntensity']?.value as number | undefined) ?? 0,
      maxDepth: this.maxDepth,
    };
  }

  private buildBed(terrainHeightAt: HeightField): PlaneGeometry {
    const size = LAKE_BED.rimRadius * 2;
    const geometry = new PlaneGeometry(size, size, BED_SEGMENTS, BED_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(LAKE.centerX, 0, LAKE.centerZ);
    const position = geometry.getAttribute('position');
    const depths = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const terrain = terrainHeightAt(x, z);
      const bed = this.bedHeightAt(x, z);
      const visible = bed > terrain + 0.03 && bed < LAKE.waterLevel;
      position.setY(i, visible ? bed : terrain - HIDDEN_BED_OFFSET);
      const depth = visible ? LAKE.waterLevel - bed : 0;
      depths[i] = depth;
      if (depth > this.maxDepth) this.maxDepth = depth;
    }
    geometry.setAttribute('aDepth', new BufferAttribute(depths, 1));
    geometry.computeVertexNormals();

    const sand = new Color(0xb59d72);
    const mud = new Color(0x5a5038);
    const murk = new Color(0x22403c);
    const color = new Color();
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const depth = depths[i] ?? 0;
      color.copy(sand).lerp(mud, smoothstep(0.2, 1.8, depth));
      color.lerp(murk, 1 - visibilityAt(depth));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
  }

  /** Pontos do leito com profundidade mínima, dentro do anel [minDistance, maxDistance] em volta do lago. */
  private scatter(rng: Rng, count: number, minDepth: number, maxDistance: number, minDistance = 0): BedSpot[] {
    const out: BedSpot[] = [];
    for (let attempt = 0; attempt < count * 10 && out.length < count; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const distance = Math.sqrt(rng.range((minDistance / maxDistance) ** 2, 1)) * maxDistance;
      const x = LAKE.centerX + Math.cos(angle) * distance;
      const z = LAKE.centerZ + Math.sin(angle) * distance;
      if (isOnPier(x, z, 1)) continue;
      const depth = this.depthAt(x, z);
      if (depth < minDepth) continue;
      out.push({ x, y: this.bedHeightAt(x, z), z, depth });
    }
    return out;
  }

  /** Material padrão com balanço no vertex shader: mais forte na ponta, fase pela posição da instância. */
  private createWeedMaterial(): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ roughness: 0.8, flatShading: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = this.time;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  float swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
#else
  float swayPhase = 0.0;
#endif
  float swayBend = transformed.y * transformed.y;
  transformed.x += sin(uTime * 1.3 + swayPhase) * 0.14 * swayBend;
  transformed.z += cos(uTime * 1.05 + swayPhase * 1.7) * 0.09 * swayBend;`,
      );
    };
    return material;
  }

  /** Partículas na coluna d'água (ou rente ao leito, para sedimentos); a deriva é toda no shader. */
  private createParticles(name: string, rng: Rng, count: number, nearBed: boolean, hex: number, size: number, drift: number): Points<BufferGeometry, ShaderMaterial> {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const spots = this.scatter(rng, count, 0.3, LAKE.radius * 1.1);
    for (let i = 0; i < count; i++) {
      const s = spots[i % Math.max(1, spots.length)] ?? { x: LAKE.centerX, y: -1, z: LAKE.centerZ, depth: 1 };
      const y = nearBed ? s.y + rng.range(0.03, 0.35) : rng.range(s.y + 0.1, LAKE.waterLevel - 0.1);
      positions[i * 3] = s.x + rng.range(-0.5, 0.5);
      positions[i * 3 + 1] = Math.min(y, LAKE.waterLevel - 0.08);
      positions[i * 3 + 2] = s.z + rng.range(-0.5, 0.5);
      seeds[i] = rng.next();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    geometry.computeBoundingSphere();
    const material = new ShaderMaterial({
      uniforms: {
        uTime: this.time,
        uSize: { value: size },
        uDrift: { value: drift },
        uClarity: { value: CLARITY_M },
        uColor: { value: new Color(hex) },
      },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.name = name;
    points.renderOrder = -1;
    return points;
  }
}

function instanced(
  name: string,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  spots: readonly BedSpot[],
  palette: readonly number[],
  place: (spot: BedSpot, dummy: Object3D) => void,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, spots.length));
  mesh.name = name;
  mesh.receiveShadow = true;
  const dummy = new Object3D();
  const color = new Color();
  spots.forEach((s, i) => {
    dummy.rotation.order = 'XYZ';
    place(s, dummy);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.setHex(palette[i % palette.length] ?? 0xffffff).multiplyScalar(0.6 + 0.4 * visibilityAt(s.depth)));
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function setUniform(material: ShaderMaterial, name: string, value: number): void {
  const uniform = material.uniforms[name];
  if (uniform) uniform.value = value;
}
