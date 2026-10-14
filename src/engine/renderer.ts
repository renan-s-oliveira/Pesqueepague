import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer, type PerspectiveCamera } from 'three';

export interface EngineRendererOptions {
  readonly maxPixelRatio: number;
}

export type FrameCallback = (deltaSeconds: number, elapsedSeconds: number, frameMs: number) => void;

/** Passo máximo da simulação: evita salto grande quando a aba volta ou o frame trava. */
const MAX_DELTA_SECONDS = 0.1;

/** Renderer WebGL2 com ACES, saída sRGB, pixel ratio controlado e loop pausado com a aba oculta. */
export class EngineRenderer {
  readonly renderer: WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly camera: PerspectiveCamera;
  private readonly maxPixelRatio: number;
  private pixelRatioScale = 1;
  private onFrame: FrameCallback | null = null;
  private running = false;
  private lastTime = -1;
  private elapsed = 0;

  private readonly handleResize = (): void => this.resize();
  private readonly handleVisibility = (): void => this.syncLoop();
  private readonly loop = (time: number): void => {
    const frameMs = this.lastTime < 0 ? 0 : time - this.lastTime;
    this.lastTime = time;
    const delta = Math.min(frameMs / 1000, MAX_DELTA_SECONDS);
    this.elapsed += delta;
    this.onFrame?.(delta, this.elapsed, frameMs);
  };

  constructor(container: HTMLElement, camera: PerspectiveCamera, options: EngineRendererOptions) {
    if (!(Number.isFinite(options.maxPixelRatio) && options.maxPixelRatio >= 0.5 && options.maxPixelRatio <= 4)) {
      throw new RangeError('maxPixelRatio deve estar entre 0.5 e 4');
    }
    this.container = container;
    this.camera = camera;
    this.maxPixelRatio = options.maxPixelRatio;

    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer = renderer;

    container.appendChild(renderer.domElement);
    this.applyPixelRatio();
    this.resize();
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /** Escala da resolução interna em [0.25, 1], aplicada sobre min(devicePixelRatio, maxPixelRatio). */
  setPixelRatioScale(scale: number): void {
    if (!(Number.isFinite(scale) && scale >= 0.25 && scale <= 1)) {
      throw new RangeError('a escala de pixel ratio deve estar entre 0.25 e 1');
    }
    if (scale === this.pixelRatioScale) return;
    this.pixelRatioScale = scale;
    this.applyPixelRatio();
    this.resize();
  }

  start(onFrame: FrameCallback): void {
    this.onFrame = onFrame;
    this.running = true;
    this.syncLoop();
  }

  stop(): void {
    this.running = false;
    this.syncLoop();
  }

  dispose(): void {
    this.stop();
    this.onFrame = null;
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private syncLoop(): void {
    if (this.running && document.visibilityState !== 'hidden') {
      this.lastTime = -1;
      this.renderer.setAnimationLoop(this.loop);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  private applyPixelRatio(): void {
    const device = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(Math.max(0.5, device * this.pixelRatioScale));
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
