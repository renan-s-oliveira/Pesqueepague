import { expect, test } from '@playwright/test';
import { openGame, setAtmosphere, setQuality } from './helpers.ts';

/**
 * Regressão visual em 3 enquadramentos, com seed fixa e relógio manual (openGame).
 * A tolerância fica em playwright.config.ts (expect.toHaveScreenshot): a água e o céu
 * animam com o tempo real do navegador, então a comparação aceita o deslocamento de fase
 * entre execuções, mas pega mudança de paleta, enquadramento, geometria ou UI.
 * Baselines geradas com `npm run test:e2e -- e2e/visual.e2e.ts --update-snapshots`
 * no Chromium headless com SwiftShader (ver playwright.config.ts).
 */

interface WeighingHooks {
  openWeighing(speciesId?: string): Promise<void>;
}

test('visual: lago ao meio-dia, lago às 18h e estúdio de pesagem', async ({ page }) => {
  test.setTimeout(240_000);
  await openGame(page);
  await setQuality(page, 'medium');
  const canvas = page.locator('canvas').first();

  // Enquadramento 1: lago às 12h, céu limpo.
  await setAtmosphere(page, 12, 'clear', 30);
  await expect(canvas).toHaveScreenshot('lago-12h.png');

  // Enquadramento 2: lago às 18h (fim de tarde), céu limpo.
  await setAtmosphere(page, 18, 'clear', 30);
  await expect(canvas).toHaveScreenshot('lago-18h.png');

  // Enquadramento 3: estúdio de pesagem com a tilápia, leitura estável.
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<WeighingHooks> }).__fp?.openWeighing))
    .toBe('function');
  await page.evaluate(() => (window as unknown as { __fp: WeighingHooks }).__fp.openWeighing('tilapia'));
  await expect(page.getByTestId('weighing-screen')).toBeVisible();
  await expect(page.getByTestId('weighing-reading')).toHaveText('0,900 kg', { timeout: 15_000 });
  await expect(page.getByTestId('weighing-screen')).toHaveScreenshot('estudio.png');
});
