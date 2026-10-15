import { expect, test, type Page } from '@playwright/test';
import { openGame } from './helpers.ts';

interface WeighingHooks {
  openWeighing(speciesId?: string): Promise<void>;
  weighingOpen(): boolean;
  lastDecision(): { id: string; speciesId: string; disposition: string; isPersonalRecord: boolean } | null;
}

async function openWeighing(page: Page, speciesId: string): Promise<void> {
  await page.evaluate((s) => (window as unknown as { __fp: WeighingHooks }).__fp.openWeighing(s), speciesId);
  await expect(page.getByTestId('weighing-screen')).toBeVisible();
}

const lastDecision = (page: Page): Promise<ReturnType<WeighingHooks['lastDecision']>> =>
  page.evaluate(() => (window as unknown as { __fp: WeighingHooks }).__fp.lastDecision());

test('pesagem 3D: leitura estabiliza no peso, soltar registra released, guardar grava e o Tucunaré é recusado', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<WeighingHooks> }).__fp?.openWeighing))
    .toBe('function');

  // 1) PESAR: a balança abre com a tilápia e a leitura amortecida estabiliza no peso do indivíduo.
  await openWeighing(page, 'tilapia');
  const reading = page.getByTestId('weighing-reading');
  await expect(reading).toHaveText('0,900 kg', { timeout: 15_000 });
  // Só com a leitura estável as decisões ficam disponíveis.
  await expect(page.getByTestId('weighing-release')).toBeEnabled();
  await expect(page.getByTestId('weighing-keep')).toBeEnabled();

  // VER DETALHES é um toggle acessível da inspeção.
  const details = page.getByTestId('weighing-details');
  await details.click();
  await expect(details).toHaveAttribute('aria-pressed', 'true');
  await details.click();
  await expect(details).toHaveAttribute('aria-pressed', 'false');

  // 2) SOLTAR: devolução animada, registro released, recompensa e toast de conquista (primeiro peixe).
  await page.getByTestId('weighing-release').click();
  await expect(page.getByTestId('weighing-screen')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('release-toast')).toContainText('pontos pela soltura');
  await expect(page.getByTestId('achievement-toast')).toContainText('Primeiro peixe');
  const released = await lastDecision(page);
  expect(released?.disposition).toBe('released');
  expect(released?.speciesId).toBe('tilapia');

  // 3) GUARDAR: a tilápia acima do tamanho mínimo passa pelas regras do viveiro e é gravada como kept.
  await openWeighing(page, 'tilapia');
  await expect(page.getByTestId('weighing-keep')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('weighing-keep').click();
  await expect(page.getByTestId('weighing-screen')).toBeHidden({ timeout: 15_000 });
  const kept = await lastDecision(page);
  expect(kept?.disposition).toBe('kept');
  expect(kept?.id).not.toBe(released?.id);

  // 4) RECUSA DO TUCUNARÉ: espécie protegida não pode ser guardada; o motivo aparece e a tela segue aberta.
  await openWeighing(page, 'tucunare');
  await expect(page.getByTestId('weighing-reading')).toHaveText('1,200 kg', { timeout: 15_000 });
  await page.getByTestId('weighing-keep').click();
  await expect(page.getByTestId('weighing-status')).toContainText('espécie protegida');
  await expect(page.getByTestId('weighing-screen')).toBeVisible();

  // Soltar o tucunaré fecha a pesagem e registra released.
  await page.getByTestId('weighing-release').click();
  await expect(page.getByTestId('weighing-screen')).toBeHidden({ timeout: 15_000 });
  const protectedRelease = await lastDecision(page);
  expect(protectedRelease?.disposition).toBe('released');
  expect(protectedRelease?.speciesId).toBe('tucunare');

  expect(errors).toEqual([]);
});
