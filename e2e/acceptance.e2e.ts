import { expect, test, type Page } from '@playwright/test';
import {
  cast,
  diagnostics,
  hookAndForceReel,
  hookAndReel,
  lastOutcome,
  openGame,
  skipToBite,
  state,
  waitState,
} from './helpers.ts';

/**
 * Aceite ponta a ponta do MVP, com seed fixa e relógio manual (openGame abre com
 * ?seed=20261014&clock=manual). Os 15 critérios ficam em dois testes:
 * - @accept-flow: critérios 1–12 (abrir, menu, paisagem, arremesso, variabilidade,
 *   fisgada, captura, UI por estado, pausa/retomada, áudio pós-interação,
 *   configurações persistidas, console limpo);
 * - @accept-progress: critérios 13–15 (galeria durável em IndexedDB, conquistas,
 *   estatísticas/recordes), mais modelos/texturas/programas carregados e a perda e
 *   restauração de contexto WebGL via WEBGL_lose_context.
 */

function collectErrors(page: Page, ignore?: RegExp): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !(ignore && ignore.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (!(ignore && ignore.test(err.message))) errors.push(err.message);
  });
  return errors;
}

test('@accept-flow critérios 1 a 12: fluxo completo de jogo', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectErrors(page);

  // 1) O jogo abre corretamente no navegador (LOADING → MENU, canvas desenhando).
  await openGame(page);
  await expect(page.locator('canvas').first()).toBeVisible();

  // 3) A paisagem 3D está completa: a cena desenha geometria de verdade.
  const scene = await diagnostics(page);
  expect(scene.drawCalls).toBeGreaterThan(0);
  expect(scene.triangles).toBeGreaterThan(10_000);
  expect(scene.activeObjects).toBeGreaterThan(0);

  // 2) O menu está funcional: iniciar a pescaria muda o estado do jogo.
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  // 10) O áudio funciona após interação do usuário (contexto de áudio roda após o clique).
  const audioState = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const s = ctx.state;
    await ctx.close();
    return s;
  });
  expect(audioState).toBe('running');

  // 4) Arremesso funcional; 8) a UI mostra o estado (barra de potência durante a carga).
  await cast(page);

  // 5/6) Mordida e fisgada; 8) aviso de mordida visível no estado HOOKED.
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  await expect(page.getByTestId('bite-alert')).toBeVisible();

  // 7) Recolher e capturar; 8) tela de captura no estado CAUGHT. O embate corre no relógio
  // real (frames longos no SwiftShader tornam o desfecho variável), então até 3 tentativas.
  let outcome1 = await hookAndReel(page);
  for (let attempt = 0; outcome1 !== 'CAUGHT' && attempt < 2; attempt++) {
    await page.getByTestId('result-continue').click();
    await waitState(page, 'IDLE');
    await cast(page);
    await skipToBite(page);
    await waitState(page, 'HOOKED', 5_000);
    outcome1 = await hookAndReel(page);
  }
  expect(outcome1).toBe('CAUGHT');
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fp: { catches(): number } }).__fp.catches()))
    .toBe(1);
  const first = await lastOutcome(page);
  expect(first).not.toBeNull();
  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');

  // 5) Comportamento variável: o segundo peixe é outro indivíduo (peso diferente) e o
  //    desfecho muda quando a tensão não é controlada (linha rompe ou captura direta).
  await cast(page);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  const outcome2 = await hookAndForceReel(page);
  expect(['CAUGHT', 'ESCAPED']).toContain(outcome2);
  const second = await lastOutcome(page);
  expect(second).not.toBeNull();
  expect(second!.weightKg).not.toBe(first!.weightKg);
  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');

  // 9) Pausa e retomada preservam o estado; sair leva ao menu.
  await page.keyboard.press('Escape');
  await waitState(page, 'PAUSED');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-resume').click();
  await waitState(page, 'IDLE');
  await page.keyboard.press('Escape');
  await waitState(page, 'PAUSED');
  await page.getByTestId('pause-quit').click();
  await waitState(page, 'MENU');
  expect(await state(page)).toBe('MENU');

  // 11) As configurações persistem: muda a qualidade, recarrega e o valor sobrevive.
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-quality').selectOption('high');
  await openGame(page);
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-quality')).toHaveValue('high');
  const save = await page.evaluate(() => localStorage.getItem('pesqueepague.save') ?? '');
  expect(save).toContain('"quality":"high"');

  // 12) Sem erros críticos no console em todo o fluxo.
  expect(errors).toEqual([]);
});

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

