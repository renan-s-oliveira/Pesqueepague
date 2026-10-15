import { expect, test } from '@playwright/test';
import { openGame } from './helpers.ts';

interface CatchSeed {
  readonly id: string;
  readonly speciesId: string;
  readonly weightKg: number;
  readonly lengthCm: number;
  readonly timestamp: number;
  readonly locationId: string;
  readonly lureId: string;
  readonly rarity: string;
  readonly disposition: string;
  readonly isPersonalRecord: boolean;
}

const DAY_MS = 86_400_000;

test('galeria: 3 capturas via __fp, filtros, ordenação, busca e a sala de troféus', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);

  // 3 capturas direto no repositório, pelo gancho __fp.saveCatch do modo e2e.
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { __fp?: { saveCatch?: unknown } }).__fp?.saveCatch),
    )
    .toBe('function');
  const base = Date.now();
  const seeds: CatchSeed[] = [
    {
      id: 'e2e-galeria-1',
      speciesId: 'lambari',
      weightKg: 0.05,
      lengthCm: 11.2,
      timestamp: base - 3 * DAY_MS,
      locationId: 'lago-principal',
      lureId: 'worm',
      rarity: 'common',
      disposition: 'kept',
      isPersonalRecord: false,
    },
    {
      id: 'e2e-galeria-2',
      speciesId: 'tilapia',
      weightKg: 1.8,
      lengthCm: 48.3,
      timestamp: base - 2 * DAY_MS,
      locationId: 'lago-principal',
      lureId: 'pellet',
      rarity: 'uncommon',
      disposition: 'kept',
      isPersonalRecord: false,
    },
    {
      id: 'e2e-galeria-3',
      speciesId: 'tucunare',
      weightKg: 4.8,
      lengthCm: 78.5,
      timestamp: base - DAY_MS,
      locationId: 'lago-principal',
      lureId: 'spinner',
      rarity: 'legendary',
      disposition: 'released',
      isPersonalRecord: true,
    },
  ];
  await page.evaluate(async (records) => {
    const fp = (window as unknown as { __fp: { saveCatch(r: unknown): Promise<void> } }).__fp;
    for (const r of records) await fp.saveCatch(r);
  }, seeds);

  // Abre a galeria pelo menu e vê os 3 cards (ordem padrão: mais recentes primeiro).
  await page.getByTestId('menu-gallery').click();
  await expect(page.getByTestId('gallery')).toBeVisible();
  const cards = page.getByTestId('gallery-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('Tucunaré');
  await expect(page.getByTestId('gallery-status')).toContainText('3 capturas');

  // Ordenação por peso, nas duas direções.
  await page.getByTestId('gallery-sort').selectOption('weight_asc');
  await expect(cards.first()).toContainText('Lambari');
  await page.getByTestId('gallery-sort').selectOption('weight_desc');
  await expect(cards.first()).toContainText('Tucunaré');

  // Ordenação por data, mais antigas primeiro.
  await page.getByTestId('gallery-sort').selectOption('date_asc');
  await expect(cards.first()).toContainText('Lambari');

  // Filtro por espécie.
  await page.getByTestId('gallery-filter-species').selectOption('tilapia');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Tilápia');
  await page.getByTestId('gallery-filter-species').selectOption('');
  await expect(cards).toHaveCount(3);

  // Filtro por raridade.
  await page.getByTestId('gallery-filter-rarity').selectOption('legendary');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Tucunaré');
  await page.getByTestId('gallery-filter-rarity').selectOption('');

  // Filtro por ambiente: tudo é do lago tropical.
  await page.getByTestId('gallery-filter-env').selectOption('lago-principal');
  await expect(cards).toHaveCount(3);
  await page.getByTestId('gallery-filter-env').selectOption('');

  // Busca livre, com estado de "nenhum resultado" e microcopy de saída.
  await page.getByTestId('gallery-search').fill('lambari');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Lambari');
  await page.getByTestId('gallery-search').fill('baiacu');
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId('gallery-empty')).toContainText('Nenhuma captura combina');
  await page.getByTestId('gallery-search').fill('');
  await expect(cards).toHaveCount(3);

  // Sala de troféus 3D: abre com os recordes e as estatísticas, e fecha de volta à galeria.
  await page.getByTestId('gallery-trophy-room').click();
  const room = page.getByTestId('trophy-room');
  await expect(room).toBeVisible();
  await expect(room.locator('canvas')).toBeVisible();
  const stats = page.getByTestId('trophy-stats');
  await expect(stats).toContainText('Capturas');
  await expect(stats).toContainText('Recorde pessoal');
  await expect(stats).toContainText('Tucunaré');
  await expect(page.getByTestId('trophy-record')).toHaveCount(3);
  await page.getByTestId('trophy-close').click();
  await expect(room).toHaveCount(0);

  expect(errors).toEqual([]);
});
