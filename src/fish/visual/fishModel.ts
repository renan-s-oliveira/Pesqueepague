import {
  Bone,
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LOD,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Shape,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector2,
  type Material,
} from 'three';
import { getSpecies, type SpeciesId, type SpeciesVisual } from '../species.ts';
import { HUE_SHIFT_MAX_DEG, LIGHTNESS_SHIFT_MAX, type CatchRecord, type ColorVariation } from '../../progression/types.ts';
import { Rng } from '../../utils/rng.ts';
import { acquireFishTextures, releaseFishTextures } from './fishTextures.ts';

/** Ossos da coluna, do focinho ao pedúnculo caudal. Além deles: mandíbula e dois opérculos. */
export const SPINE_BONES = 6;
export const JAW_BONE = 'jaw';
export const OPERCLE_LEFT_BONE = 'opercle_L';
export const OPERCLE_RIGHT_BONE = 'opercle_R';

export interface FishLodLevel {
  /** Seções transversais ao longo do corpo. */
  readonly rings: number;
  /** Vértices por seção. */
  readonly radial: number;
}

/** Nível 0 de perto, nível 1 a partir de FISH_LOD_SWITCH_M. */
export const FISH_LODS: readonly [FishLodLevel, FishLodLevel] = [
  { rings: 48, radial: 28 },
  { rings: 14, radial: 10 },
];
export const FISH_LOD_SWITCH_M = 3;

/** Triângulos do corpo: faixas entre seções mais as tampas do focinho e do pedúnculo. */
export function bodyTriangleCount(lod: FishLodLevel): number {
  return (lod.rings - 1) * lod.radial * 2 + 2 * lod.radial;
}

type CaudalShape = 'forked' | 'truncate' | 'rounded';

interface FinSpan {
  /** Início e fim no corpo (0 = focinho, 1 = pedúnculo). */
  readonly from: number;
  readonly to: number;
  /** Altura relativa à altura do corpo. */
  readonly height: number;
}

/** Anatomia que completa as proporções de species.ts. */
interface Anatomy {
  /** Largura da seção relativa à altura (peixe comprimido < 0,5). */
  readonly widthRatio: number;
  /** Onde o corpo é mais alto (0..1 do corpo). */
  readonly peakAt: number;
  /** Altura do pedúnculo relativa à altura máxima. */
  readonly peduncle: number;
  readonly caudal: CaudalShape;
  readonly dorsal: readonly FinSpan[];
  readonly anal: FinSpan;
  /** Raio do olho relativo ao comprimento total. */
  readonly eyeRadius: number;
  readonly iris: string;
  readonly iridescence: number;
  readonly sheen: number;
}

const ANATOMY: Readonly<Record<SpeciesId, Anatomy>> = {
  // Characidae prateado: corpo alto e comprimido, olho grande, nadadeira caudal bifurcada, anal longa.
  lambari: {
    widthRatio: 0.4,
    peakAt: 0.38,
    peduncle: 0.28,
    caudal: 'forked',
    dorsal: [{ from: 0.44, to: 0.56, height: 0.45 }],
    anal: { from: 0.6, to: 0.9, height: 0.24 },
    eyeRadius: 0.04,
    iris: '#d8cfa8',
    iridescence: 0.7,
    sheen: 0.3,
  },
  // Ciclídeo de corpo alto, dorsal longa e contínua, caudal truncada.
  tilapia: {
    widthRatio: 0.42,
    peakAt: 0.42,
    peduncle: 0.34,
    caudal: 'truncate',
    dorsal: [{ from: 0.3, to: 0.9, height: 0.3 }],
    anal: { from: 0.66, to: 0.9, height: 0.28 },
    eyeRadius: 0.03,
    iris: '#c9a640',
    iridescence: 0.25,
    sheen: 0.5,
  },
  // Predador alongado e mais roliço, cabeça grande, dorsal em duas partes, caudal arredondada.
  tucunare: {
    widthRatio: 0.52,
    peakAt: 0.45,
    peduncle: 0.32,
    caudal: 'rounded',
    dorsal: [
      { from: 0.3, to: 0.56, height: 0.32 },
      { from: 0.58, to: 0.88, height: 0.36 },
    ],
    anal: { from: 0.68, to: 0.9, height: 0.26 },
    eyeRadius: 0.028,
    iris: '#c0301e',
    iridescence: 0.1,
    sheen: 0.4,
  },
};

