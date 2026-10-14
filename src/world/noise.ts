import type { Rng } from '../utils/rng.ts';

export type Noise2D = (x: number, y: number) => number;

/** Value noise 2D em [-1, 1], com tabela embaralhada pela seed. */
export function createNoise2D(rng: Rng): Noise2D {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = p[i] ?? 0;
    p[i] = p[j] ?? 0;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] ?? 0;
  const values = new Float32Array(256);
  for (let i = 0; i < 256; i++) values[i] = rng.next() * 2 - 1;

  const corner = (x: number, y: number): number => values[perm[((perm[x & 255] ?? 0) + (y & 255)) & 511] ?? 0] ?? 0;

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = corner(xi, yi);
    const b = corner(xi + 1, yi);
    const c = corner(xi, yi + 1);
    const d = corner(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function fbm(noise: Noise2D, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
