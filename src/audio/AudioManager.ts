import { defaultSaveData, type Volumes } from '../config/persistence.ts';
import { Rng } from '../utils/rng.ts';
import {
  isLoopId,
  isSfxId,
  renderSound,
  SOUND_IDS,
  SOUND_SPECS,
  soundLength,
  type LoopId,
  type SfxId,
  type SoundId,
} from './synth.ts';

export type AudioContextFactory = () => AudioContext;

export interface AudioManagerOptions {
  /** Cria o contexto só no primeiro gesto; injetável para os testes. */
  readonly createContext?: AudioContextFactory;
  /** Seed da síntese e da variação de pitch dos efeitos. */
  readonly seed?: number;
  /** Volumes vindos das configurações persistidas. */
  readonly volumes?: Volumes;
}

/** locked: ainda sem gesto do usuário; suspended: pausado depois de já ter tocado. */
export type AudioState = 'locked' | 'running' | 'suspended' | 'disposed';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/** Camadas do ambiente (tudo que não é música de menu). */
const AMBIENT_IDS: readonly LoopId[] = ['forest', 'water', 'waves', 'wind', 'birds', 'insects', 'rain'];

/** Posição de cada camada em volta do pescador (x, y, z em metros); chuva e vento ficam por cima. */
const LOOP_POSITIONS: Partial<Record<LoopId, readonly [number, number, number]>> = {
  water: [0, -0.5, 4],
  waves: [6, -0.5, 8],
  forest: [-8, 2, -6],
  wind: [0, 8, 0],
  birds: [7, 6, -5],
  insects: [-5, 0, 3],
  rain: [0, 10, 2],
};

/** Ambiente sonoro: hora vinda do TimeOfDay, chuva e vento vindos de src/world/weather.ts. */
export interface AmbienceEnvironment {
  /** Hora do dia em 0..24 (fração vale). */
  readonly hour: number;
  /** 0..1, de Weather.rainIntensity. */
  readonly rainIntensity: number;
  /** m/s, de Weather.getWind().speed. */
  readonly windSpeed: number;
}

/** Fim de tarde limpo, o padrão do lago antes do primeiro setEnvironment. */
export const DEFAULT_ENVIRONMENT: AmbienceEnvironment = { hour: 17, rainIntensity: 0, windSpeed: 1.5 };

function validateEnvironment(env: AmbienceEnvironment): AmbienceEnvironment {
  for (const key of ['hour', 'rainIntensity', 'windSpeed'] as const) {
    const value: unknown = env[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`ambiente ${key} deve ser um número finito; recebido: ${String(value)}`);
    }
  }
  return {
    hour: env.hour,
    rainIntensity: Math.min(1, Math.max(0, env.rainIntensity)),
    windSpeed: Math.max(0, env.windSpeed),
  };
}

/**
 * Camadas ativas do ambiente e o nível (0..1) de cada uma: água sempre; ondas, vento e folhas
 * crescem com o vento; pássaros só de dia e insetos só à noite (ambos somem na chuva forte);
 * chuva só quando está chovendo.
 */
export function ambienceLoopsFor(environment: AmbienceEnvironment): ReadonlyMap<LoopId, number> {
  const env = validateEnvironment(environment);
  const hour = ((env.hour % 24) + 24) % 24;
  const wind = Math.min(1, env.windSpeed / 8);
  const rain = env.rainIntensity;
  const isDay = hour >= 6 && hour < 18.5;
  const layers = new Map<LoopId, number>();
  layers.set('water', 1);
  layers.set('waves', 0.3 + 0.7 * wind);
  layers.set('wind', 0.2 + 0.8 * wind);
  layers.set('forest', 0.35 + 0.65 * wind);
  if (isDay && rain < 0.6) layers.set('birds', 1 - rain);
  if (!isDay && rain < 0.6) layers.set('insects', 1 - rain);
  if (rain > 0.02) layers.set('rain', 0.3 + 0.7 * rain);
  return layers;
}
const MAX_SFX_VOICES = 12;
const LOOP_FADE_IN_SECONDS = 1.5;
const LOOP_FADE_OUT_SECONDS = 0.6;
const VOLUME_SMOOTHING_SECONDS = 0.03;
const DEFAULT_SEED = 0x5eed;

interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly panner: PannerNode | null;
}

interface Buses {
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
}

function defaultContextFactory(): AudioContext {
  if (typeof AudioContext === 'undefined') {
    throw new Error('Este navegador não tem Web Audio API; o jogo segue sem som.');
  }
  return new AudioContext({ latencyHint: 'interactive' });
}

function validateVolumes(volumes: Volumes): Volumes {
  for (const key of ['master', 'music', 'sfx'] as const) {
    const value: unknown = volumes[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`volume ${key} deve ser um número entre 0 e 1; recebido: ${String(value)}`);
    }
  }
  return { master: volumes.master, music: volumes.music, sfx: volumes.sfx };
}

/**
 * Áudio do jogo com Web Audio API. Nada é criado nem toca antes do primeiro gesto do usuário;
 * música e efeitos (incluindo o ambiente) têm ganhos separados sob um ganho mestre.
 * Cada som é sintetizado na primeira vez que é pedido e fica em cache.
 */
export class AudioManager {
  private readonly createContext: AudioContextFactory;
  private readonly seed: number;
  private readonly rng: Rng;
  private volumes: Volumes;
  private ctx: AudioContext | null = null;
  private buses: Buses | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly wantedLoops = new Set<LoopId>();
  private readonly loops = new Map<LoopId, Voice>();
  private readonly loopLevels = new Map<LoopId, number>();
  private readonly sfxVoices = new Set<Voice>();
  private readonly fadingVoices = new Set<Voice>();
  private ambienceOn = false;
  private environment: AmbienceEnvironment = DEFAULT_ENVIRONMENT;
  private gestureTarget: EventTarget | null = null;
  private hasRun = false;
  private disposed = false;

  constructor(options: AudioManagerOptions = {}) {
    this.createContext = options.createContext ?? defaultContextFactory;
    this.seed = options.seed ?? DEFAULT_SEED;
    this.rng = new Rng(this.seed);
    this.volumes = validateVolumes(options.volumes ?? defaultSaveData().volumes);
  }

  get state(): AudioState {
    if (this.disposed) return 'disposed';
    if (this.isRunning()) return 'running';
    return this.hasRun ? 'suspended' : 'locked';
  }

  get currentVolumes(): Volumes {
    return this.volumes;
  }

  /** Escuta o primeiro gesto (clique, toque ou tecla) em `target` para liberar o áudio. */
  attachUnlock(target: EventTarget): void {
    if (this.disposed) return;
    this.removeGestureListeners();
    this.gestureTarget = target;
    if (!this.isRunning()) this.addGestureListeners();
  }

