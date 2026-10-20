export const LEGENDARY_ODDS = 1_000_000_000;
export const LEGENDARY_INTRO_MS = 8000;

/** Rejeição remove o viés de reduzir 2^32 possibilidades para um bilhão. */
export function rollLegendary(nextUint32: () => number): boolean {
  let value: number;
  do {
    value = nextUint32();
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('sorteio exige uint32');
  } while (value >= 4_000_000_000);
  return value % LEGENDARY_ODDS === 0;
}

export function randomLegendary(): boolean {
  return rollLegendary(() => crypto.getRandomValues(new Uint32Array(1))[0]!);
}
