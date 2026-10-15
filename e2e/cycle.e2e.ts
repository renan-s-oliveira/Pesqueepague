import { expect, test } from '@playwright/test';
import { cast, hookAndForceReel, hookAndReel, lastOutcome, openGame, skipToBite, waitState } from './helpers.ts';

test('ciclo arremesso→mordida→fisgada→recolhimento→captura e depois rompimento de linha', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  await cast(page);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  expect(await hookAndReel(page)).toBe('CAUGHT');
  const caught = await lastOutcome(page);
  expect(caught?.outcome).toBe('caught');
  expect(caught?.weightKg).toBeGreaterThan(0);
  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');

  await cast(page);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  expect(await hookAndForceReel(page)).toBe('ESCAPED');
  const broken = await lastOutcome(page);
  expect(broken).toMatchObject({ outcome: 'escaped', reason: 'line_snapped' });
  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');
  expect(errors).toEqual([]);
});
