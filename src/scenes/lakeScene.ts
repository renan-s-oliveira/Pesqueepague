import { Fog, PerspectiveCamera, Scene } from 'three';
import { TextureProvider, createWoodTexture } from '../assets/textures.ts';
import { FirstPersonCamera } from '../engine/firstPersonCamera.ts';
import {
  GraphicsQualityManager,
  type QualityManagerOptions,
  type QualityPreset,
  type QualitySettings,
} from '../engine/GraphicsQualityManager.ts';
import { EngineRenderer } from '../engine/renderer.ts';
import { Rng } from '../utils/rng.ts';
import { disposeObject3D } from '../world/dispose.ts';
import { Lake } from '../world/lake.ts';
import { LAKE, PIER } from '../world/layout.ts';
import { Lighting } from '../world/lighting.ts';
import { AmbientParticles } from '../world/particles.ts';
import { createPier } from '../world/pier.ts';
import { SKY_COLORS, Sky } from '../world/sky.ts';
import { createTerrain } from '../world/terrain.ts';
import { Vegetation } from '../world/vegetation.ts';

export interface LakeSceneOptions {
  readonly seed: number;
  readonly maxPixelRatio: number;
  readonly quality?: Partial<QualityManagerOptions>;
}

const EYE_HEIGHT = 1.6;
const MAX_PARTICLES = 300;

/** Monta o lago completo e roda o loop; o loop de render não aloca objetos por frame. */
export class LakeScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 600);
  readonly engine: EngineRenderer;
  readonly look: FirstPersonCamera;
  readonly quality: GraphicsQualityManager;
  readonly lake: Lake;
  private readonly sky: Sky;
  private readonly lighting: Lighting;
  private readonly vegetation: Vegetation;
  private readonly particles: AmbientParticles;
  private readonly textures = new TextureProvider();
  private readonly rng: Rng;
  private readonly frameHooks = new Set<(deltaSeconds: number, elapsedSeconds: number) => void>();
  private nextAmbientRipple = 3;
  private hookDelta = 0;
  private hookElapsed = 0;
  /** Callback fixo para o forEach: evita criar iterador ou closure a cada frame. */
  private readonly runHook = (hook: (deltaSeconds: number, elapsedSeconds: number) => void): void => {
    hook(this.hookDelta, this.hookElapsed);
  };

  constructor(container: HTMLElement, options: LakeSceneOptions) {
    this.rng = new Rng(options.seed);
    this.quality = new GraphicsQualityManager(options.quality);
    this.engine = new EngineRenderer(container, this.camera, { maxPixelRatio: options.maxPixelRatio });

    const fog = new Fog(0xd9a77c, 70, 380);
    this.scene.fog = fog;

    this.sky = new Sky();
    this.lighting = new Lighting();
    const terrain = createTerrain(this.rng);
    this.lake = new Lake({ skyTop: SKY_COLORS.top, skyHorizon: SKY_COLORS.horizon, sun: SKY_COLORS.sun }, fog);
    this.vegetation = new Vegetation(this.rng, terrain.heightAt);
    const pier = createPier(this.textures.get('wood', () => createWoodTexture(options.seed)));
    this.particles = new AmbientParticles(this.rng, MAX_PARTICLES, {
      minX: -35,
      maxX: 35,
      minY: 0.4,
      maxY: 5,
      minZ: -30,
      maxZ: PIER.zShore + 6,
    });
    this.scene.add(
      this.sky.mesh,
      this.lighting.group,
      terrain.mesh,
      this.lake.mesh,
      this.vegetation.group,
      pier,
      this.particles.points,
    );

    this.look = new FirstPersonCamera(this.camera, { minYaw: -1.4, maxYaw: 1.4, minPitch: -0.6, maxPitch: 0.35 });
    this.look.setPosition(PIER.x, PIER.deckY + EYE_HEIGHT, PIER.zEnd + 1);
    this.scene.add(this.camera);

    this.applyQuality(this.quality.settings);
  }

  start(): void {
    this.engine.start(this.frame);
  }

  stop(): void {
    this.engine.stop();
  }

  setQualityPreset(preset: QualityPreset): void {
    if (this.quality.setPreset(preset)) this.applyQuality(this.quality.settings);
  }

  /** Registra uma atualização por frame (jogo, visuais, UI). Devolve a função que remove. */
  addFrameHook(hook: (deltaSeconds: number, elapsedSeconds: number) => void): () => void {
    this.frameHooks.add(hook);
    return () => {
      this.frameHooks.delete(hook);
    };
  }

  get canvas(): HTMLCanvasElement {
    return this.engine.renderer.domElement;
  }

  dispose(): void {
    this.engine.stop();
    this.frameHooks.clear();
    this.lighting.dispose();
    disposeObject3D(this.scene);
    this.textures.dispose();
    this.engine.dispose();
  }

  private readonly frame = (deltaSeconds: number, elapsedSeconds: number, frameMs: number): void => {
    if (this.quality.sample(frameMs)) this.applyQuality(this.quality.settings);
    this.spawnAmbientRipple(elapsedSeconds);
    this.lake.update(elapsedSeconds);
    this.sky.update(elapsedSeconds, this.camera);
    this.particles.update(deltaSeconds, elapsedSeconds);
    this.hookDelta = deltaSeconds;
    this.hookElapsed = elapsedSeconds;
    this.frameHooks.forEach(this.runHook);
    this.engine.renderer.render(this.scene, this.camera);
  };

  /** Peixes beliscando a superfície de tempos em tempos: posição e intervalo vêm do RNG com seed. */
  private spawnAmbientRipple(elapsedSeconds: number): void {
    if (elapsedSeconds < this.nextAmbientRipple) return;
    const angle = this.rng.range(0, Math.PI * 2);
    const distance = this.rng.range(3, LAKE.radius * 0.8);
    this.lake.addRipple(
      LAKE.centerX + Math.cos(angle) * distance,
      LAKE.centerZ + Math.sin(angle) * distance,
      this.rng.range(0.4, 1),
      elapsedSeconds,
    );
    this.nextAmbientRipple = elapsedSeconds + this.rng.range(2.5, 7);
  }

  private applyQuality(settings: QualitySettings): void {
    this.engine.setPixelRatioScale(settings.pixelRatioScale);
    this.lighting.setShadows(settings.shadows, settings.shadowMapSize);
    this.vegetation.setDensity(settings.vegetationDensity);
    this.particles.setActiveCount(settings.particleCount);
    this.lake.setDetail(settings.waterDetail);
  }
}
