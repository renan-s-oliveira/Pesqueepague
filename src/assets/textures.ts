import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { Rng } from '../utils/rng.ts';

/**
 * Arquivos de textura empacotados com o jogo (servidos de /assets/, mesma origem).
 * Cada entrada precisa estar registrada em ASSETS_LICENSES.md. Hoje tudo é procedural, então está vazio.
 */
export const TEXTURE_MANIFEST: Readonly<Record<string, string>> = {};

/** Só caminhos locais dentro de /assets/: nada de URL absoluta, outra origem ou subida de diretório. */
export function isLocalAssetPath(path: string): boolean {
  return /^\/?assets\/[A-Za-z0-9_\-/]+\.(png|jpe?g|webp|ktx2)$/.test(path) && !path.includes('..');
}

/**
 * Entrega a textura pedida sem nunca bloquear: devolve na hora o fallback procedural e,
 * se houver arquivo local registrado, troca a imagem quando ele carregar. Se o arquivo faltar, o fallback fica.
 */
export class TextureProvider {
  private readonly manifest: Readonly<Record<string, string>>;
  private readonly cache = new Map<string, Texture>();
  private readonly loader = new TextureLoader();

  constructor(manifest: Readonly<Record<string, string>> = TEXTURE_MANIFEST) {
    this.manifest = manifest;
  }

  get(key: string, fallback: () => CanvasTexture): Texture {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const texture: Texture = fallback();
    this.cache.set(key, texture);

    const path = this.manifest[key];
    if (path === undefined) return texture;
    if (!isLocalAssetPath(path)) {
      console.warn(`Asset "${key}" ignorado: caminho fora de /assets/ (${path}). Usando versão procedural.`);
      return texture;
    }
    this.loader.load(
      path,
      (loaded) => {
        texture.image = loaded.image;
        texture.needsUpdate = true;
      },
      undefined,
      () => console.warn(`Asset "${key}" não encontrado em ${path}. Usando versão procedural.`),
    );
    return texture;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }
}

/**
 * Detalhe do chão para o splat do terreno, determinístico pela seed e sem costura (tileable).
 * Canais de dado, não cor: R = ondulação da areia, G = torrões de terra e grama, B = fissuras da pedra.
 */
export function createTerrainDetailTexture(seed: number, size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível para gerar a textura do terreno.');
  const rng = new Rng(seed);

  const lattice = (cells: number): ((u: number, v: number) => number) => {
    const values = new Float32Array(cells * cells);
    for (let i = 0; i < values.length; i++) values[i] = rng.next();
    return (u, v) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (cx: number, cy: number): number => values[((cy % cells) * cells + (cx % cells)) | 0] ?? 0;
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const octaves = [lattice(4), lattice(8), lattice(16), lattice(32), lattice(64)];
  const fbm = (u: number, v: number, from: number): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = from; o < octaves.length; o++) {
      sum += (octaves[o]?.(u, v) ?? 0) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };

  const image = ctx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const ripple = 0.5 + 0.5 * Math.sin((u * 6 + fbm(u, v, 1) * 3) * Math.PI * 2);
      const sand = 0.55 * ripple + 0.45 * fbm(u, v, 3);
      const clumps = fbm(u, v, 2);
      const cracks = 1 - Math.min(1, Math.abs(fbm(u, v, 1) - 0.5) * 9);
      const rock = fbm(u, v, 0) * 0.75 + (1 - cracks) * 0.25;
      const k = (py * size + px) * 4;
      image.data[k] = Math.round(sand * 255);
      image.data[k + 1] = Math.round(clumps * 255);
      image.data[k + 2] = Math.round(rock * 255);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Textura de madeira gerada em canvas (veios + variação por tábua), determinística pela seed. */
export function createWoodTexture(seed: number, size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível para gerar a textura de madeira.');
  const rng = new Rng(seed);
  ctx.fillStyle = '#8a6142';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const y = rng.range(0, size);
    const light = Math.floor(rng.range(70, 140));
    ctx.strokeStyle = `rgba(${light + 40}, ${light}, ${Math.floor(light * 0.6)}, ${rng.range(0.15, 0.45).toFixed(2)})`;
    ctx.lineWidth = rng.range(0.5, 2.5);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * rng.range(0.5, 3));
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(50, 30, 18, 0.5)';
    ctx.beginPath();
    ctx.ellipse(rng.range(0, size), rng.range(0, size), rng.range(3, 7), rng.range(2, 4), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}