export interface FishModelOptions {
  /** Semente do indivíduo (use seedFromCatchRecord para uma captura). */
  readonly seed: number;
  /** Comprimento total em metros. */
  readonly lengthM?: number;
  /** Variação de cor do indivíduo; ausente, sai da semente. */
  readonly color?: ColorVariation;
}

export interface FishProportions {
  readonly length: number;
  readonly bodyLength: number;
  readonly depth: number;
  readonly width: number;
  readonly depthRatio: number;
  readonly widthRatio: number;
}

/** Semente estável (FNV-1a) a partir do id da captura. */
export function seedFromCatchRecord(record: Pick<CatchRecord, 'id'>): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < record.id.length; i++) {
    h ^= record.id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Frame {
  readonly L: number;
  readonly D: number;
  readonly bodyLen: number;
  readonly xSnout: number;
  readonly headS: number;
  readonly widthRatio: number;
  readonly anat: Anatomy;
  readonly visual: SpeciesVisual;
}

interface Section {
  top: number;
  bottom: number;
  width: number;
  cy: number;
}

/** Altura normalizada da seção ao longo do corpo. */
function heightAt(a: Anatomy, s: number): number {
  if (s < a.peakAt) return 0.16 + 0.84 * Math.sin((Math.PI / 2) * (s / a.peakAt)) ** 0.85;
  const u = (s - a.peakAt) / (1 - a.peakAt);
  return a.peduncle + (1 - a.peduncle) * Math.cos((Math.PI / 2) * u) ** 1.3;
}

function sectionAt(f: Frame, s: number, out: Section): Section {
  const h = heightAt(f.anat, s) * f.D * 0.5;
  out.top = h;
  out.bottom = h * 0.95;
  out.width = h * f.widthRatio * (s < 0.6 ? 1 : 1 - (0.35 * (s - 0.6)) / 0.4);
  out.cy = s < f.anat.peakAt ? -0.05 * f.D * (1 - s / f.anat.peakAt) : 0;
  return out;
}

function boneX(f: Frame, i: number): number {
  return f.xSnout - (i / (SPINE_BONES - 1)) * f.bodyLen;
}

const JAW_INDEX = SPINE_BONES;
const OPERCLE_L_INDEX = SPINE_BONES + 1;
const OPERCLE_R_INDEX = SPINE_BONES + 2;

function pushSkin(f: Frame, s: number, sin: number, cos: number, idx: number[], wts: number[]): void {
  const fi = Math.min(SPINE_BONES - 1, Math.max(0, s * (SPINE_BONES - 1)));
  const i = Math.min(SPINE_BONES - 2, Math.floor(fi));
  const t = fi - i;
  let special = 0;
  let ws = 0;
  const jawEnd = f.headS * 0.3;
  if (s < jawEnd && sin < 0) {
    ws = (1 - s / jawEnd) * Math.min(1, -sin * 2);
    special = JAW_INDEX;
  } else if (s > f.headS * 0.6 && s < f.headS * 1.1 && Math.abs(sin) < 0.7) {
    const k = Math.max(0, 1 - Math.abs((s - f.headS * 0.85) / (f.headS * 0.25)));
    ws = k * 0.8 * (1 - Math.abs(sin) / 0.7);
    special = cos > 0 ? OPERCLE_R_INDEX : OPERCLE_L_INDEX;
  }
  idx.push(i, i + 1, special, 0);
  wts.push((1 - t) * (1 - ws), t * (1 - ws), ws, 0);
}

/** Corpo por loft de seções transversais, com pesos de pele na coluna, mandíbula e opérculos. */
function buildBody(f: Frame, lod: FishLodLevel): BufferGeometry {
  const { rings: R, radial: M } = lod;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const wts: number[] = [];
  const sec: Section = { top: 0, bottom: 0, width: 0, cy: 0 };
  for (let r = 0; r < R; r++) {
    const s = r / (R - 1);
    sectionAt(f, s, sec);
    const x = f.xSnout - s * f.bodyLen;
    for (let j = 0; j <= M; j++) {
      const th = (Math.PI * 2 * j) / M;
      const sin = Math.sin(th);
      const cos = Math.cos(th);
      pos.push(x, sec.cy + (sin >= 0 ? sec.top : sec.bottom) * sin, sec.width * cos);
      uv.push(s, j / M);
      pushSkin(f, s, sin, cos, idx, wts);
    }
  }
  const tip = R * (M + 1);
  sectionAt(f, 0, sec);
  pos.push(f.xSnout + 0.012 * f.L, sec.cy, 0);
  uv.push(0, 0.5);
  pushSkin(f, 0, 0, 1, idx, wts);
  const tail = tip + 1;
  pos.push(f.xSnout - f.bodyLen, 0, 0);
  uv.push(1, 0.5);
  pushSkin(f, 1, 0, 1, idx, wts);

  const index: number[] = [];
  for (let r = 0; r < R - 1; r++) {
    for (let j = 0; j < M; j++) {
      const a = r * (M + 1) + j;
      const b = a + M + 1;
      const c = a + 1;
      const d = b + 1;
      index.push(a, c, b, c, d, b);
    }
  }
  const last = (R - 1) * (M + 1);
  for (let j = 0; j < M; j++) {
    index.push(tip, j + 1, j);
    index.push(tail, last + j, last + j + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(wts, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Nadadeira com espessura real (extrusão fina do contorno). */
function finGeometry(shape: Shape, thickness: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -thickness / 2);
  return g;
}

function medianFinShape(f: Frame, span: FinSpan, up: boolean): Shape {
  const sec: Section = { top: 0, bottom: 0, width: 0, cy: 0 };
  const sign = up ? 1 : -1;
  const xa = f.xSnout - span.from * f.bodyLen;
  const xb = f.xSnout - span.to * f.bodyLen;
  sectionAt(f, span.from, sec);
  const ya = sec.cy + sign * (up ? sec.top : sec.bottom) * 0.9;
  sectionAt(f, span.to, sec);
  const yb = sec.cy + sign * (up ? sec.top : sec.bottom) * 0.9;
  const H = span.height * f.D * sign;
  const w = xa - xb;
  const shape = new Shape();
  shape.moveTo(xa, ya);
  shape.lineTo(xa - 0.2 * w, ya + H);
  shape.lineTo(xb + 0.05 * w, yb + H * 0.6);
  shape.quadraticCurveTo(xb - 0.05 * w, yb + H * 0.3, xb - 0.1 * w, yb);
  shape.lineTo(xa, ya);
  return shape;
}

function caudalShape(f: Frame): Shape {
  const x0 = f.xSnout - f.bodyLen + 0.01 * f.L;
  const hp = heightAt(f.anat, 1) * f.D * 0.45;
  const C = f.visual.proportions.caudalLength * f.L;
  const Hc = f.D * 0.42;
  const s = new Shape();
  s.moveTo(x0, hp);
  if (f.anat.caudal === 'forked') {
    s.lineTo(x0 - C, Hc);
    s.quadraticCurveTo(x0 - C * 0.75, Hc * 0.3, x0 - C * 0.5, 0);
    s.quadraticCurveTo(x0 - C * 0.75, -Hc * 0.3, x0 - C, -Hc);
  } else {
    const tip = f.anat.caudal === 'truncate' ? 0.92 : 0.78;
    const bulge = f.anat.caudal === 'truncate' ? 1.02 : 1.18;
    s.lineTo(x0 - C * tip, Hc);
    s.quadraticCurveTo(x0 - C * bulge, 0, x0 - C * tip, -Hc);
  }
  s.lineTo(x0, -hp);
  s.lineTo(x0, hp);
  return s;
}

function pectoralShape(L: number): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.09 * L, 0.018 * L);
  s.quadraticCurveTo(-0.115 * L, -0.008 * L, -0.085 * L, -0.028 * L);
  s.lineTo(0, -0.012 * L);
  s.lineTo(0, 0);
  return s;
}

/** Cúpula (meia esfera achatada) com o eixo em +z, por torno. */
function domeGeometry(radius: number, depth: number): BufferGeometry {
  const pts: Vector2[] = [];
  for (let k = 0; k <= 8; k++) {
    const phi = (k / 8) * (Math.PI / 2);
    pts.push(new Vector2(radius * Math.sin(phi), depth * Math.cos(phi)));
  }
  const g = new LatheGeometry(pts, 20);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Peixe procedural de uma espécie: corpo em SkinnedMesh com LOD de dois níveis, coluna de ossos,
 * mandíbula e opérculos animáveis, nadadeiras com espessura, olhos com íris e córnea.
 */
export class FishModel {
  readonly root = new Group();
  readonly lod = new LOD();
  readonly skeleton: Skeleton;
  readonly bodies: readonly SkinnedMesh[];
  readonly speciesId: SpeciesId;
  readonly lengthM: number;
  private readonly spine: readonly Bone[];
  private readonly jaw: Bone;
  private readonly opercleL: Bone;
  private readonly opercleR: Bone;
  private readonly bodyMaterial: MeshPhysicalMaterial;
  private readonly baseTint: Color;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private wet = 1;
  private disposed = false;

  constructor(speciesId: SpeciesId, options: FishModelOptions) {
    const species = getSpecies(speciesId);
    const anat = ANATOMY[speciesId];
    const rng = new Rng(options.seed >>> 0);
    const L = options.lengthM ?? 0.3;
    if (!(Number.isFinite(L) && L > 0)) throw new RangeError(`lengthM deve ser > 0; recebido: ${String(L)}`);
    const depthJitter = rng.range(0.97, 1.03);
    const widthJitter = rng.range(0.96, 1.04);
    const color: ColorVariation = options.color ?? {
      hueShiftDeg: rng.range(-HUE_SHIFT_MAX_DEG, HUE_SHIFT_MAX_DEG),
      lightnessShift: rng.range(-LIGHTNESS_SHIFT_MAX, LIGHTNESS_SHIFT_MAX),
      spotSeed: rng.int(0, 0xffffffff),
    };
    this.speciesId = speciesId;
    this.lengthM = L;
    const p = species.visual.proportions;
    const bodyLen = (1 - p.caudalLength) * L;
    const f: Frame = {
      L,
      D: p.bodyDepth * L * depthJitter,
      bodyLen,
      xSnout: L / 2,
      headS: p.headLength / (1 - p.caudalLength),
      widthRatio: anat.widthRatio * widthJitter,
      anat,
      visual: species.visual,
    };

    // Coluna em cadeia (posições relativas ao osso pai), mais mandíbula e opérculos no osso da cabeça.
    const spine: Bone[] = [];
    for (let i = 0; i < SPINE_BONES; i++) {
      const b = new Bone();
      b.name = `spine_${i}`;
      const parent = spine[i - 1];
      if (parent) {
        b.position.set(boneX(f, i) - boneX(f, i - 1), 0, 0);
        parent.add(b);
      } else {
        b.position.set(boneX(f, 0), 0, 0);
      }
      spine.push(b);
    }
    const head = spine[0] as Bone;
    const sec: Section = { top: 0, bottom: 0, width: 0, cy: 0 };
    const jaw = new Bone();
    jaw.name = JAW_BONE;
    jaw.position.set(-f.headS * 0.3 * bodyLen, -0.12 * f.D, 0);
    sectionAt(f, f.headS * 0.62, sec);
    const opL = new Bone();
    opL.name = OPERCLE_LEFT_BONE;
    opL.position.set(-f.headS * 0.62 * bodyLen, 0, -0.8 * sec.width);
    const opR = new Bone();
    opR.name = OPERCLE_RIGHT_BONE;
    opR.position.set(-f.headS * 0.62 * bodyLen, 0, 0.8 * sec.width);
    head.add(jaw, opL, opR);
    this.spine = spine;
    this.jaw = jaw;
    this.opercleL = opL;
    this.opercleR = opR;
    this.root.add(head, this.lod);
    this.root.updateMatrixWorld(true);
    this.skeleton = new Skeleton([...spine, jaw, opL, opR]);

    const tex = acquireFishTextures(speciesId);
    this.baseTint = new Color(1, 1, 1).multiplyScalar(1 + color.lightnessShift * 2);
    // A textura é por espécie; o matiz do indivíduo puxa a tinta para um tom quente ou frio.
    const hueTarget = new Color().setHSL(color.hueShiftDeg >= 0 ? 0.11 : 0.55, 0.6, 0.6);
    this.baseTint.lerp(hueTarget, (Math.abs(color.hueShiftDeg) / HUE_SHIFT_MAX_DEG) * 0.15);
    this.bodyMaterial = new MeshPhysicalMaterial({
      map: tex.albedo,
      normalMap: tex.normal,
      normalScale: new Vector2(0.6, 0.6),
      roughnessMap: tex.roughness,
      roughness: 1,
      metalness: 0.05,
      color: this.baseTint.clone(),
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: anat.sheen,
      sheenRoughness: 0.4,
      sheenColor: new Color(species.visual.palette.flank),
      iridescence: anat.iridescence,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [180, 420],
    });
    this.materials.push(this.bodyMaterial);

    const bodies: SkinnedMesh[] = [];
    FISH_LODS.forEach((level, i) => {
      const geometry = buildBody(f, level);
      this.geometries.push(geometry);
      const mesh = new SkinnedMesh(geometry, this.bodyMaterial);
      mesh.name = `body_lod${i}`;
      mesh.castShadow = true;
      mesh.bind(this.skeleton, new Matrix4());
      this.lod.addLevel(mesh, i === 0 ? 0 : FISH_LOD_SWITCH_M);
      bodies.push(mesh);
    });
    this.bodies = bodies;

    const finMaterial = new MeshPhysicalMaterial({
      color: new Color(species.visual.palette.fin),
      roughness: 0.45,
      transmission: 0.35,
      thickness: 0.002,
      opacity: 0.82,
      alphaHash: true,
      side: DoubleSide,
      clearcoat: 0.6,
    });
    this.materials.push(finMaterial);
    const thickness = 0.006 * L;
    const attach = (geometry: BufferGeometry, s: number): void => {
      const i = Math.min(SPINE_BONES - 1, Math.round(s * (SPINE_BONES - 1)));
      const mesh = new Mesh(geometry, finMaterial);
      mesh.position.set(-boneX(f, i), 0, 0);
      this.geometries.push(geometry);
      (spine[i] as Bone).add(mesh);
    };
    for (const span of anat.dorsal) attach(finGeometry(medianFinShape(f, span, true), thickness), (span.from + span.to) / 2);
    attach(finGeometry(medianFinShape(f, anat.anal, false), thickness), (anat.anal.from + anat.anal.to) / 2);
    attach(finGeometry(caudalShape(f), thickness), 1);

    sectionAt(f, f.headS * 1.05, sec);
    const pectoral = finGeometry(pectoralShape(L), thickness);
    this.geometries.push(pectoral);
    for (const side of [1, -1]) {
      const fin = new Mesh(pectoral, finMaterial);
      fin.position.set(-f.headS * 1.05 * bodyLen, sec.cy - 0.35 * sec.bottom, side * 0.9 * sec.width);
      fin.rotation.set(side * 0.9, side * -0.35, 0);
      head.add(fin);
    }

    this.buildEyes(f, anat, head, sec);
    this.root.updateMatrixWorld(true);
    this.setWetness(1);
  }

  private buildEyes(f: Frame, anat: Anatomy, head: Bone, sec: Section): void {
    const r = anat.eyeRadius * f.L;
    const iris = new CircleGeometry(r, 24);
    const pupil = new CircleGeometry(r * 0.45, 16);
    const cornea = domeGeometry(r * 1.05, r * 0.45);
    this.geometries.push(iris, pupil, cornea);
    const irisMat = new MeshPhysicalMaterial({ color: new Color(anat.iris), roughness: 0.35, metalness: 0.3, iridescence: 0.4 });
    const pupilMat = new MeshPhysicalMaterial({ color: 0x050505, roughness: 0.2 });
    const corneaMat = new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      transmission: 1,
      thickness: r * 0.4,
      ior: 1.376,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    this.materials.push(irisMat, pupilMat, corneaMat);
    const sEye = f.headS * 0.35;
    sectionAt(f, sEye, sec);
    for (const side of [1, -1]) {
      const eye = new Group();
      eye.name = side > 0 ? 'eye_R' : 'eye_L';
      eye.position.set(-sEye * f.bodyLen, sec.cy + sec.top * 0.38, side * sec.width * 0.9);
      if (side < 0) eye.rotation.y = Math.PI;
      const irisMesh = new Mesh(iris, irisMat);
      irisMesh.position.z = r * 0.12;
      const pupilMesh = new Mesh(pupil, pupilMat);
      pupilMesh.position.z = r * 0.14;
      eye.add(irisMesh, pupilMesh, new Mesh(cornea, corneaMat));
      head.add(eye);
    }
  }

  get wetness(): number {
    return this.wet;
  }

  /** 1 = recém-saído da água (brilho úmido), 0 = pele seca e fosca. Não aloca. */
  setWetness(value: number): void {
    const w = Math.min(1, Math.max(0, value));
    this.wet = w;
    const m = this.bodyMaterial;
    m.roughness = 1 - 0.3 * w;
    m.clearcoat = 0.15 + 0.85 * w;
    m.color.copy(this.baseTint).multiplyScalar(1 - 0.1 * w);
  }

  /** Ondulação da coluna, respiração dos opérculos e boca. `swim` em [0, 1]. Não aloca. */
  animate(time: number, swim: number): void {
    for (let i = 1; i < this.spine.length; i++) {
      const bone = this.spine[i] as Bone;
      bone.rotation.y = swim * 0.18 * (i / (SPINE_BONES - 1)) * Math.sin(time * 7 - i * 0.9);
    }
    const breath = 0.5 + 0.5 * Math.sin(time * 2.4);
    this.jaw.rotation.z = -0.3 * breath;
    const flare = 0.35 * (0.5 + 0.5 * Math.sin(time * 2.4 - 0.6));
    this.opercleR.rotation.y = flare;
    this.opercleL.rotation.y = -flare;
  }

  /** Medidas do corpo na pose de repouso (nível de LOD mais detalhado). */
  proportions(): FishProportions {
    const box = new Box3().setFromBufferAttribute((this.bodies[0] as SkinnedMesh).geometry.getAttribute('position') as Float32BufferAttribute);
    const depth = box.max.y - box.min.y;
    const width = box.max.z - box.min.z;
    return {
      length: this.lengthM,
      bodyLength: box.max.x - box.min.x,
      depth,
      width,
      depthRatio: depth / this.lengthM,
      widthRatio: width / depth,
    };
  }

  /** Libera geometrias, materiais e a referência às texturas da espécie. Pode ser chamado mais de uma vez. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.skeleton.dispose();
    releaseFishTextures(this.speciesId);
  }
}
