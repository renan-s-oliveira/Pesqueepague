import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type AntialiasMode = 'fxaa' | 'smaa';

export interface PostProcessingSettings {
  readonly antialias: AntialiasMode;
  /** Oclusão de ambiente GTAO; 0 desliga, acima disso é a intensidade da mistura em (0, 1]. */
  readonly ambientOcclusion: number;
  /** Força do bloom; 0 desliga. Mantido baixo para só realçar o sol e os reflexos. */
  readonly bloomStrength: number;
}

/** Exposição calibrada para o ACES com o céu de fim de tarde: o horizonte fica abaixo do branco puro. */
export const CALIBRATED_EXPOSURE = 0.95;
const BLOOM_RADIUS = 0.35;
/** Só o que passa do branco (sol, brilho especular da água) acende o bloom. */
const BLOOM_THRESHOLD = 0.92;

/**
 * Cadeia RenderPass → GTAO → bloom → OutputPass (tone mapping + sRGB) → FXAA ou SMAA.
 * O antialiasing roda depois do OutputPass porque os dois trabalham sobre a cor já em sRGB.
 */
export class PostProcessingPipeline {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly outputPass = new OutputPass();
  private readonly scene: Scene;
  private readonly camera: Camera;
  private optional: Pass[] = [];
  private current: PostProcessingSettings | null = null;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outputPass);
  }

  get settings(): PostProcessingSettings | null {
    return this.current;
  }

  /** Quantos passes estão na cadeia, para o diagnóstico. */
  get passCount(): number {
    return this.composer.passes.length;
  }

  configure(settings: PostProcessingSettings): void {
    if (!(Number.isFinite(settings.ambientOcclusion) && settings.ambientOcclusion >= 0 && settings.ambientOcclusion <= 1)) {
      throw new RangeError('ambientOcclusion deve estar entre 0 e 1');
    }
    if (!(Number.isFinite(settings.bloomStrength) && settings.bloomStrength >= 0 && settings.bloomStrength <= 1)) {
      throw new RangeError('bloomStrength deve estar entre 0 e 1');
    }
    if (settings.antialias !== 'fxaa' && settings.antialias !== 'smaa') {
      throw new RangeError(`antialias inválido: ${String(settings.antialias)}; use fxaa ou smaa`);
    }
    const c = this.current;
    if (
      c &&
      c.antialias === settings.antialias &&
      c.ambientOcclusion === settings.ambientOcclusion &&
      c.bloomStrength === settings.bloomStrength
    ) {
      return;
    }
    this.current = settings;
    this.disposeOptional();

    const size = this.composer.renderer.getDrawingBufferSize(new Vector2());
    const before: Pass[] = [];
    if (settings.ambientOcclusion > 0) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = settings.ambientOcclusion;
      before.push(ao);
    }
    if (settings.bloomStrength > 0) {
      before.push(new UnrealBloomPass(size.clone(), settings.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD));
    }
    const aa = settings.antialias === 'smaa' ? new SMAAPass() : new FXAAPass();

    this.composer.passes.length = 0;
    this.composer.addPass(this.renderPass);
    for (const pass of before) this.composer.addPass(pass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(aa);
    this.optional = [...before, aa];
  }

  setPixelRatio(pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(deltaSeconds: number): void {
    this.composer.render(deltaSeconds);
  }

  dispose(): void {
    this.disposeOptional();
    this.renderPass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
  }

  private disposeOptional(): void {
    for (const pass of this.optional) pass.dispose();
    this.optional = [];
  }
}
