export interface GameConfig {
  readonly seed: number;
  readonly maxPixelRatio: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  seed: 20261014,
  maxPixelRatio: 2,
};

/**
 * Deriva uma sub-seed independente (uint32) a partir da seed da partida.
 * O `^` do JS devolve int32 com sinal; o `>>> 0` traz de volta para [0, 4294967295].
 */
export function deriveSeed(seed: number, salt: number): number {
  return (seed ^ salt) >>> 0;
}

/** Valida uma configuração parcial vinda de fora e completa com os padrões. */
export function parseGameConfig(input: unknown): GameConfig {
  if (input === undefined || input === null) return DEFAULT_CONFIG;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('configuração deve ser um objeto');
  }
  const raw = input as Record<string, unknown>;
  const seed = raw['seed'] ?? DEFAULT_CONFIG.seed;
  const maxPixelRatio = raw['maxPixelRatio'] ?? DEFAULT_CONFIG.maxPixelRatio;

  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('config.seed deve ser inteiro entre 0 e 4294967295');
  }
  if (typeof maxPixelRatio !== 'number' || !Number.isFinite(maxPixelRatio) || maxPixelRatio < 0.5 || maxPixelRatio > 4) {
    throw new RangeError('config.maxPixelRatio deve estar entre 0.5 e 4');
  }
  return { seed, maxPixelRatio };
}
