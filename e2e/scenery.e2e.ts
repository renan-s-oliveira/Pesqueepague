import { expect, test } from '@playwright/test';
import { diagnostics, openGame, setQuality } from './helpers.ts';

/** Teto de draw calls do preset Médio (docs/architecture/evolucao-realismo.md, tabela de orçamento por preset). */
const MEDIUM_MAX_DRAW_CALLS = 150;

type VegetationState = {
  instances: number;
  meshes: number;
  byKind: Record<string, number>;
  fauna: { birds: number; insects: number };
  glError: number;
};
type VegetationHooks = { getVegetation(): VegetationState };

test('cenário: vegetação e fauna instanciadas e draw calls do Médio dentro do orçamento', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<VegetationHooks> }).__fp?.getVegetation))
    .toBe('function');

  await setQuality(page, 'medium');
  const v = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return (window as unknown as { __fp: VegetationHooks }).__fp.getVegetation();
  });
  expect(v.instances).toBeGreaterThan(0);
  expect(v.meshes).toBeGreaterThan(0);
  for (const kind of ['palm', 'broadleaf', 'bush', 'reed', 'rock', 'log', 'leaf-litter', 'flower']) {
    expect(v.byKind[kind] ?? 0, `instâncias de ${kind}`).toBeGreaterThan(0);
  }
  expect(v.fauna.birds).toBeGreaterThan(0);
  expect(v.fauna.insects).toBeGreaterThan(0);
  expect(v.glError).toBe(0);

  const d = await diagnostics(page);
  expect(d.quality.startsWith('medium')).toBe(true);
  expect(d.drawCalls).toBeGreaterThan(0);
  expect(d.drawCalls, 'draw calls do Médio').toBeLessThanOrEqual(MEDIUM_MAX_DRAW_CALLS);
  expect(errors).toEqual([]);
});
