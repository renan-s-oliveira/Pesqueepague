import { expect, type Page } from '@playwright/test';

export const SEED = 20261014;

type HookName = 'state' | 'tension' | 'catches';

export async function hook<T>(page: Page, name: HookName): Promise<T> {
  return page.evaluate((n) => (window as unknown as Record<string, Record<string, () => unknown>>)['__fp']![n]!(), name) as Promise<T>;
}

export const state = (page: Page): Promise<string> => hook<string>(page, 'state');

/**
 * Abre o jogo com seed, relógio manual e pointer lock desligado (só funcionam no Vite em --mode e2e)
 * e espera o menu. Sem o lock, sair dele no headless não vira pausa no meio da pesca.
 */
export async function openGame(page: Page): Promise<void> {
  await page.goto(`/?seed=${SEED}&clock=manual&pointerlock=off`);
  await expect(page.getByTestId('menu-play')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => state(page)).toBe('MENU');
}

export async function waitState(page: Page, wanted: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => state(page), { timeout }).toBe(wanted);
}

type ClockHooks = { state(): string; advance(ms: number): void; freeze(frozen: boolean): void };

/**
 * Avança o relógio do jogo em passos curtos até sair de WAITING (a mordida não é pulada).
 * Se o peixe mordeu, congela o relógio do jogo: a janela de fisgada não corre enquanto o teste
 * confere o alerta; hookAndReel descongela logo depois de fisgar.
 */
export async function skipToBite(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fp = (window as unknown as { __fp: ClockHooks }).__fp;
    for (let i = 0; i < 4000 && fp.state() === 'WAITING'; i++) {
      fp.advance(50);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    if (fp.state() === 'HOOKED') fp.freeze(true);
  });
}

/** Arremessa segurando o botão; devolve quando a isca está na água. */
export async function cast(page: Page, holdMs = 800): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas do jogo não encontrado');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('power-bar')).toBeVisible();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await waitState(page, 'WAITING');
}

/**
 * Fisga e recolhe segurando abaixo de 60% de tensão até o fim do embate.
 * A decisão roda a cada frame dentro da página: pelo round-trip do Playwright a tensão
 * passava do limite entre duas leituras e a linha rompia. Os eventos são os mesmos do mouse
 * (pointerdown no canvas, pointerup na janela), então o caminho de input é o real.
 */
export async function hookAndReel(page: Page): Promise<string> {
  await page.mouse.down();
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as { __fp: ClockHooks }).__fp.freeze(false));
  await waitState(page, 'REELING', 5_000);
  return page.evaluate(async () => {
    const fp = (window as unknown as { __fp: { state(): string; tension(): number } }).__fp;
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas do jogo não encontrado');
    const init = { button: 0, pointerType: 'mouse', bubbles: true, isPrimary: true } as const;
    let pressed = false;
    const set = (want: boolean): void => {
      if (want === pressed) return;
      if (want) canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      else window.dispatchEvent(new PointerEvent('pointerup', init));
      pressed = want;
    };
    const deadline = performance.now() + 120_000;
    while (fp.state() === 'REELING' && performance.now() < deadline) {
      set(fp.tension() < 0.6);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    set(false);
    return fp.state();
  });
}

/** Uma pesca completa a partir de IDLE: arremesso, mordida, fisgada e recolhimento. */
export async function fishOnce(page: Page): Promise<string> {
  await cast(page);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  return hookAndReel(page);
}
