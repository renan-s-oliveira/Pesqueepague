/** Medidas do mapa único: lago no centro, píer ao sul, montanhas em volta. */
export const LAKE = {
  centerX: 0,
  centerZ: 0,
  radius: 30,
  waterLevel: 0,
} as const;

/** Leito do lago: mais fundo no centro, sobe até a margem em `rimRadius`. Nunca abaixo da bacia do terreno. */
export const LAKE_BED = {
  maxDepth: 2.9,
  rimRadius: LAKE.radius * 1.3,
} as const;

export const PIER = {
  x: 0,
  zShore: 42,
  zEnd: 24,
  halfWidth: 1.3,
  deckY: 0.7,
} as const;

export const TERRAIN = {
  size: 400,
  segments: 160,
} as const;

export const SUN_DIRECTION = { x: -0.55, y: 0.22, z: -0.8 } as const;

export function distanceToLakeCenter(x: number, z: number): number {
  return Math.hypot(x - LAKE.centerX, z - LAKE.centerZ);
}

export function isOnPier(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - PIER.x) <= PIER.halfWidth + margin && z >= PIER.zEnd - margin && z <= PIER.zShore + margin;
}
