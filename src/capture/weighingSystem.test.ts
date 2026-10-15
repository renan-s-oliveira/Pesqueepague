import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import {
  DEFAULT_WEIGHING,
  formatWeighingKg,
  stableAfterSec,
  validateWeighingParams,
  WeighingReading,
  weighingReadingKg,
  WeighingScale,
} from './weighingSystem.ts';

describe('formatWeighingKg', () => {
  it('formata com 3 casas e vírgula, como o visor da balança', () => {
    expect(formatWeighingKg(0)).toBe('0,000 kg');
    expect(formatWeighingKg(0.9)).toBe('0,900 kg');
    expect(formatWeighingKg(1.234)).toBe('1,234 kg');
  });
});

describe('weighingReadingKg (oscilação amortecida)', () => {
  it('parte de zero: t <= 0 lê 0', () => {
    expect(weighingReadingKg(0.9, 0)).toBe(0);
    expect(weighingReadingKg(0.9, -1)).toBe(0);
  });

  it('passa do alvo no meio do primeiro período (overshoot)', () => {
    const halfPeriod = 1 / (2 * DEFAULT_WEIGHING.frequencyHz);
    expect(weighingReadingKg(0.9, halfPeriod)).toBeGreaterThan(0.9);
  });

  it('converge: no tempo de estabilidade o desvio fica dentro de stableFraction', () => {
    const t = stableAfterSec();
    const reading = weighingReadingKg(0.9, t);
    expect(Math.abs(reading - 0.9)).toBeLessThanOrEqual(0.9 * DEFAULT_WEIGHING.stableFraction + 1e-9);
  });

  it('recusa alvo inválido e parâmetros fora da faixa', () => {
    expect(() => weighingReadingKg(0, 1)).toThrow(RangeError);
    expect(() => weighingReadingKg(Number.NaN, 1)).toThrow(RangeError);
    expect(() => validateWeighingParams({ ...DEFAULT_WEIGHING, frequencyHz: 0 })).toThrow(RangeError);
    expect(() => validateWeighingParams({ ...DEFAULT_WEIGHING, stableFraction: 1 })).toThrow(RangeError);
  });
});

describe('WeighingReading', () => {
  it('segura a leitura em zero durante o posicionamento animado', () => {
    const r = new WeighingReading(0.9);
    expect(r.readingKg).toBe(0);
    r.step(DEFAULT_WEIGHING.placementSec / 2);
    expect(r.placementProgress).toBeCloseTo(0.5, 6);
    expect(r.readingKg).toBe(0);
  });

  it('estável, trava exatamente no peso do indivíduo', () => {
    const r = new WeighingReading(1.234);
    r.step(DEFAULT_WEIGHING.placementSec + stableAfterSec() + 0.01);
    expect(r.stable).toBe(true);
    expect(r.readingKg).toBe(1.234);
  });

  it('é determinística: mesmos passos, mesmas leituras', () => {
    const a = new WeighingReading(0.9);
    const b = new WeighingReading(0.9);
    for (let i = 0; i < 20; i++) expect(a.step(0.1)).toBe(b.step(0.1));
  });

  it('instant (prefers-reduced-motion) abre já estável no alvo', () => {
    const r = new WeighingReading(2, { instant: true });
    expect(r.stable).toBe(true);
    expect(r.readingKg).toBe(2);
    expect(r.placementProgress).toBe(1);
  });

  it('passo negativo ou não finito não anda o tempo', () => {
    const r = new WeighingReading(0.9);
    r.step(-5);
    r.step(Number.NaN);
    expect(r.placementProgress).toBe(0);
  });

  it('recusa peso-alvo não positivo', () => {
    expect(() => new WeighingReading(0)).toThrow(RangeError);
  });
});

describe('WeighingScale (3D procedural, sem DOM)', () => {
  it('posiciona o peixe animado até o prato e estabiliza a leitura no alvo', () => {
    const scale = new WeighingScale(0.9);
    const fish = new Object3D();
    scale.attachFish(fish, 0.35);
    expect(fish.position.y).toBeGreaterThan(scale.fishRestHeight);

    scale.update(DEFAULT_WEIGHING.placementSec / 2);
    expect(fish.position.y).toBeGreaterThan(scale.fishRestHeight);
    expect(fish.position.y).toBeLessThan(0.5);

    scale.update(10); // placement completo + oscilação já amortecida
    expect(fish.position.y).toBeCloseTo(scale.fishRestHeight, 6);
    expect(scale.reading.stable).toBe(true);
    expect(scale.update(0.016)).toBe(0.9);
    expect(() => scale.dispose()).not.toThrow();
  });
});
