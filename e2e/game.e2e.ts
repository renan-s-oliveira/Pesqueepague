import { expect, test } from '@playwright/test';
import { cast, hookAndReel, openGame, skipToBite, state, waitState } from './helpers.ts';

test('fluxo completo: menu, pesca até a captura, pausa, retomada e volta ao menu, sem erro no console', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await expect(page.locator('canvas').first()).toBeVisible();

  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  await cast(page);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  await expect(page.getByTestId('bite-alert')).toBeVisible();

  const outcome = await hookAndReel(page);
  expect(outcome).toBe('CAUGHT');
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fp: { catches(): number } }).__fp.catches())).toBe(1);

  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');

  await page.keyboard.press('Escape');
  await waitState(page, 'PAUSED');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-resume').click();
  await waitState(page, 'IDLE');
  await expect(page.getByTestId('pause-menu')).toBeHidden();

  await page.keyboard.press('Escape');
  await waitState(page, 'PAUSED');
  await page.getByTestId('pause-quit').click();
  await waitState(page, 'MENU');
  await expect(page.getByTestId('menu-play')).toBeVisible();

  expect(await state(page)).toBe('MENU');
  expect(errors).toEqual([]);
});

test('asset que falha ao carregar mantém o fallback procedural e o jogo segue', async ({ page }) => {
  const missing = '/assets/e2e-missing.png';
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.route(`**${missing}`, (route) => route.abort('failed'));

  await openGame(page);
  const failed = page.waitForEvent('requestfailed', (req) => req.url().endsWith(missing));
  await page.evaluate((path) => {
    const w = window as unknown as { __fp: { probeAssetFallback(p: string): () => boolean }; __probe?: () => boolean };
    w.__probe = w.__fp.probeAssetFallback(path);
  }, missing);
  await failed;
  await expect.poll(() => page.evaluate(() => (window as unknown as { __probe: () => boolean }).__probe())).toBe(true);

  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');
  expect(pageErrors).toEqual([]);
});
