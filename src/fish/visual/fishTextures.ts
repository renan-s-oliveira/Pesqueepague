import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type ColorSpace,
} from 'three';
import { getSpecies, type SpeciesId, type SpeciesVisual } from '../species.ts';

/**
 * Texturas procedurais da pele do peixe, geradas em código (nenhum arquivo é carregado).
 * Mapeamento UV do corpo: u vai do focinho (0) ao pedúnculo caudal (1); v dá a volta na seção,
 * com o dorso em v = 0,25 e o ventre em v = 0,75.
 */
export const FISH_TEXTURE_WIDTH = 256;
export const FISH_TEXTURE_HEIGHT = 128;
const SCALE_COLUMNS = 46;
const SCALE_ROWS = 20;
const NORMAL_STRENGTH = 2.2;

export interface FishTexturePixels {
  readonly width: number;
  readonly height: number;
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  readonly roughness: Uint8Array;
}

export interface FishTextureSet {
  readonly albedo: DataTexture;
  readonly normal: DataTexture;
  readonly roughness: DataTexture;
}

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Hash inteiro determinístico em [0, 1) para a variação de cada escama. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

interface ScaleSample {
  readonly height: number;
  readonly id: number;
}

/** Escamas em fileiras desencontradas; a altura é 1 no centro exposto e cai na borda (sulco). */
function scaleAt(u: number, v: number): ScaleSample {
  const cx = u * SCALE_COLUMNS;
  const col = Math.floor(cx);
  const cy = v * SCALE_ROWS + (col & 1) * 0.5;
  const row = Math.floor(cy);
  const fx = cx - col;
  const fy = cy - row - 0.5;
  const d = Math.sqrt(fx * fx + fy * 1.3 * (fy * 1.3));
  return { height: Math.max(0, 1 - d), id: hash2(col, row % SCALE_ROWS) };
}

function ellipse(du: number, de: number, ru: number, re: number): number {
  return 1 - smoothstep(0.7, 1, Math.hypot(du / ru, de / re));
}

/** Manchas da espécie: `dark` escurece com a cor das manchas; `ring` é o anel claro do ocelo. */
function spotMask(visual: SpeciesVisual, u: number, e: number): { dark: number; ring: number } {
  const { pattern, count } = visual.spots;
  if (pattern === 'humeral_caudal_spots') {
    const humeral = ellipse(u - 0.27, e - 0.3, 0.035, 0.35);
    const caudal = ellipse(u - 0.93, e, 0.07, 0.16);
    return { dark: Math.max(humeral, caudal), ring: 0 };
  }
  if (pattern === 'vertical_bars') {
    let dark = 0;
    const step = count > 1 ? 0.62 / (count - 1) : 0;
    for (let k = 0; k < count; k++) {
      const bar = 1 - smoothstep(0.008, 0.022, Math.abs(u - (0.28 + k * step)));
      dark = Math.max(dark, bar * smoothstep(-0.6, -0.1, e) * 0.55);
    }
    return { dark, ring: 0 };
  }
  let dark = 0;
  const step = count > 1 ? 0.38 / (count - 1) : 0;
  for (let k = 0; k < count; k++) {
    const bar = 1 - smoothstep(0.014, 0.03, Math.abs(u - (0.34 + k * step)));
    dark = Math.max(dark, bar * smoothstep(-0.45, 0, e) * 0.9);
  }
  const d = Math.hypot((u - 0.95) / 0.035, (e - 0.05) / 0.3);
  dark = Math.max(dark, 1 - smoothstep(0.55, 0.7, d));
  const ring = smoothstep(0.6, 0.72, d) * (1 - smoothstep(0.95, 1.1, d));
  return { dark, ring };
}

