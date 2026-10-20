import { Color, Fog, PerspectiveCamera, SRGBColorSpace, Scene, Vector3 } from 'three';
import { TextureProvider, createTerrainDetailTexture, createWoodTexture } from '../assets/textures.ts';
import { Diagnostics, type DiagnosticsSnapshot } from '../engine/diagnostics.ts';
import { FirstPersonCamera } from '../engine/firstPersonCamera.ts';
import {
  GraphicsQualityManager,
  type QualityManagerOptions,
  type QualityPreset,
  type QualitySettings,
} from '../engine/GraphicsQualityManager.ts';
import { EngineRenderer } from '../engine/renderer.ts';
import { Rng } from '../utils/rng.ts';
import { getLake, type LakeId } from '../world/lakes.ts';
import { LakeBiomes } from '../world/biomes.ts';
import { disposeObject3D } from '../world/dispose.ts';
import { Lake } from '../world/lake.ts';
import { LAKE, PIER } from '../world/layout.ts';
import { Lighting } from '../world/lighting.ts';
import { AmbientParticles, RainParticles } from '../world/particles.ts';
import { createPier } from '../world/pier.ts';
import { SplashPool, isSplashKind, type SplashKind } from '../world/splash.ts';
import { SKY_COLORS, Sky } from '../world/sky.ts';
import { createTerrain } from '../world/terrain.ts';
import { TimeOfDay, moonDirectionAt, paletteAt, sunDirectionAt } from '../world/timeOfDay.ts';
import { Underwater } from '../world/underwater.ts';
import { Vegetation } from '../world/vegetation.ts';
import { Fauna } from '../world/fauna.ts';
import { Weather, fogRange, isWeatherKind, type WeatherKind, type Wind } from '../world/weather.ts';

export interface LakeSceneOptions {
  readonly seed: number;
  readonly maxPixelRatio: number;
  readonly quality?: Partial<QualityManagerOptions>;
}

const EYE_HEIGHT = 1.6;
const MAX_PARTICLES = 300;
const MAX_RAIN_DROPS = 4000;
const RAIN_SEED_SALT = 0x5f3759df;
const SPLASH_SEED_SALT = 0x2545f491;
const MAX_SPLASH_DROPS = 400;
/** Hora e cobertura mudam o env map só a partir destes passos (o PMREM é caro). */
const ENV_HOUR_STEP = 0.25;
const ENV_COVER_STEP = 0.1;
/** Abaixo destes passos a paleta não é recalculada: o frame não aloca toda vez. */
const PALETTE_HOUR_STEP = 0.01;
const PALETTE_COVER_STEP = 0.01;

export interface AtmosphereSnapshot {
  readonly hour: number;
  readonly weather: WeatherKind;
  readonly cloudCover: number;
  readonly rainDrops: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly wind: Wind;
}
/** Piso da resolução dinâmica do Auto antes de baixar o nível. */
const AUTO_MIN_RESOLUTION_SCALE = 0.7;

