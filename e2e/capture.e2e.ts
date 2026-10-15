import { expect, test, type Page } from '@playwright/test';
import { openGame } from './helpers.ts';

interface CaptureHooks {
  openCapture(): Promise<void>;
  captureOpen(): boolean;
  lastPhoto(): { id: string; size: number } | null;
  lastCatchRecord(): Promise<{ id: string; photoId?: string } | undefined>;
}

async function waitCaptureHooks(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: Partial<CaptureHooks> }).__fp?.openCapture))
    .toBe('function');
}

test('tela de captura: estúdio 3D com o exemplar, ficha completa, Ver detalhes e foto salva na galeria', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);

  // Chega à captura pelo gancho __fp, sem pescar: a cena do estúdio abre sobre o jogo.
  await waitCaptureHooks(page);
  await page.evaluate(() => (window as unknown as { __fp: CaptureHooks }).__fp.openCapture());
  const screen = page.getByTestId('catch-screen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('canvas')).toBeVisible();

  // Ficha do exemplar: nome popular e científico, peso, comprimento, raridade, local, hora e isca.
  const panel = page.getByTestId('catch-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Tilápia');
  await expect(panel).toContainText('Oreochromis niloticus');
  await expect(page.getByTestId('catch-weight')).toHaveText('900 g');
  await expect(page.getByTestId('catch-length')).toContainText('cm');
  await expect(panel.locator('dd[data-testid="catch-rarity"]')).toHaveText('Incomum');
  await expect(page.getByTestId('catch-location')).toContainText('Lago principal');
  await expect(page.getByTestId('catch-hour')).toHaveText('17:30');
  await expect(page.getByTestId('catch-lure')).toHaveText('Minhoca');
  // Recorde pessoal e maior exemplar chegam da galeria; até lá o painel mostra um traço, nunca vazio.
  await expect.poll(() => page.getByTestId('catch-biggest').textContent()).not.toBe('—');

  // 'Ver detalhes' é um toggle de verdade, com estado acessível.
  const details = page.getByTestId('capture-details');
  await details.click();
  await expect(details).toHaveAttribute('aria-pressed', 'true');
  await details.click();
  await expect(details).toHaveAttribute('aria-pressed', 'false');

  // Foto: canvas.toBlob salvo pelo catchRepository e ligado ao registro da captura.
  await page.getByTestId('capture-photo').click();
  await expect(page.getByTestId('capture-status')).toHaveText('Foto salva na galeria.');
  const photo = await page.evaluate(() => (window as unknown as { __fp: CaptureHooks }).__fp.lastPhoto());
  expect(photo?.size ?? 0).toBeGreaterThan(0);
  const record = await page.evaluate(() => (window as unknown as { __fp: CaptureHooks }).__fp.lastCatchRecord());
  expect(record?.photoId).toBe(`foto-${record?.id}`);

  // Continuar fecha o estúdio e devolve o jogo.
  await page.getByTestId('result-continue').click();
  await expect(screen).toBeHidden();
  expect(errors).toEqual([]);
});
