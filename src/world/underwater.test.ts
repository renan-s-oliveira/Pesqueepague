import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng';
import { LAKE, LAKE_BED } from './layout';
import { createHeightField } from './terrain';
import { Underwater, createDepthField, visibilityAt } from './underwater';

function field(seed: number) {
  const terrain = createHeightField(new Rng(seed));
  return { terrain, depth: createDepthField(seed, terrain) };
}

describe('depthAt', () => {
  it('é determinístico pela seed', () => {
    const a = field(42).depth;
    const b = field(42).depth;
    for (let i = 0; i < 200; i++) {
      const x = -40 + (i % 20) * 4;
      const z = -40 + Math.floor(i / 20) * 8;
      expect(a.depthAt(x, z)).toBe(b.depthAt(x, z));
    }
  });

  it('seeds diferentes geram leitos diferentes', () => {
    const a = field(1).depth;
    const b = field(2).depth;
    let differs = false;
    for (let x = -20; x <= 20 && !differs; x += 2) {
      for (let z = -20; z <= 20 && !differs; z += 2) differs = a.depthAt(x, z) !== b.depthAt(x, z);
    }
    expect(differs).toBe(true);
  });

  it('é coerente com LAKE: fundo no centro, raso perto da margem e zero em terra', () => {
    for (const seed of [3, 77, 2024]) {
      const { depthAt } = field(seed).depth;
      const center = depthAt(LAKE.centerX, LAKE.centerZ);
      expect(center).toBeGreaterThan(1.5);
      expect(center).toBeLessThanOrEqual(LAKE_BED.maxDepth + 1e-9);
      expect(depthAt(LAKE.centerX + LAKE.radius * 0.8, LAKE.centerZ)).toBeGreaterThan(0);
      expect(depthAt(LAKE.centerX + LAKE.radius * 0.8, LAKE.centerZ)).toBeLessThan(center);
      expect(depthAt(LAKE.centerX + 90, LAKE.centerZ)).toBe(0);
      expect(depthAt(LAKE.centerX, LAKE.centerZ - 120)).toBe(0);
    }
  });

  it('nunca é negativo, nem põe o leito abaixo da bacia do terreno', () => {
    const { terrain, depth } = field(9);
    for (let x = -60; x <= 60; x += 3) {
      for (let z = -60; z <= 60; z += 3) {
        const d = depth.depthAt(x, z);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(depth.bedHeightAt(x, z)).toBeGreaterThanOrEqual(terrain(x, z));
        expect(d).toBeCloseTo(Math.max(0, LAKE.waterLevel - depth.bedHeightAt(x, z)), 12);
      }
    }
  });

  it('posição não finita devolve profundidade zero', () => {
    const { depthAt } = field(5).depth;
    expect(depthAt(Number.NaN, 0)).toBe(0);
    expect(depthAt(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('visibilityAt', () => {
  it('cai com a profundidade e fica em (0, 1]', () => {
    expect(visibilityAt(0)).toBe(1);
    expect(visibilityAt(1)).toBeLessThan(1);
    expect(visibilityAt(3)).toBeLessThan(visibilityAt(1));
    expect(visibilityAt(3)).toBeGreaterThan(0);
    expect(visibilityAt(-2)).toBe(1);
    expect(visibilityAt(Number.NaN)).toBe(1);
  });
});

describe('Underwater', () => {
  it('monta leito, pedras, troncos, raízes, vegetação e partículas, e o depthAt é o mesmo do campo', () => {
    const seed = 42;
    const terrain = createHeightField(new Rng(seed));
    const underwater = new Underwater(seed, terrain);
    const stats = underwater.getStats();
    expect(stats.bedVertices).toBeGreaterThan(0);
    expect(stats.rocks).toBeGreaterThan(0);
    expect(stats.logs).toBeGreaterThan(0);
    expect(stats.roots).toBeGreaterThan(0);
    expect(stats.weeds).toBeGreaterThan(0);
    expect(stats.suspendedParticles).toBeGreaterThan(0);
    expect(stats.sediment).toBeGreaterThan(0);
    expect(stats.maxDepth).toBeGreaterThan(1.5);
    expect(underwater.group.getObjectByName('lake-bed')).toBeDefined();
    expect(underwater.group.getObjectByName('lake-caustics')).toBeDefined();
    const ref = createDepthField(seed, terrain);
    expect(underwater.depthAt(4, -7)).toBe(ref.depthAt(4, -7));
  });

  it('o preset escala cáusticas, vegetação e partículas', () => {
    const underwater = new Underwater(7, createHeightField(new Rng(7)));
    underwater.setQuality('ultra', 1);
    const ultra = underwater.getStats();
    underwater.setQuality('low', 0.3);
    const low = underwater.getStats();
    expect(low.causticsIntensity).toBeLessThan(ultra.causticsIntensity);
    expect(low.causticsIntensity).toBeGreaterThan(0);
    expect(low.weeds).toBeLessThan(ultra.weeds);
    expect(low.suspendedParticles).toBeLessThan(ultra.suspendedParticles);
  });
});
