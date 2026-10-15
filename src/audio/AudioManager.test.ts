import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from './AudioManager.ts';

class FakeParam {
  constructor(public value: number) {}
  setValueAtTime(value: number, _time: number): this {
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, _time: number, _constant: number): this {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, _time: number): this {
    this.value = value;
    return this;
  }
  cancelScheduledValues(_time: number): this {
    return this;
  }
}

class FakeNode {
  outputs: FakeNode[] = [];
  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }
  disconnect(): void {
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakePanner extends FakeNode {
  panningModel = 'HRTF';
  distanceModel = 'inverse';
  refDistance = 0;
  maxDistance = 0;
  rolloffFactor = 0;
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);
}

class FakeBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(_when?: number): void {
    this.started = true;
  }
  stop(_when?: number): void {
    this.stopped = true;
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  /** Simula navegador que recusa retomar fora de um gesto. */
  allowResume = true;
  createGain(): FakeGain {
    return new FakeGain();
  }
  createPanner(): FakePanner {
    return new FakePanner();
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  resume(): Promise<void> {
    if (this.allowResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function setup(volumes = { master: 1, music: 0.5, sfx: 0.8 }) {
  const ctx = new FakeContext();
  const factory = vi.fn(() => ctx as unknown as AudioContext);
  const manager = new AudioManager({ createContext: factory, seed: 42, volumes });
  return { ctx, factory, manager };
}

/** Segue source → ganho da voz → barramento (música ou efeitos). */
function busOf(source: FakeSource): FakeGain {
  const voiceGain = source.outputs[0];
  const bus = voiceGain?.outputs[0];
  if (!(bus instanceof FakeGain)) throw new Error('source não está ligada a um barramento');
  return bus;
}

describe('AudioManager', () => {
  it('fica bloqueado e mudo antes do gesto do usuário', () => {
    const { factory, manager } = setup();
    manager.setAmbience(true);
    manager.setMenuMusic(true);

    expect(manager.playSfx('bite')).toBe(false);
    expect(manager.state).toBe('locked');
    expect(manager.isLoopPlaying('forest')).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('libera no primeiro gesto e então toca efeitos e os loops pedidos', async () => {
    const { ctx, factory, manager } = setup();
    const target = new EventTarget();
    manager.attachUnlock(target);
    manager.setAmbience(true);

    target.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(manager.state).toBe('running'));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.isLoopPlaying('forest')).toBe(true);
    expect(manager.isLoopPlaying('water')).toBe(true);
    expect(manager.isLoopPlaying('birds')).toBe(true);
    expect(ctx.sources.every((s) => s.started && s.loop)).toBe(true);

    expect(manager.playSfx('bite')).toBe(true);
    const sfx = ctx.sources.at(-1);
    expect(sfx?.started).toBe(true);
    expect(sfx?.loop).toBe(false);
    expect(sfx?.buffer?.length).toBeGreaterThan(0);

    target.dispatchEvent(new Event('keydown'));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('continua mudo se o navegador não retomar o contexto', async () => {
    const { ctx, manager } = setup();
    ctx.allowResume = false;

    expect(await manager.unlock()).toBe(false);
    expect(manager.playSfx('cast')).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it('mantém ganhos de música e efeitos independentes e respeita o volume', async () => {
    const { ctx, manager } = setup({ master: 0.9, music: 0.2, sfx: 0.7 });
    manager.setMenuMusic(true);
    await manager.unlock();
    manager.playSfx('splash');

    const [musicSource, sfxSource] = ctx.sources;
    if (musicSource === undefined || sfxSource === undefined) throw new Error('sources esperadas');
    const musicBus = busOf(musicSource);
    const sfxBus = busOf(sfxSource);
    expect(musicBus).not.toBe(sfxBus);
    expect(musicBus.gain.value).toBe(0.2);
    expect(sfxBus.gain.value).toBe(0.7);
    const master = musicBus.outputs[0];
    expect(master).toBe(sfxBus.outputs[0]);
    expect(master instanceof FakeGain && master.gain.value).toBe(0.9);

    manager.setVolumes({ master: 0.9, music: 0, sfx: 0.7 });
    expect(musicBus.gain.value).toBe(0);
    expect(sfxBus.gain.value).toBe(0.7);

    manager.setVolumes({ master: 0.9, music: 0, sfx: 0.3 });
    expect(musicBus.gain.value).toBe(0);
    expect(sfxBus.gain.value).toBe(0.3);
  });

  it('aplica no desbloqueio o volume definido antes dele', async () => {
    const { ctx, manager } = setup();
    manager.setVolumes({ master: 1, music: 0.1, sfx: 0.4 });
    await manager.unlock();
    manager.playSfx('line');
    const source = ctx.sources[0];
    if (source === undefined) throw new Error('source esperada');
    expect(busOf(source).gain.value).toBe(0.4);
  });

  it('rejeita volumes e ids inválidos', () => {
    const { manager } = setup();
    expect(() => manager.setVolumes({ master: 1.5, music: 0, sfx: 0 })).toThrow(RangeError);
    expect(() => manager.setVolumes({ master: 1, music: Number.NaN, sfx: 0 })).toThrow(RangeError);
    expect(() => manager.playSfx('explosion' as never)).toThrow(RangeError);
    expect(() => new AudioManager({ volumes: { master: -1, music: 0, sfx: 0 } })).toThrow(RangeError);
    expect(manager.currentVolumes).toEqual({ master: 1, music: 0.5, sfx: 0.8 });
  });

  it('para o loop com fade e libera a voz ao terminar', async () => {
    const { ctx, manager } = setup();
    manager.setMenuMusic(true);
    await manager.unlock();
    const source = ctx.sources[0];
    manager.setMenuMusic(false);
    expect(manager.isLoopPlaying('menuMusic')).toBe(false);
    expect(source?.stopped).toBe(true);
    source?.onended?.();
    expect(source?.outputs).toHaveLength(0);
  });

  it('dispose fecha o contexto, para as vozes e não toca mais nada', async () => {
    const { ctx, factory, manager } = setup();
    const target = new EventTarget();
    manager.attachUnlock(target);
    manager.setAmbience(true);
    await manager.unlock();
    manager.playSfx('catch');

    await manager.dispose();

    expect(ctx.state).toBe('closed');
    expect(manager.state).toBe('disposed');
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    expect(manager.playSfx('fail')).toBe(false);
    expect(await manager.unlock()).toBe(false);
    target.dispatchEvent(new Event('pointerdown'));
    expect(factory).toHaveBeenCalledTimes(1);
    await manager.dispose();
  });

  it('dispose antes do gesto não cria contexto', async () => {
    const { factory, manager } = setup();
    await manager.dispose();
    expect(factory).not.toHaveBeenCalled();
    expect(manager.state).toBe('disposed');
  });
});
