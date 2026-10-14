/** Gerador pseudoaleatório determinístico (mulberry32) para que a mesma seed reproduza a mesma partida. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(`seed deve ser inteiro entre 0 e 4294967295; recebido: ${String(seed)}`);
    }
    this.s = seed >>> 0;
  }

  /** Número em [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Número em [min, max). */
  range(min: number, max: number): number {
    if (!(Number.isFinite(min) && Number.isFinite(max)) || max < min) {
      throw new RangeError(`intervalo inválido: [${min}, ${max})`);
    }
    return min + (max - min) * this.next();
  }

  /** Inteiro em [min, max], ambos inclusivos. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`intervalo inteiro inválido: [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() exige uma lista não vazia');
    return items[this.int(0, items.length - 1)] as T;
  }

  getState(): number {
    return this.s;
  }

  setState(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) {
      throw new RangeError(`estado do RNG inválido: ${String(state)}`);
    }
    this.s = state >>> 0;
  }
}