/** Monta o lago completo e roda o loop; o loop de render não aloca objetos por frame. */
export class LakeScene {
  private biomeId: LakeId = 'tropical';
  private readonly biomes: LakeBiomes;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 600);
  readonly engine: EngineRenderer;
  readonly look: FirstPersonCamera;
  readonly quality: GraphicsQualityManager;
  readonly diagnostics: Diagnostics;
  readonly lake: Lake;
  /** Fundo do lago; `underwater.depthAt(x, z)` é a profundidade consultada pela AI dos peixes. */
  readonly underwater: Underwater;
  private readonly sky: Sky;
  private readonly lighting: Lighting;
  private readonly vegetation: Vegetation;
  private readonly fauna: Fauna;
  private readonly particles: AmbientParticles;
  private readonly rain: RainParticles;
  readonly splash: SplashPool;
  private readonly fog: Fog;
  readonly timeOfDay = new TimeOfDay();
  readonly weather = new Weather();
  private particleBudget = 1;
  private paletteHour = Number.NaN;
  private paletteCover = Number.NaN;
  private envHour = Number.NaN;
  private envCover = Number.NaN;
  private hookTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sunDir = new Vector3();
  private readonly moonDir = new Vector3();
  private readonly overcast = new Color();
  private readonly keyColor = new Color();
  private readonly hemiSky = new Color();
  private readonly keyLight = {
    direction: new Vector3(),
    color: this.keyColor,
    intensity: 1,
    hemiSky: this.hemiSky,
    hemiGround: SKY_COLORS.ground,
    hemiIntensity: 1,
  };
  private readonly skyState = { sunDirection: this.sunDir, moonDirection: this.moonDir, daylight: 1, cloudCover: 0 };
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
    this.biomes = new LakeBiomes(options.seed);
    this.quality = new GraphicsQualityManager({ minResolutionScale: AUTO_MIN_RESOLUTION_SCALE, ...options.quality });
    this.engine = new EngineRenderer(container, this.camera, { maxPixelRatio: options.maxPixelRatio });
    this.engine.attachScene(this.scene, this.quality.settings.postProcessing);
    this.diagnostics = new Diagnostics(this.engine.renderer, this.scene);

    const fog = new Fog(0xd9a77c, 70, 380);
    this.fog = fog;
    this.scene.fog = fog;

    this.sky = new Sky();
    this.lighting = new Lighting();
    const terrain = createTerrain(
      this.rng,
      this.textures.get('terrainDetail', () => createTerrainDetailTexture(options.seed)),
    );
    this.underwater = new Underwater(options.seed, terrain.heightAt);
    this.lake = new Lake({ skyTop: SKY_COLORS.top, skyHorizon: SKY_COLORS.horizon, sun: SKY_COLORS.sun }, fog, this.underwater.bedHeightAt);
    this.splash = new SplashPool(new Rng((options.seed ^ SPLASH_SEED_SALT) >>> 0), MAX_SPLASH_DROPS, LAKE.waterLevel);
    this.lake.setImpactListener((x, z, kind, strength) => {
      this.splash.emit(x, z, kind, strength);
    });
    this.vegetation = new Vegetation(this.rng, terrain.heightAt);
    this.fauna = new Fauna(new Rng((options.seed ^ 0x5eed_fa1a) >>> 0));
    const pier = createPier(this.textures.get('wood', () => createWoodTexture(options.seed)));
    this.particles = new AmbientParticles(this.rng, MAX_PARTICLES, {
      minX: -35,
      maxX: 35,
      minY: 0.4,
      maxY: 5,
      minZ: -30,
      maxZ: PIER.zShore + 6,
    });
    this.rain = new RainParticles(new Rng((options.seed ^ RAIN_SEED_SALT) >>> 0), MAX_RAIN_DROPS, {
      minX: -30,
      maxX: 30,
      minY: -0.2,
      maxY: 18,
      minZ: -10,
      maxZ: PIER.zShore + 10,
    });
    this.scene.add(
      this.biomes.group,
      this.sky.mesh,
      this.lighting.group,
      terrain.mesh,
      this.underwater.group,
      this.lake.mesh,
      this.vegetation.group,
      this.fauna.group,
      pier,
      this.particles.points,
      this.rain.points,
      this.splash.points,
    );

    this.look = new FirstPersonCamera(this.camera, { minYaw: -1.4, maxYaw: 1.4, minPitch: -0.6, maxPitch: 0.35 });
    this.look.setPosition(PIER.x, PIER.deckY + EYE_HEIGHT, PIER.zEnd + 1);
    this.scene.add(this.camera);

    this.applyQuality(this.quality.settings);
    this.updateAtmosphere(true);
    if (import.meta.env.MODE === 'e2e') this.exposeTestHooks(0);
  }

  /** Hora do dia em [0, 24); reflete na luz, no céu, na névoa e no env map já no próximo frame. */
  setTime(hour: number): void {
    this.timeOfDay.setTime(hour);
    this.updateAtmosphere(true);
  }

  setLake(id: LakeId): void {
    this.biomeId = id;
    this.biomes.setLake(id);
    this.vegetation.group.visible = id !== 'serra';
    const biome = getLake(id);
    const uniforms = this.lake.mesh.material.uniforms;
    (uniforms['uDeep']!.value as Color).set(biome.water).multiplyScalar(.5);
    (uniforms['uShallow']!.value as Color).set(biome.water);
    (uniforms['uSand']!.value as Color).set(biome.terrain);
    this.setTime(biome.hour);
    this.setWeather(id === 'igapo' ? 'cloudy' : 'clear', true);
  }

  setWeather(kind: WeatherKind, immediate = false): void {
    this.weather.setWeather(kind, immediate);
    this.updateAtmosphere(immediate);
  }

  getAtmosphere(): AtmosphereSnapshot {
    const wind = this.weather.getWind();
    return {
      hour: this.timeOfDay.hour,
      weather: this.weather.kind,
      cloudCover: this.weather.cloudCover,
      rainDrops: this.rain.activeCount,
      fogNear: this.fog.near,
      fogFar: this.fog.far,
      wind: { x: wind.x, z: wind.z, speed: wind.speed },
    };
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

  getDiagnostics(): DiagnosticsSnapshot {
    const preset = this.quality.preset;
    const quality = preset === 'auto' ? `auto (${this.quality.level})` : preset;
    return this.diagnostics.snapshot({ quality, pixelRatio: this.engine.pixelRatio });
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
    if (this.hookTimer !== null) clearTimeout(this.hookTimer);
    this.lighting.dispose();
    this.lake.dispose();
    disposeObject3D(this.scene);
    this.textures.dispose();
    this.engine.dispose();
  }

  private readonly frame = (deltaSeconds: number, elapsedSeconds: number, frameMs: number): void => {
    if (this.quality.sample(frameMs)) this.applyQuality(this.quality.settings);
    this.diagnostics.beginFrame();
    const simStart = performance.now();
    this.spawnAmbientRipple(elapsedSeconds);
    this.timeOfDay.update(deltaSeconds);
    this.weather.update(deltaSeconds);
    this.updateAtmosphere(false);
    const wind = this.weather.getWind();
    this.lake.update(elapsedSeconds, wind);
    this.underwater.update(elapsedSeconds);
    this.splash.update(deltaSeconds);
    this.sky.update(deltaSeconds, this.camera, wind.x, wind.z);
    this.vegetation.update(elapsedSeconds, wind);
    this.fauna.update(elapsedSeconds);
    this.particles.update(deltaSeconds, elapsedSeconds, wind);
    this.rain.update(deltaSeconds, wind);
    this.hookDelta = deltaSeconds;
    this.hookElapsed = elapsedSeconds;
    this.frameHooks.forEach(this.runHook);
    const simulationMs = performance.now() - simStart;
    this.lake.renderReflection(this.engine.renderer, this.scene, this.camera);
    this.engine.render(this.scene, deltaSeconds);
    this.diagnostics.endFrame(frameMs, simulationMs);
  };

  /** Ondulação + splash de um impacto na água (isca, salto ou captura). */
  triggerSplash(x: number, z: number, kind: SplashKind): void {
    const strength = kind === 'lure' ? 0.7 : kind === 'jump' ? 1.2 : 1.8;
    this.lake.addRipple(x, z, strength, this.hookElapsed, false);
    this.splash.emit(x, z, kind, strength);
  }

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
      false,
    );
    this.nextAmbientRipple = elapsedSeconds + this.rng.range(2.5, 7);
  }

  private applyQuality(settings: QualitySettings): void {
    this.engine.setPixelRatioScale(this.quality.pixelRatioScale);
    this.engine.configurePostProcessing(settings.postProcessing);
    this.lighting.setShadows(settings.shadows, settings.shadowMapSize);
    this.vegetation.setDensity(settings.vegetationDensity);
    this.fauna.setDensity(settings.vegetationDensity);
    this.particles.setActiveCount(settings.particleCount);
    this.particleBudget = Math.min(1, settings.particleCount / MAX_PARTICLES);
    this.rain.setIntensity(this.weather.rainIntensity, this.particleBudget);
    this.splash.setBudget(this.particleBudget);
    this.underwater.setQuality(settings.level, this.particleBudget);
    this.lake.setDetail(settings.waterDetail);
    const planar = settings.level === 'high' || settings.level === 'ultra';
    this.lake.setPlanarReflection(planar, settings.level === 'ultra' ? 1 : 0.5);
  }

  /**
   * Hora + clima → céu, luz, névoa, chuva e env map. A paleta só é recalculada quando a hora ou a
   * cobertura mudam o bastante; o env map, em passos maiores.
   */
  private updateAtmosphere(force: boolean): void {
    const hour = this.timeOfDay.hour;
    const cover = this.weather.cloudCover;
    this.rain.setIntensity(this.weather.rainIntensity, this.particleBudget);
    if (!force && hourDistance(hour, this.paletteHour) < PALETTE_HOUR_STEP && Math.abs(cover - this.paletteCover) < PALETTE_COVER_STEP) {
      return;
    }
    this.paletteHour = hour;
    this.paletteCover = cover;
    const p = paletteAt(hour);
    const o = Math.max(0, (cover - 0.3) / 0.7);
    sunDirectionAt(hour, this.sunDir);
    moonDirectionAt(hour, this.moonDir);

    this.overcast.setRGB(0.42, 0.45, 0.5, SRGBColorSpace).multiplyScalar(0.2 + 0.8 * p.daylight);
    SKY_COLORS.top.setRGB(p.skyTop[0], p.skyTop[1], p.skyTop[2], SRGBColorSpace).lerp(this.overcast, o * 0.6);
    SKY_COLORS.horizon.setRGB(p.skyHorizon[0], p.skyHorizon[1], p.skyHorizon[2], SRGBColorSpace).lerp(this.overcast, o * 0.5);
    SKY_COLORS.ground.setRGB(p.ground[0], p.ground[1], p.ground[2], SRGBColorSpace);
    SKY_COLORS.sun.setRGB(p.sun[0], p.sun[1], p.sun[2], SRGBColorSpace);

    const sunIsKey = this.sunDir.y > 0.03;
    this.keyLight.direction.copy(sunIsKey ? this.sunDir : this.moonDir);
    this.keyColor.copy(SKY_COLORS.sun);
    this.keyLight.intensity = p.keyIntensity * (1 - 0.65 * o);
    this.hemiSky.copy(SKY_COLORS.top).lerp(SKY_COLORS.horizon, 0.5);
    this.keyLight.hemiIntensity = Math.max(0.35, p.hemiIntensity * (1 - 0.2 * o));
    this.lighting.setKeyLight(this.keyLight);
    this.underwater.setLight(this.sunDir, this.keyColor, sunIsKey ? p.daylight * (1 - 0.7 * o) : 0);

    this.skyState.daylight = p.daylight;
    this.skyState.cloudCover = cover;
    this.sky.setAtmosphere(this.skyState);

    this.fog.color.setRGB(p.fog[0], p.fog[1], p.fog[2], SRGBColorSpace).lerp(this.overcast, o * 0.5);
    if (this.biomeId !== 'tropical') this.fog.color.lerp(new Color(getLake(this.biomeId).fog), .5);
    const range = fogRange(this.weather.fogDensity, p.daylight);
    this.fog.near = range.near;
    this.fog.far = range.far;
    const water = this.lake.mesh.material.uniforms;
    if (water['uFogNear']) water['uFogNear'].value = range.near;
    if (water['uFogFar']) water['uFogFar'].value = range.far;
    (water['uSunDir']?.value as Vector3 | undefined)?.copy(this.sunDir);

    if (force || hourDistance(hour, this.envHour) >= ENV_HOUR_STEP || Math.abs(cover - this.envCover) >= ENV_COVER_STEP) {
      this.envHour = hour;
      this.envCover = cover;
      this.lighting.updateEnvironment(this.engine.renderer, this.scene, this.sky.mesh, 0.25 + 0.45 * p.daylight * (1 - 0.4 * o));
      this.lake.setEnvironment(this.scene.environment, 1);
    }
  }

  /**
   * Só no build `--mode e2e`: acrescenta setTime, setWeather e getAtmosphere a window.__fp. O objeto
   * __fp é publicado pelo main.ts depois do bootstrap, então tenta de novo até ele existir.
   */
  private exposeTestHooks(attempt: number): void {
    const w = window as unknown as { __fp?: Record<string, unknown> };
    if (!w.__fp) {
      if (attempt >= 200) {
        console.warn('ganchos de teste __fp ausentes: setTime/setWeather não foram expostos');
        return;
      }
      this.hookTimer = setTimeout(() => this.exposeTestHooks(attempt + 1), 50);
      return;
    }
    this.hookTimer = null;
    w.__fp['setTime'] = (hour: number) => this.setTime(hour);
    w.__fp['setWeather'] = (kind: unknown) => {
      if (!isWeatherKind(kind)) throw new RangeError(`clima inválido: ${String(kind)}. Use clear, cloudy ou rain.`);
      this.setWeather(kind, true);
    };
    w.__fp['getAtmosphere'] = () => this.getAtmosphere();
    w.__fp['splash'] = (kind: unknown, x: number = LAKE.centerX, z: number = LAKE.centerZ) => {
      if (!isSplashKind(kind)) throw new RangeError(`splash inválido: ${String(kind)}. Use lure, jump ou catch.`);
      this.triggerSplash(x, z, kind);
    };
    w.__fp['getUnderwater'] = () => ({
      loaded: this.scene.getObjectByName('underwater') === this.underwater.group,
      bedInScene: this.scene.getObjectByName('lake-bed') !== undefined,
      ...this.underwater.getStats(),
      depthCenter: this.underwater.depthAt(LAKE.centerX, LAKE.centerZ),
      depthNearShore: this.underwater.depthAt(LAKE.centerX + LAKE.radius * 0.8, LAKE.centerZ),
      depthOnLand: this.underwater.depthAt(LAKE.centerX + LAKE.radius * 3, LAKE.centerZ),
      glError: this.engine.renderer.getContext().getError(),
    });
    w.__fp['getVegetation'] = () => ({
      ...this.vegetation.getStats(),
      fauna: this.fauna.getStats(),
      glError: this.engine.renderer.getContext().getError(),
    });
    w.__fp['getWater'] = () => ({
      splashActive: this.splash.activeCount,
      envReflection: this.lake.hasEnvironment,
      planarReflection: this.lake.reflectionEnabled,
      glError: this.engine.renderer.getContext().getError(),
    });
  }
}

/** Distância circular entre duas horas; NaN (nunca calculado) conta como infinita. */
function hourDistance(a: number, b: number): number {
  if (Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}