  /**
   * Cria o contexto e o retoma. Precisa ser chamado dentro de um gesto do usuário;
   * fora dele o navegador mantém o contexto suspenso e o retorno é false.
   */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    const ctx = this.ctx ?? this.createGraph();
    if (ctx.state !== 'running') await ctx.resume();
    if (!this.isRunning()) return false;
    this.hasRun = true;
    this.removeGestureListeners();
    this.syncLoops();
    return true;
  }

  /** Aplica os volumes das configurações (cada um em [0, 1]); vale também antes do desbloqueio. */
  setVolumes(volumes: Volumes): void {
    this.volumes = validateVolumes(volumes);
    this.applyVolumes(false);
  }

  /** Toca um efeito; devolve false se o áudio ainda não foi liberado ou se há vozes demais. */
  playSfx(id: SfxId): boolean {
    if (!isSfxId(id)) throw new RangeError(`efeito sonoro desconhecido: ${String(id)}`);
    if (!this.isRunning() || this.buses === null) return false;
    if (this.sfxVoices.size >= MAX_SFX_VOICES) return false;
    const spec = SOUND_SPECS[id];
    const variant = spec.variants > 1 ? this.rng.int(0, spec.variants - 1) : 0;
    const voice = this.createVoice(id, this.buses.sfx, spec.gain, variant, null);
    voice.source.playbackRate.value = this.rng.range(0.96, 1.04);
    voice.source.onended = () => {
      this.sfxVoices.delete(voice);
      this.releaseVoice(voice);
    };
    this.sfxVoices.add(voice);
    voice.source.start();
    return true;
  }

  /** Pede um loop; se o áudio ainda está bloqueado, ele começa logo após o desbloqueio. */
  startLoop(id: LoopId): void {
    if (!isLoopId(id)) throw new RangeError(`loop desconhecido: ${String(id)}`);
    if (this.disposed) return;
    this.wantedLoops.add(id);
    this.syncLoops();
  }

  stopLoop(id: LoopId): void {
    if (!isLoopId(id)) throw new RangeError(`loop desconhecido: ${String(id)}`);
    this.wantedLoops.delete(id);
    this.syncLoops();
  }

  /** Ambiente do lago em camadas; quais tocam e em que nível depende do ambiente atual. */
  setAmbience(on: boolean): void {
    if (this.disposed) return;
    this.ambienceOn = on;
    this.applyAmbience();
  }

  /** Atualiza hora, chuva e vento; camadas e níveis seguem na hora, com rampa suave. */
  setEnvironment(environment: AmbienceEnvironment): void {
    this.environment = validateEnvironment(environment);
    if (this.ambienceOn) this.applyAmbience();
  }

  get currentEnvironment(): AmbienceEnvironment {
    return this.environment;
  }

  setMenuMusic(on: boolean): void {
    if (on) this.startLoop('menuMusic');
    else this.stopLoop('menuMusic');
  }

  isLoopPlaying(id: LoopId): boolean {
    return this.loops.has(id);
  }

  /** Suspende o contexto em PAUSED (ou aba oculta) e retoma depois, se já tinha sido liberado. */
  async setPaused(paused: boolean): Promise<void> {
    const ctx = this.ctx;
    if (ctx === null || this.disposed || !this.hasRun) return;
    if (paused) {
      if (ctx.state === 'running') await ctx.suspend();
      return;
    }
    if (ctx.state === 'suspended') await ctx.resume();
    this.syncLoops();
  }

  /** Para tudo, solta os listeners e fecha o AudioContext. Depois disso nada mais toca. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeGestureListeners();
    this.gestureTarget = null;
    this.ambienceOn = false;
    this.wantedLoops.clear();
    this.loopLevels.clear();
    const voices = [...this.loops.values(), ...this.sfxVoices, ...this.fadingVoices];
    this.loops.clear();
    this.sfxVoices.clear();
    this.fadingVoices.clear();
    for (const voice of voices) {
      voice.source.onended = null;
      voice.source.stop();
      this.releaseVoice(voice);
    }
    if (this.buses !== null) {
      this.buses.music.disconnect();
      this.buses.sfx.disconnect();
      this.buses.master.disconnect();
      this.buses = null;
    }
    this.buffers.clear();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx !== null && ctx.state !== 'closed') await ctx.close();
  }

  private readonly onGesture = (): void => {
    this.removeGestureListeners();
    this.unlock().then(
      (ok) => {
        if (!ok) this.addGestureListeners();
      },
      (error: unknown) => {
        console.warn('[audio] Não foi possível ativar o som; clique ou tecle de novo para tentar.', error);
        this.addGestureListeners();
      },
    );
  };

  private addGestureListeners(): void {
    if (this.disposed || this.gestureTarget === null) return;
    for (const type of UNLOCK_EVENTS) this.gestureTarget.addEventListener(type, this.onGesture);
  }

  private removeGestureListeners(): void {
    if (this.gestureTarget === null) return;
    for (const type of UNLOCK_EVENTS) this.gestureTarget.removeEventListener(type, this.onGesture);
  }

  private isRunning(): boolean {
    return !this.disposed && this.ctx !== null && this.ctx.state === 'running';
  }

  private createGraph(): AudioContext {
    const ctx = this.createContext();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const music = ctx.createGain();
    music.connect(master);
    const sfx = ctx.createGain();
    sfx.connect(master);
    this.ctx = ctx;
    this.buses = { master, music, sfx };
    this.applyVolumes(true);
    return ctx;
  }

  private applyVolumes(immediate: boolean): void {
    if (this.ctx === null || this.buses === null) return;
    const now = this.ctx.currentTime;
    const set = (param: AudioParam, value: number): void => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, VOLUME_SMOOTHING_SECONDS);
    };
    set(this.buses.master.gain, this.volumes.master);
    set(this.buses.music.gain, this.volumes.music);
    set(this.buses.sfx.gain, this.volumes.sfx);
  }

  private syncLoops(): void {
    if (!this.isRunning() || this.buses === null) return;
    for (const [id, voice] of this.loops) {
      if (this.wantedLoops.has(id)) continue;
      this.loops.delete(id);
      this.fadeOut(voice);
    }
    for (const id of this.wantedLoops) {
      if (this.loops.has(id)) continue;
      const bus = id === 'menuMusic' || id === 'legendaryMusic' ? this.buses.music : this.buses.sfx;
      this.loops.set(id, this.startLoopVoice(id, bus));
    }
  }

  private applyAmbience(): void {
    const plan = this.ambienceOn ? ambienceLoopsFor(this.environment) : new Map<LoopId, number>();
    for (const id of AMBIENT_IDS) {
      const level = plan.get(id);
      if (level === undefined) {
        this.wantedLoops.delete(id);
        this.loopLevels.delete(id);
      } else {
        this.wantedLoops.add(id);
        this.loopLevels.set(id, level);
      }
    }
    this.applyLoopLevels();
    this.syncLoops();
  }

  /** Rampa o ganho das camadas que já tocam para o nível novo. */
  private applyLoopLevels(): void {
    if (!this.isRunning()) return;
    const now = this.requireContext().currentTime;
    for (const [id, voice] of this.loops) {
      voice.gain.gain.setTargetAtTime(SOUND_SPECS[id].gain * (this.loopLevels.get(id) ?? 1), now, 0.5);
    }
  }

  private startLoopVoice(id: LoopId, bus: GainNode): Voice {
    const ctx = this.requireContext();
    const voice = this.createVoice(id, bus, 0, 0, LOOP_POSITIONS[id] ?? null);
    voice.source.loop = true;
    const now = ctx.currentTime;
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(
      SOUND_SPECS[id].gain * (this.loopLevels.get(id) ?? 1),
      now + LOOP_FADE_IN_SECONDS,
    );
    voice.source.start(now);
    return voice;
  }

  private fadeOut(voice: Voice): void {
    const now = this.requireContext().currentTime;
    const end = now + LOOP_FADE_OUT_SECONDS;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, end);
    voice.source.onended = () => {
      this.fadingVoices.delete(voice);
      this.releaseVoice(voice);
    };
    this.fadingVoices.add(voice);
    voice.source.stop(end);
  }

  private createVoice(
    id: SoundId,
    bus: GainNode,
    level: number,
    variant: number,
    position: readonly [number, number, number] | null,
  ): Voice {
    const ctx = this.requireContext();
    const source = ctx.createBufferSource();
    source.buffer = this.getBuffer(ctx, id, variant);
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(gain);
    let panner: PannerNode | null = null;
    if (position !== null) {
      panner = this.createPanner(position);
      gain.connect(panner);
      panner.connect(bus);
    } else {
      gain.connect(bus);
    }
    return { source, gain, panner };
  }

  /** Panner barato (equalpower, atenuação linear) na posição fixa da camada. */
  private createPanner([x, y, z]: readonly [number, number, number]): PannerNode {
    const panner = this.requireContext().createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = 60;
    panner.rolloffFactor = 0.8;
    const px: AudioParam | undefined = panner.positionX;
    const py: AudioParam | undefined = panner.positionY;
    const pz: AudioParam | undefined = panner.positionZ;
    if (px !== undefined && py !== undefined && pz !== undefined) {
      px.value = x;
      py.value = y;
      pz.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    return panner;
  }

  private releaseVoice(voice: Voice): void {
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.panner?.disconnect();
  }

  private getBuffer(ctx: AudioContext, id: SoundId, variant: number): AudioBuffer {
    const key = `${id}#${variant}`;
    const cached = this.buffers.get(key);
    if (cached !== undefined) return cached;
    const buffer = ctx.createBuffer(1, soundLength(id, ctx.sampleRate), ctx.sampleRate);
    const seed = (this.seed + SOUND_IDS.indexOf(id) * 7919 + variant * 104729) >>> 0;
    renderSound(id, buffer.getChannelData(0), ctx.sampleRate, seed);
    this.buffers.set(key, buffer);
    return buffer;
  }

  private requireContext(): AudioContext {
    if (this.ctx === null) throw new Error('AudioContext ainda não foi criado; chame unlock() num gesto do usuário.');
    return this.ctx;
  }
}
