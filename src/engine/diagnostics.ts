import type { Object3D, WebGLRenderer } from 'three';

export interface DiagnosticsSnapshot {
  readonly fps: number;
  /** Média móvel exponencial do intervalo entre frames, em ms. */
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
  /** Heap JS usado em MB; null quando o navegador não expõe performance.memory. */
  readonly memoryMB: number | null;
  /** Tempo gasto na simulação (jogo, visuais e UI) no último frame, em ms. */
  readonly simulationMs: number;
  /** Objetos visíveis no grafo da cena. */
  readonly activeObjects: number;
  readonly quality: string;
  readonly pixelRatio: number;
}

export interface DiagnosticsContext {
  readonly quality: string;
  readonly pixelRatio: number;
}

type MemoryInfo = { readonly usedJSHeapSize: number };

const EMA_WEIGHT = 0.1;

function readMemoryMB(): number | null {
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
  if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return null;
  return Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
}

/**
 * Mede o frame a partir do renderer.info. O renderer roda com info.autoReset = false porque o
 * pós-processamento desenha vários passes por frame: beginFrame zera e endFrame guarda o total.
 */
export class Diagnostics {
  private readonly renderer: WebGLRenderer;
  private readonly root: Object3D;
  private avgFrameMs = 0;
  private lastSimulationMs = 0;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private activeCount = 0;
  private readonly countVisible = (): void => {
    this.activeCount += 1;
  };

  constructor(renderer: WebGLRenderer, root: Object3D) {
    this.renderer = renderer;
    this.root = root;
  }

  beginFrame(): void {
    this.renderer.info.reset();
  }

  endFrame(frameMs: number, simulationMs: number): void {
    const render = this.renderer.info.render;
    this.lastDrawCalls = render.calls;
    this.lastTriangles = render.triangles;
    if (Number.isFinite(simulationMs) && simulationMs >= 0) this.lastSimulationMs = simulationMs;
    if (!(Number.isFinite(frameMs) && frameMs > 0)) return;
    this.avgFrameMs = this.avgFrameMs === 0 ? frameMs : this.avgFrameMs + (frameMs - this.avgFrameMs) * EMA_WEIGHT;
  }

  snapshot(context: DiagnosticsContext): DiagnosticsSnapshot {
    const info = this.renderer.info;
    this.activeCount = 0;
    this.root.traverseVisible(this.countVisible);
    return {
      fps: this.avgFrameMs > 0 ? Math.round(1000 / this.avgFrameMs) : 0,
      frameMs: Math.round(this.avgFrameMs * 100) / 100,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      memoryMB: readMemoryMB(),
      simulationMs: Math.round(this.lastSimulationMs * 100) / 100,
      activeObjects: this.activeCount,
      quality: context.quality,
      pixelRatio: Math.round(context.pixelRatio * 100) / 100,
    };
  }
}

export const DIAGNOSTICS_TOGGLE_KEY = 'F3';
const PANEL_REFRESH_MS = 250;

function formatSnapshot(s: DiagnosticsSnapshot): string {
  return [
    `FPS ${s.fps}  ·  frame ${s.frameMs.toFixed(1)} ms`,
    `draw calls ${s.drawCalls}  ·  triângulos ${s.triangles.toLocaleString('pt-BR')}`,
    `programas ${s.programs}  ·  geometrias ${s.geometries}  ·  texturas ${s.textures}`,
    s.memoryMB === null ? 'memória JS: indisponível neste navegador' : `memória JS ${s.memoryMB} MB`,
    `simulação ${s.simulationMs.toFixed(2)} ms  ·  objetos ativos ${s.activeObjects}`,
    `qualidade ${s.quality}  ·  pixel ratio ${s.pixelRatio}`,
  ].join('\n');
}

/** Painel opcional de diagnóstico, alternado pela tecla F3. Só atualiza enquanto está visível. */
export class DiagnosticsPanel {
  readonly root = document.createElement('pre');
  private readonly source: () => DiagnosticsSnapshot;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.key !== DIAGNOSTICS_TOGGLE_KEY || event.repeat) return;
    event.preventDefault();
    this.toggle();
  };

  constructor(container: HTMLElement, source: () => DiagnosticsSnapshot) {
    this.source = source;
    const root = this.root;
    root.className = 'diagnostics-panel';
    root.dataset['testid'] = 'diagnostics-panel';
    root.setAttribute('aria-label', 'Diagnóstico de desempenho');
    root.hidden = true;
    Object.assign(root.style, {
      position: 'absolute',
      top: '8px',
      left: '8px',
      zIndex: '50',
      margin: '0',
      padding: '8px 10px',
      font: '12px/1.4 ui-monospace, monospace',
      color: '#e8f5e9',
      background: 'rgba(0, 0, 0, 0.6)',
      borderRadius: '6px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    container.appendChild(root);
    window.addEventListener('keydown', this.handleKey);
  }

  get visible(): boolean {
    return this.root.hidden === false;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible && this.timer === null) {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), PANEL_REFRESH_MS);
    } else if (!visible && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.setVisible(false);
    window.removeEventListener('keydown', this.handleKey);
    this.root.remove();
  }

  private refresh(): void {
    this.root.textContent = formatSnapshot(this.source());
  }
}
