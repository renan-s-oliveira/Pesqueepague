import { test, expect } from '@playwright/test';
import { openGame, waitState } from './helpers.ts';

test('iniciar pescaria apresenta a sombra com música antes de liberar o arremesso', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await page.getByTestId('menu-play').click();
  const opening = page.getByTestId('legendary-entrance');
  await expect(opening).toBeVisible();
  await expect(opening).toHaveAttribute('data-mode', 'opening');
  await expect.poll(() => page.evaluate(() => (window as any).__fp.legendaryMusic())).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('power-bar')).toBeHidden();
  await waitState(page, 'IDLE');
  await page.keyboard.press('Escape');
  await waitState(page, 'PAUSED');
  await expect(opening).toBeVisible();
  await page.getByTestId('pause-resume').click();
  await expect(opening).toBeHidden({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => (window as any).__fp.legendaryMusic())).toBe(false);
  await page.locator('canvas').first().click();
  await waitState(page, 'CASTING');
  expect(errors).toEqual([]);
});
