import { expect, test, type Page } from '@playwright/test';
import { fishOnce, openGame, waitState } from './helpers.ts';

/**
 * Medição de performance (@perf): frame time médio e p95 por preset e heap antes/depois de
 * 5 ciclos de pesca. Os números saem em JSON no stdout (linha que começa com PERF_RESULT).
 * Roda no Chromium headless com SwiftShader (ver playwright.config.ts): mede a CPU/renderização
 * por software, não uma GPU real.
 */

const PRESETS = [
  { id: 'low', label: 'Baixa' },
  { id: 'medium', label: 'Média' },
  { id: 'high', label: 'Alta' },
] as const;

const WARMUP_MS = 1_000;
const WINDOW_MS = 5_000;
const FISHING_CYCLES = 5;

interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  fps: number;
}

type PerfHooks = { setQuality(q: string): void; state(): string; catches(): number };

/** Intervalos entre callbacks de requestAnimationFrame (timestamp do navegador, não o relógio manual do jogo). */
async function sampleFrames(page: Page, warmupMs: number, windowMs: number): Promise<FrameStats> {
  const deltas = await page.evaluate(
    ({ warmupMs, windowMs }) =>
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
          if (elapsed >= warmupMs + windowMs) resolve(out);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { warmupMs, windowMs },
  );
  expect(deltas.length).toBeGreaterThan(10);
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

test('@perf frame time por preset e heap em 5 ciclos de pesca', async ({ page, browserName }) => {
  test.setTimeout(600_000);
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

  const frames: Record<string, FrameStats & { label: string }> = {};
  for (const preset of PRESETS) {
    await page.evaluate((q) => (window as unknown as { __fp: PerfHooks }).__fp.setQuality(q), preset.id);
    frames[preset.id] = { label: preset.label, ...(await sampleFrames(page, WARMUP_MS, WINDOW_MS)) };
  }

  await page.evaluate(() => (window as unknown as { __fp: PerfHooks }).__fp.setQuality('medium'));
  const heapBefore = await heap();
  const outcomes: string[] = [];
  for (let i = 0; i < FISHING_CYCLES; i++) {
    const outcome = await fishOnce(page);
    outcomes.push(outcome);
    await page.getByTestId('result-continue').click();
    await waitState(page, 'IDLE');
  }
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
      presetDuringCycles: 'medium',
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
