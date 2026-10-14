import { CanvasTexture, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
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
