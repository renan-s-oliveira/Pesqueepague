import { expect, test } from '@playwright/test';
import { openGame, setAtmosphere, waitState, type Atmosphere } from './helpers.ts';

test('percorre 06h, 12h, 18h e 22h com chuva sem erro no console e com névoa dependente da hora e do clima', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  const byHour = new Map<number, Atmosphere>();
  for (const hour of [6, 12, 18, 22]) {
    const atm = await setAtmosphere(page, hour, 'rain');
    expect(atm.hour).toBeCloseTo(hour, 1);
    expect(atm.weather).toBe('rain');
    expect(atm.cloudCover).toBeGreaterThan(0.9);
    expect(atm.rainDrops).toBeGreaterThan(0);
    expect(atm.fogNear).toBeGreaterThan(0);
    expect(atm.fogFar).toBeGreaterThan(atm.fogNear);
    expect(Number.isFinite(atm.wind.speed)).toBe(true);
    byHour.set(hour, atm);
  }

  expect(byHour.get(22)!.fogFar).toBeLessThan(byHour.get(12)!.fogFar);

  const clearNoon = await setAtmosphere(page, 12, 'clear');
  expect(clearNoon.weather).toBe('clear');
  expect(clearNoon.fogFar).toBeGreaterThan(byHour.get(12)!.fogFar);

  await expect(page.locator('canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});
