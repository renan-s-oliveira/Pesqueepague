import { expect, test, type Page } from '@playwright/test';
import { cast, openGame, skipToBite, waitState } from './helpers.ts';

/**
 * Medição de performance (@perf): frame time médio e percentis nos 5 presets (Baixo, Médio,
 * Alto, Ultra e Auto) e heap antes/depois de 20 ciclos de pesca. Os números saem em JSON no
 * stdout (linha que começa com PERF_RESULT). Roda no Chromium headless com SwiftShader
 * (ver playwright.config.ts): mede CPU/renderização por software, não uma GPU real.
 * As janelas são curtas de propósito para a medição inteira terminar em menos de 240 s;
 * os ciclos usam o relógio manual do jogo para acelerar a briga sem pular a simulação.
 */

const PRESETS = [
  { id: 'low', label: 'Baixa' },
  { id: 'medium', label: 'Média' },
  { id: 'high', label: 'Alta' },
  { id: 'ultra', label: 'Ultra' },
  { id: 'auto', label: 'Auto' },
] as const;

const WARMUP_MS = 500;
const WINDOW_MS = 4_000;
/** Sob SwiftShader um frame pode levar vários segundos; cada preset amostra até juntar MIN_FRAMES deltas, com teto duro. */
const MIN_FRAMES = 6;
const HARD_CAP_MS = 20_000;
const FISHING_CYCLES = 20;

/** Orçamento por preset (docs/architecture/evolucao-realismo.md, seção 6). Auto nunca passa do Alto. */
const BUDGET: Record<string, { drawCalls: number; triangles: number }> = {
  low: { drawCalls: 90, triangles: 150_000 },
  medium: { drawCalls: 150, triangles: 300_000 },
  high: { drawCalls: 240, triangles: 600_000 },
  ultra: { drawCalls: 320, triangles: 900_000 },
  auto: { drawCalls: 240, triangles: 600_000 },
};

interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fps: number;
}

type PerfHooks = {
  setQuality(q: string): void;
  state(): string;
  tension(): number;
  advance(ms: number): void;
  freeze(frozen: boolean): void;
  getDiagnostics(): { drawCalls: number; triangles: number; programs: number; quality: string };
};

/** Intervalos entre callbacks de requestAnimationFrame (timestamp do navegador, não o relógio manual do jogo). */
async function sampleFrames(page: Page, warmupMs: number, windowMs: number): Promise<FrameStats> {
  const deltas = await page.evaluate(
    ({ warmupMs, windowMs, minFrames, hardCapMs }) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let start = -1;
        let last = -1;
        const tick = (t: number): void => {
          if (start < 0) start = t;
          const elapsed = t - start;
          if (elapsed >= warmupMs) {
            if (last >= 0) out.push(t - last);
            last = t;
          }
          const enough = elapsed >= warmupMs + windowMs && out.length >= minFrames;
          if (enough || elapsed >= hardCapMs) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { warmupMs, windowMs, minFrames: MIN_FRAMES, hardCapMs: HARD_CAP_MS },
  );
  // Mesmo no teto duro precisa haver pelo menos 2 deltas para média e percentis grosseiros.
  expect(deltas.length).toBeGreaterThan(1);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const r = (n: number): number => Math.round(n * 100) / 100;
  return {
    frames: deltas.length,
    meanMs: r(mean),
    p50Ms: r(pct(50)),
    p95Ms: r(pct(95)),
    p99Ms: r(pct(99)),
    maxMs: r(sorted[sorted.length - 1]!),
    fps: r(1000 / mean),
  };
}

/**
 * Um ciclo completo acelerado: arremesso e mordida como nos e2e, e a briga com o relógio
 * do jogo congelado avançando 150 ms por frame real — a simulação roda inteira (passos
 * fixos de 20 ms), só o tempo de parede encolhe. A decisão de recolher usa a mesma
 * tensão da UI; o desfecho pode ser CAUGHT ou ESCAPED, ambos fecham o ciclo.
 */
async function fishCycleFast(page: Page): Promise<string> {
  await cast(page, 350);
  await skipToBite(page);
  await waitState(page, 'HOOKED', 5_000);
  await page.mouse.down();
  await page.mouse.up();
  const outcome = await page.evaluate(async () => {
    const fp = (window as unknown as { __fp: PerfHooks }).__fp;
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
    fp.freeze(true);
    for (let i = 0; i < 300 && fp.state() === 'HOOKED'; i++) {
      fp.advance(20);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    for (let i = 0; i < 4000 && fp.state() === 'REELING'; i++) {
      set(fp.tension() < 0.5);
      fp.advance(150);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    set(false);
    fp.freeze(false);
    return fp.state();
  });
  expect(['CAUGHT', 'ESCAPED']).toContain(outcome);
  await page.getByTestId('result-continue').click();
  await waitState(page, 'IDLE');
  return outcome;
}

declare global {
  interface Window {
    __fp: PerfHooks;
  }
}

test('@perf frame time nos 5 presets e heap em 20 ciclos de pesca', async ({ page, browserName }) => {
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  const heap = async (): Promise<{ usedMB: number; totalMB: number; perfMemoryUsedMB: number | null }> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const usage = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; totalSize: number };
    const perfMem = await page.evaluate(
      () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    );
    const mb = (b: number): number => Math.round((b / 1048576) * 100) / 100;
    return { usedMB: mb(usage.usedSize), totalMB: mb(usage.totalSize), perfMemoryUsedMB: perfMem === null ? null : mb(perfMem) };
  };

  await openGame(page);
  await page.getByTestId('menu-play').click();
  await waitState(page, 'IDLE');

  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'sem WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });

  const frames: Record<string, FrameStats & { label: string; drawCalls: number; triangles: number; budget: { drawCalls: number; triangles: number }; withinBudget: boolean }> = {};
  for (const preset of PRESETS) {
    await page.evaluate((q) => window.__fp.setQuality(q), preset.id);
    const stats = await sampleFrames(page, WARMUP_MS, WINDOW_MS);
    const d = await page.evaluate(() => window.__fp.getDiagnostics());
    const budget = BUDGET[preset.id]!;
    frames[preset.id] = {
      label: preset.label,
      ...stats,
      drawCalls: d.drawCalls,
      triangles: d.triangles,
      budget,
      withinBudget: d.drawCalls <= budget.drawCalls && d.triangles <= budget.triangles,
    };
  }

  // Ciclos no preset Baixo: frames mais curtos encolhem o tempo de parede dos 20 ciclos
  // sem mudar o que se mede (alocações por ciclo de pesca, não custo de render).
  await page.evaluate(() => window.__fp.setQuality('low'));
  const heapBefore = await heap();
  const outcomes: string[] = [];
  for (let i = 0; i < FISHING_CYCLES; i++) outcomes.push(await fishCycleFast(page));
  const heapAfter = await heap();

  const result = {
    browser: browserName,
    userAgent: await page.evaluate(() => navigator.userAgent),
    webglRenderer: renderer,
    viewport: page.viewportSize(),
    warmupMs: WARMUP_MS,
    windowMs: WINDOW_MS,
    frames,
    heap: {
      presetDuringCycles: 'low',
      cycles: FISHING_CYCLES,
      outcomes,
      before: heapBefore,
      after: heapAfter,
      deltaUsedMB: Math.round((heapAfter.usedMB - heapBefore.usedMB) * 100) / 100,
    },
  };
  console.log(`PERF_RESULT ${JSON.stringify(result)}`);
  expect(outcomes).toHaveLength(FISHING_CYCLES);
});
