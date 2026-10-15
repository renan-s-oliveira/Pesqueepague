import { expect, test } from '@playwright/test';
import { diagnostics, openGame, setQuality } from './helpers.ts';

type WaterState = { splashActive: number; glError: number; envReflection: boolean; planarReflection: boolean };
type WaterHooks = { splash(kind: string): void; getWater(): WaterState };

test('água e splash: dispara isca, salto e captura em cada preset sem erro WebGL', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<WaterHooks> }).__fp?.splash))
    .toBe('function');

  for (const preset of ['low', 'medium', 'high', 'ultra']) {
    await setQuality(page, preset);
    for (const kind of ['lure', 'jump', 'catch']) {
      const water = await page.evaluate(async (k) => {
        const fp = (window as unknown as { __fp: WaterHooks }).__fp;
        fp.splash(k);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        return fp.getWater();
      }, kind);
      expect(water.splashActive, `gotas do splash ${kind} no preset ${preset}`).toBeGreaterThan(0);
      expect(water.glError, `erro WebGL no preset ${preset}`).toBe(0);
      expect(water.envReflection, `reflexo do env map no preset ${preset}`).toBe(true);
      expect(water.planarReflection, `reflexo planar no preset ${preset}`).toBe(preset === 'high' || preset === 'ultra');
    }
    const d = await diagnostics(page);
    expect(d.programs, `programas de shader no preset ${preset}`).toBeGreaterThan(0);
    expect(d.drawCalls).toBeGreaterThan(0);
  }

  const invalid = await page.evaluate(() => {
    try {
      (window as unknown as { __fp: WaterHooks }).__fp.splash('boom');
      return 'aceitou';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(invalid).toBe('RangeError');
  expect(errors).toEqual([]);
});
