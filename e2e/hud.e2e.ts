import { expect, test } from '@playwright/test';
import { lastOutcome, openGame, skipToBite, state, waitState } from './helpers.ts';

type ClockHooks = { freeze(frozen: boolean): void };

test('HUD da pesca: barras de potência/direção, painel da briga, rompimento e dica que respeita a configuração', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openGame(page);
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  // Tutorial contextual visível em IDLE (showHints padrão ligado).
  await expect(page.getByTestId('hud-hint')).toBeVisible();
  await expect(page.getByTestId('hud-hint')).toContainText('arremessar');

  // Carga do arremesso: barra de potência sobe e a barra de direção aparece junto.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas do jogo não encontrado');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('power-bar')).toBeVisible();
  await expect(page.getByTestId('direction-bar')).toBeVisible();
  await page.waitForTimeout(700);
  const power = Number(await page.getByTestId('power-bar').getAttribute('aria-valuenow'));
  expect(power).toBeGreaterThan(10);
  await page.mouse.up();
  await waitState(page, 'WAITING');

  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  await expect(page.getByTestId('bite-alert')).toBeVisible();

  // Fisga e segura o recolhimento sem soltar: tensão sobe no medidor até a linha romper.
  await page.mouse.down();
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as { __fp: ClockHooks }).__fp.freeze(false));
  await waitState(page, 'REELING', 5_000);
  await expect(page.getByTestId('tension-bar')).toBeVisible();
  await expect(page.getByTestId('fight-panel')).toBeVisible();
  await page.mouse.down();
  await expect
    .poll(async () => Number(await page.getByTestId('tension-bar').getAttribute('aria-valuenow')), { timeout: 20_000 })
    .toBeGreaterThan(10);
  await expect.poll(() => state(page), { timeout: 90_000 }).not.toBe('REELING');
  await page.mouse.up();

  // Feedback de rompimento: diz o que aconteceu e o que fazer.
  const broken = await lastOutcome(page);
  expect(broken).toMatchObject({ outcome: 'escaped', reason: 'line_snapped' });
  await expect(page.getByTestId('escape-screen')).toBeVisible();
  await expect(page.getByTestId('escape-screen')).toContainText('linha arrebentou');
  await expect(page.getByTestId('escape-screen')).toContainText('Tente de novo');

  // 'Mostrar dicas' desligado nas configurações esconde o tutorial contextual.
  await page.getByTestId('result-menu').click();
  await waitState(page, 'MENU');
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-hints').uncheck();
  await page.getByTestId('panel-back').click();
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');
  await expect(page.getByTestId('hud-hint')).toBeHidden();

  expect(errors).toEqual([]);
});
