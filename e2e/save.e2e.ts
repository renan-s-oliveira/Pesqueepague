import { expect, test } from '@playwright/test';
import { openGame } from './helpers.ts';

interface SaveHooks {
  saveCatch(record: unknown): Promise<void>;
  getCatch(id: string): Promise<Record<string, unknown> | undefined>;
}

/** Registro válido de CatchRecord: o mesmo contrato de src/progression/types.ts. */
const RECORD = {
  id: 'e2e-save-roundtrip',
  speciesId: 'tilapia',
  weightKg: 1.234,
  lengthCm: 38.5,
  timestamp: 1_760_500_000_000,
  locationId: 'lago-principal',
  lureId: 'worm',
  rarity: 'common',
  disposition: 'kept',
  isPersonalRecord: false,
} as const;

const hookType = (page: Parameters<typeof openGame>[0], name: string): Promise<string> =>
  page.evaluate((n) => typeof (window as unknown as { __fp?: Record<string, unknown> }).__fp?.[n], name);

test('captura gravada via __fp sobrevive ao reload da página', async ({ page }) => {
  await openGame(page);
  await expect.poll(() => hookType(page, 'saveCatch')).toBe('function');
  await page.evaluate((r) => (window as unknown as { __fp: SaveHooks }).__fp.saveCatch(r), RECORD);

  await page.reload();
  await expect(page.getByTestId('menu-play')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => hookType(page, 'getCatch')).toBe('function');

  const found = await page.evaluate((id) => (window as unknown as { __fp: SaveHooks }).__fp.getCatch(id), RECORD.id);
  expect(found).toMatchObject({
    id: RECORD.id,
    speciesId: RECORD.speciesId,
    weightKg: RECORD.weightKg,
    rarity: RECORD.rarity,
    locationId: RECORD.locationId,
  });
});