/** Gera os pixels (RGBA) de albedo, normal e rugosidade. Puro e determinístico pela espécie. */
export function generateFishTexturePixels(
  speciesId: SpeciesId,
  width = FISH_TEXTURE_WIDTH,
  height = FISH_TEXTURE_HEIGHT,
): FishTexturePixels {
  const visual = getSpecies(speciesId).visual;
  const dorsal = hexToRgb(visual.palette.dorsal);
  const flank = hexToRgb(visual.palette.flank);
  const belly = hexToRgb(visual.palette.belly);
  const ringColor = hexToRgb(visual.palette.fin);
  const spotColor = hexToRgb(visual.spots.color);
  const albedo = new Uint8Array(width * height * 4);
  const normal = new Uint8Array(width * height * 4);
  const roughness = new Uint8Array(width * height * 4);
  const du = 1 / width;
  const dv = 1 / height;

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const e = Math.sin(v * Math.PI * 2);
    const base = e >= 0 ? mix(flank, dorsal, smoothstep(0.1, 0.85, e)) : mix(flank, belly, smoothstep(-0.1, -0.7, e));
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const scale = scaleAt(u, v);
      const groove = 1 - smoothstep(0, 0.25, scale.height);
      const spots = spotMask(visual, u, e);
      let color = mix(base, spotColor, spots.dark * 0.9);
      color = mix(color, ringColor, spots.ring * 0.85);
      const shade = (1 - 0.18 * groove) * (0.94 + 0.12 * scale.id);
      const k = (py * width + px) * 4;
      albedo[k] = Math.min(255, Math.round(color[0] * shade));
      albedo[k + 1] = Math.min(255, Math.round(color[1] * shade));
      albedo[k + 2] = Math.min(255, Math.round(color[2] * shade));
      albedo[k + 3] = 255;

      const dhu = scaleAt(u + du, v).height - scaleAt(u - du, v).height;
      const dhv = scaleAt(u, v + dv).height - scaleAt(u, v - dv).height;
      const nx = -dhu * NORMAL_STRENGTH;
      const ny = -dhv * NORMAL_STRENGTH;
      const len = Math.hypot(nx, ny, 1);
      normal[k] = Math.round((nx / len * 0.5 + 0.5) * 255);
      normal[k + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      normal[k + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normal[k + 3] = 255;

      const rough = Math.min(1, Math.max(0.05, 0.42 - 0.14 * scale.height + 0.16 * groove - 0.06 * Math.max(0, -e)));
      const r = Math.round(rough * 255);
      roughness[k] = r;
      roughness[k + 1] = r;
      roughness[k + 2] = r;
      roughness[k + 3] = 255;
    }
  }
  return { width, height, albedo, normal, roughness };
}

function toTexture(data: Uint8Array, width: number, height: number, colorSpace: ColorSpace): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = colorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

interface CacheEntry {
  readonly set: FishTextureSet;
  refs: number;
}

const cache = new Map<SpeciesId, CacheEntry>();

/** Texturas da espécie, geradas uma vez e compartilhadas. Cada acquire pede um release. */
export function acquireFishTextures(speciesId: SpeciesId): FishTextureSet {
  const cached = cache.get(speciesId);
  if (cached) {
    cached.refs++;
    return cached.set;
  }
  const p = generateFishTexturePixels(speciesId);
  const set: FishTextureSet = {
    albedo: toTexture(p.albedo, p.width, p.height, SRGBColorSpace),
    normal: toTexture(p.normal, p.width, p.height, NoColorSpace),
    roughness: toTexture(p.roughness, p.width, p.height, NoColorSpace),
  };
  cache.set(speciesId, { set, refs: 1 });
  return set;
}

/** Devolve a referência; a última libera as texturas da GPU e tira a espécie do cache. */
export function releaseFishTextures(speciesId: SpeciesId): void {
  const entry = cache.get(speciesId);
  if (!entry) throw new RangeError(`releaseFishTextures sem acquire correspondente: ${speciesId}`);
  entry.refs--;
  if (entry.refs > 0) return;
  entry.set.albedo.dispose();
  entry.set.normal.dispose();
  entry.set.roughness.dispose();
  cache.delete(speciesId);
}

/** Quantas espécies têm texturas vivas no cache (diagnóstico e testes de vazamento). */
export function cachedFishTextureCount(): number {
  return cache.size;
}
