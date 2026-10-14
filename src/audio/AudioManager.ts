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
const AMBIENCE_IDS: readonly LoopId[] = ['forest', 'water', 'birds'];
const MAX_SFX_VOICES = 12;
const LOOP_FADE_IN_SECONDS = 1.5;
const LOOP_FADE_OUT_SECONDS = 0.6;
const VOLUME_SMOOTHING_SECONDS = 0.03;
const DEFAULT_SEED = 0x5eed;

interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
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
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private readonly wantedLoops = new Set<LoopId>();
  private readonly loops = new Map<LoopId, Voice>();
  private readonly sfxVoices = new Set<Voice>();
  private readonly fadingVoices = new Set<Voice>();
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
    const voice = this.createVoice(id, this.buses.sfx, SOUND_SPECS[id].gain);
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

  /** Ambiente do lago: floresta e vento, água e pássaros. */
  setAmbience(on: boolean): void {
    for (const id of AMBIENCE_IDS) {
      if (on) this.startLoop(id);
      else this.stopLoop(id);
    }
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
    this.wantedLoops.clear();
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
      const bus = id === 'menuMusic' ? this.buses.music : this.buses.sfx;
      this.loops.set(id, this.startLoopVoice(id, bus));
    }
  }

  private startLoopVoice(id: LoopId, bus: GainNode): Voice {
    const ctx = this.requireContext();
    const voice = this.createVoice(id, bus, 0);
    voice.source.loop = true;
    const now = ctx.currentTime;
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(SOUND_SPECS[id].gain, now + LOOP_FADE_IN_SECONDS);
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

  private createVoice(id: SoundId, bus: GainNode, level: number): Voice {
    const ctx = this.requireContext();
    const source = ctx.createBufferSource();
    source.buffer = this.getBuffer(ctx, id);
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(bus);
    return { source, gain };
  }

  private releaseVoice(voice: Voice): void {
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private getBuffer(ctx: AudioContext, id: SoundId): AudioBuffer {
    const cached = this.buffers.get(id);
    if (cached !== undefined) return cached;
    const buffer = ctx.createBuffer(1, soundLength(id, ctx.sampleRate), ctx.sampleRate);
    renderSound(id, buffer.getChannelData(0), ctx.sampleRate, (this.seed + SOUND_IDS.indexOf(id)) >>> 0);
    this.buffers.set(id, buffer);
    return buffer;
  }

  private requireContext(): AudioContext {
    if (this.ctx === null) throw new Error('AudioContext ainda não foi criado; chame unlock() num gesto do usuário.');
    return this.ctx;
  }
}