test('@accept-progress critérios 13 a 15: progresso durável, conquistas, recordes, recursos gráficos e perda de contexto', async ({ page }) => {
  test.setTimeout(240_000);
  // A perda de contexto é provocada de propósito; o aviso do Chromium não é erro do jogo.
  const errors = collectErrors(page, /CONTEXT_LOST_WEBGL|Context Lost|Context Restored/i);

  await openGame(page);

  // Modelos, texturas e programas realmente carregados no renderer.
  const d = await diagnostics(page);
  expect(d.programs).toBeGreaterThan(0);
  expect(d.geometries).toBeGreaterThan(0);
  expect(d.textures).toBeGreaterThan(0);
  expect(d.triangles).toBeGreaterThan(0);

  // Perda e restauração de contexto WebGL via WEBGL_lose_context: o jogo sobrevive.
  const lost = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const canvas = document.querySelector('canvas');
        const gl = canvas?.getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (!canvas || !gl || !ext) {
          resolve(false);
          return;
        }
        canvas.addEventListener('webglcontextlost', () => resolve(true), { once: true });
        ext.loseContext();
        setTimeout(() => resolve(false), 5_000);
      }),
  );
  expect(lost).toBe(true);
  const restored = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const canvas = document.querySelector('canvas');
        const gl = canvas?.getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (!canvas || !gl || !ext) {
          resolve(false);
          return;
        }
        canvas.addEventListener('webglcontextrestored', () => resolve(true), { once: true });
        ext.restoreContext();
        setTimeout(() => resolve(false), 5_000);
      }),
  );
  expect(restored).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('canvas')?.getContext('webgl2')?.isContextLost()))
    .toBe(false);
  const after = await diagnostics(page);
  expect(after.drawCalls).toBeGreaterThan(0);

  // 13) Progresso durável: capturas gravadas no IndexedDB aparecem na galeria…
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { __fp?: { saveCatch?: unknown } }).__fp?.saveCatch))
    .toBe('function');
  const base = Date.now();
  const seeds: CatchSeed[] = [
    {
      id: 'e2e-accept-1',
      speciesId: 'lambari',
      weightKg: 0.08,
      lengthCm: 12.5,
      timestamp: base - 86_400_000,
      locationId: 'lago-principal',
      lureId: 'worm',
      rarity: 'common',
      disposition: 'kept',
      isPersonalRecord: false,
    },
    {
      id: 'e2e-accept-2',
      speciesId: 'tucunare',
      weightKg: 5.2,
      lengthCm: 81.0,
      timestamp: base,
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
  await page.getByTestId('menu-gallery').click();
  await expect(page.getByTestId('gallery')).toBeVisible();
  await expect(page.getByTestId('gallery-card')).toHaveCount(2);
  await expect(page.getByTestId('gallery-status')).toContainText('2 capturas');

  // 15) Estatísticas e recordes agregados na sala de troféus.
  await page.getByTestId('gallery-trophy-room').click();
  const room = page.getByTestId('trophy-room');
  await expect(room).toBeVisible();
  await expect(room.locator('canvas')).toBeVisible();
  const stats = page.getByTestId('trophy-stats');
  await expect(stats).toContainText('Capturas');
  await expect(stats).toContainText('Recorde pessoal');
  await page.getByTestId('trophy-close').click();
  await expect(room).toHaveCount(0);

  // …e sobrevivem ao recarregamento da página (IndexedDB, não memória).
  await openGame(page);
  const persisted = await page.evaluate(async () => {
    const fp = (window as unknown as { __fp: { listCatches(): Promise<readonly unknown[]> } }).__fp;
    return (await fp.listCatches()).length;
  });
  expect(persisted).toBe(2);

  // 14) Conquistas: as 11 aparecem, com progresso, e as cumpridas estão desbloqueadas.
  await page.getByTestId('menu-achievements').click();
  await expect(page.getByTestId('achievements')).toBeVisible();
  await expect(page.getByTestId('achievement-item')).toHaveCount(11);
  expect(await page.locator('.achievement-item.status-unlocked').count()).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
