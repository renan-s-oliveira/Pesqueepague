import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng.ts';
import { LAKE } from './layout.ts';
import { scatterPlacements, type ScatterRule } from './vegetation.ts';

const flatShore = (): number => LAKE.waterLevel + 1;

const RULE: ScatterRule = {
  count: 400,
  minDistance: LAKE.radius * 1.2,
  maxDistance: LAKE.radius * 1.2 + 60,
  maxHeight: 50,
  minScale: 0.7,
  maxScale: 1.4,
};

function variance(values: readonly number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

/** Variância de uma distribuição uniforme em [min, max). */
const uniformVariance = (min: number, max: number): number => (max - min) ** 2 / 12;

describe('scatterPlacements', () => {
  const placements = scatterPlacements(new Rng(20261014), flatShore, RULE);

  it('gera instâncias suficientes dentro da faixa de escala da regra', () => {
    expect(placements.length).toBeGreaterThan(RULE.count * 0.9);
    for (const p of placements) {
      expect(p.scale).toBeGreaterThanOrEqual(RULE.minScale);
      expect(p.scale).toBeLessThan(RULE.maxScale);
    }
  });

  it('variância de escala acima do limite (sem repetição evidente de tamanho)', () => {
    const scales = placements.map((p) => p.scale);
    expect(variance(scales)).toBeGreaterThan(uniformVariance(RULE.minScale, RULE.maxScale) * 0.7);
  });

  it('variância de rotação acima do limite e direções espalhadas no círculo', () => {
    const rotations = placements.map((p) => p.rotation);
    expect(variance(rotations)).toBeGreaterThan(uniformVariance(0, Math.PI * 2) * 0.7);
    const sx = rotations.reduce((s, r) => s + Math.cos(r), 0) / rotations.length;
    const sz = rotations.reduce((s, r) => s + Math.sin(r), 0) / rotations.length;
    expect(Math.hypot(sx, sz), 'comprimento resultante médio (0 = sem direção preferida)').toBeLessThan(0.15);
  });

  it('variação de matiz por instância cobre os dois lados de [-1, 1]', () => {
    const hues = placements.map((p) => p.hue);
    expect(Math.min(...hues)).toBeLessThan(-0.5);
    expect(Math.max(...hues)).toBeGreaterThan(0.5);
  });

  it('a mesma seed dá o mesmo resultado', () => {
    const again = scatterPlacements(new Rng(20261014), flatShore, RULE);
    expect(again).toEqual(placements);
  });

  it('seeds diferentes dão distribuições diferentes', () => {
    const other = scatterPlacements(new Rng(7), flatShore, RULE);
    expect(other).not.toEqual(placements);
  });
});
