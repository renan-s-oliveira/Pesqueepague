import { expect, test } from '@playwright/test';
import { openGame, setAtmosphere, setQuality } from './helpers.ts';

type UnderwaterState = {
  loaded: boolean;
  bedInScene: boolean;
  bedVertices: number;
  rocks: number;
  logs: number;
  roots: number;
  weeds: number;
  suspendedParticles: number;
  sediment: number;
  causticsIntensity: number;
  maxDepth: number;
  depthCenter: number;
  depthNearShore: number;
  depthOnLand: number;
  glError: number;
};
type UnderwaterHooks = { getUnderwater(): UnderwaterState };

test('mundo subaquático carregado: leito, vegetação, partículas e cáusticas escaladas pelo preset', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<UnderwaterHooks> }).__fp?.getUnderwater))
    .toBe('function');

  const read = () =>
    page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return (window as unknown as { __fp: UnderwaterHooks }).__fp.getUnderwater();
    });

  const byPreset: Record<string, UnderwaterState> = {};
  for (const preset of ['low', 'medium', 'high', 'ultra']) {
    await setQuality(page, preset);
    const u = await read();
    byPreset[preset] = u;
    expect(u.loaded, `grupo subaquático na cena no preset ${preset}`).toBe(true);
    expect(u.bedInScene).toBe(true);
    expect(u.bedVertices).toBeGreaterThan(0);
    expect(u.rocks).toBeGreaterThan(0);
    expect(u.logs).toBeGreaterThan(0);
    expect(u.roots).toBeGreaterThan(0);
    expect(u.weeds).toBeGreaterThan(0);
    expect(u.suspendedParticles).toBeGreaterThan(0);
    expect(u.sediment).toBeGreaterThan(0);
    expect(u.causticsIntensity).toBeGreaterThan(0);
    expect(u.glError, `erro WebGL no preset ${preset}`).toBe(0);
  }
  const ultra = byPreset['ultra'] as UnderwaterState;
  const low = byPreset['low'] as UnderwaterState;
  expect(low.causticsIntensity).toBeLessThan(ultra.causticsIntensity);
  expect(low.weeds).toBeLessThan(ultra.weeds);
  expect(ultra.depthCenter).toBeGreaterThan(ultra.depthNearShore);
  expect(ultra.depthNearShore).toBeGreaterThan(0);
  expect(ultra.depthOnLand).toBe(0);
  expect(ultra.maxDepth).toBeGreaterThan(1);

  await setAtmosphere(page, 22, 'clear');
  expect((await read()).glError).toBe(0);
  expect(errors).toEqual([]);
});
