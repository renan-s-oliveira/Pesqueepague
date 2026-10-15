import { describe, expect, it } from 'vitest';
import {
  GraphicsQualityManager,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  QUALITY_PRESET_LABELS,
  QUALITY_SETTINGS,
  isQualityPreset,
} from './GraphicsQualityManager.ts';

function feed(manager: GraphicsQualityManager, frameMs: number, frames: number): number {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (manager.sample(frameMs)) changes++;
  return changes;
}

const base = { windowSize: 10, downgradeAboveMs: 24, upgradeBelowMs: 18, upgradeDelayFrames: 0 } as const;

describe('GraphicsQualityManager', () => {
  it('baixa a qualidade com frame time alto sustentado', () => {
    const manager = new GraphicsQualityManager({ ...base, initialLevel: 'high' });
    feed(manager, 40, 9);
    expect(manager.level).toBe('high');
    expect(manager.sample(40)).toBe(true);
    expect(manager.level).toBe('medium');
    feed(manager, 40, 10);
    expect(manager.level).toBe('low');
  });

  it('não reage a um pico isolado porque usa média móvel', () => {
    const manager = new GraphicsQualityManager({ ...base, initialLevel: 'high' });
    feed(manager, 16, 9);
    manager.sample(60);
    expect(manager.level).toBe('high');
    expect(manager.averageFrameMs).toBeCloseTo(20.4);
  });

  it('não alterna dentro da faixa de histerese', () => {
    const manager = new GraphicsQualityManager({ ...base, initialLevel: 'medium' });
    let changes = 0;
    for (let i = 0; i < 1000; i++) if (manager.sample(i % 2 === 0 ? 19 : 23)) changes++;
    expect(changes).toBe(0);
    expect(manager.level).toBe('medium');
  });

  it('sobe a qualidade quando sobra folga', () => {
    const manager = new GraphicsQualityManager({ ...base, initialLevel: 'low' });
    feed(manager, 10, 20);
    expect(manager.level).toBe('high');
  });

  it('espera o atraso configurado antes de subir de nível', () => {
    const manager = new GraphicsQualityManager({ ...base, upgradeDelayFrames: 50, initialLevel: 'low' });
    feed(manager, 10, 49);
    expect(manager.level).toBe('low');
    feed(manager, 10, 1);
    expect(manager.level).toBe('medium');
  });

  it('respeita o limite mínimo', () => {
    const manager = new GraphicsQualityManager({ ...base, minLevel: 'medium', initialLevel: 'high' });
    feed(manager, 80, 500);
    expect(manager.level).toBe('medium');
  });

  it('respeita o limite máximo', () => {
    const manager = new GraphicsQualityManager({ ...base, maxLevel: 'medium', initialLevel: 'low' });
    feed(manager, 5, 500);
    expect(manager.level).toBe('medium');
  });

  it('presets fixos não se adaptam e também respeitam os limites', () => {
    const manager = new GraphicsQualityManager({ ...base, maxLevel: 'medium', preset: 'low' });
    expect(feed(manager, 80, 100)).toBe(0);
    expect(manager.level).toBe('low');
    manager.setPreset('high');
    expect(manager.level).toBe('medium');
    manager.setPreset('auto');
    expect(manager.preset).toBe('auto');
  });

  it('ignora frame times inválidos', () => {
    const manager = new GraphicsQualityManager({ ...base });
    for (const bad of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) expect(manager.sample(bad)).toBe(false);
    expect(manager.averageFrameMs).toBeNull();
  });

  it('expõe as configurações do nível atual', () => {
    const manager = new GraphicsQualityManager({ ...base, preset: 'low' });
    expect(manager.settings).toBe(QUALITY_SETTINGS.low);
    expect(QUALITY_SETTINGS.low.shadows).toBe(false);
    expect(QUALITY_SETTINGS.high.pixelRatioScale).toBeGreaterThan(QUALITY_SETTINGS.low.pixelRatioScale);
  });

  it('oferece os cinco presets com rótulo e o Ultra acima do Alto', () => {
    expect(QUALITY_PRESETS).toEqual(['low', 'medium', 'high', 'ultra', 'auto']);
    for (const p of QUALITY_PRESETS) {
      expect(isQualityPreset(p)).toBe(true);
      expect(QUALITY_PRESET_LABELS[p].length).toBeGreaterThan(0);
    }
    expect(isQualityPreset('insano')).toBe(false);
    const { high, ultra } = QUALITY_SETTINGS;
    expect(ultra.shadowMapSize).toBeGreaterThan(high.shadowMapSize);
    expect(ultra.postProcessing.ambientOcclusion).toBeGreaterThan(high.postProcessing.ambientOcclusion);
    expect(ultra.postProcessing.antialias).toBe('smaa');
    expect(QUALITY_SETTINGS.low.postProcessing).toEqual({ antialias: 'fxaa', ambientOcclusion: 0, bloomStrength: 0 });
    for (const level of QUALITY_LEVELS) expect(QUALITY_SETTINGS[level].postProcessing.bloomStrength).toBeLessThanOrEqual(0.2);
  });

  it('preset ultra fixo não se adapta', () => {
    const manager = new GraphicsQualityManager({ ...base, preset: 'ultra' });
    expect(manager.level).toBe('ultra');
    expect(feed(manager, 80, 100)).toBe(0);
    expect(manager.level).toBe('ultra');
  });

  it('o auto nunca sobe até o Ultra', () => {
    const manager = new GraphicsQualityManager({ ...base, initialLevel: 'low' });
    feed(manager, 5, 500);
    expect(manager.level).toBe('high');
    manager.setPreset('ultra');
    expect(manager.level).toBe('ultra');
    manager.setPreset('auto');
    expect(manager.level).toBe('high');
  });

  it('auto reduz a resolução antes de baixar o nível e devolve antes de subir', () => {
    const manager = new GraphicsQualityManager({ ...base, minResolutionScale: 0.7, initialLevel: 'high' });
    expect(manager.resolutionScale).toBe(1);
    feed(manager, 40, 10);
    expect(manager.level).toBe('high');
    expect(manager.resolutionScale).toBe(0.9);
    feed(manager, 40, 20);
    expect(manager.resolutionScale).toBe(0.7);
    expect(manager.pixelRatioScale).toBeCloseTo(QUALITY_SETTINGS.high.pixelRatioScale * 0.7);
    feed(manager, 40, 10);
    expect(manager.level).toBe('medium');
    expect(manager.resolutionScale).toBe(1);

    feed(manager, 40, 10);
    expect(manager.resolutionScale).toBe(0.9);
    feed(manager, 10, 10);
    expect(manager.level).toBe('medium');
    expect(manager.resolutionScale).toBe(1);
    feed(manager, 10, 10);
    expect(manager.level).toBe('high');
  });

  it('presets fixos zeram a escala dinâmica', () => {
    const manager = new GraphicsQualityManager({ ...base, minResolutionScale: 0.5 });
    feed(manager, 40, 10);
    expect(manager.resolutionScale).toBe(0.9);
    expect(manager.setPreset('high')).toBe(true);
    expect(manager.resolutionScale).toBe(1);
    expect(feed(manager, 40, 50)).toBe(0);
  });

  it('rejeita opções inválidas', () => {
    expect(() => new GraphicsQualityManager({ minResolutionScale: 0.2 })).toThrow(RangeError);
    expect(() => new GraphicsQualityManager({ windowSize: 0 })).toThrow(RangeError);
    expect(() => new GraphicsQualityManager({ downgradeAboveMs: 10, upgradeBelowMs: 20 })).toThrow(RangeError);
    expect(() => new GraphicsQualityManager({ minLevel: 'high', maxLevel: 'low' })).toThrow(RangeError);
    expect(() => new GraphicsQualityManager({ upgradeDelayFrames: -1 })).toThrow(RangeError);
  });
});
