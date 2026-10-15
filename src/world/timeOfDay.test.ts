import { describe, expect, it } from 'vitest';
import { TimeOfDay, moonDirectionAt, normalizeHour, paletteAt, sunDirectionAt } from './timeOfDay';

describe('normalizeHour', () => {
  it('mantém a hora em [0, 24)', () => {
    expect(normalizeHour(0)).toBe(0);
    expect(normalizeHour(24)).toBe(0);
    expect(normalizeHour(25.5)).toBe(1.5);
    expect(normalizeHour(-2)).toBe(22);
  });

  it('rejeita valor não finito', () => {
    expect(() => normalizeHour(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeHour(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('sunDirectionAt / moonDirectionAt', () => {
  it('sol no horizonte às 6h e 18h, no alto ao meio-dia e abaixo à meia-noite', () => {
    expect(sunDirectionAt(6).y).toBeCloseTo(0, 6);
    expect(sunDirectionAt(18).y).toBeCloseTo(0, 6);
    expect(sunDirectionAt(12).y).toBeGreaterThan(0.7);
    expect(sunDirectionAt(0).y).toBeLessThan(-0.7);
  });

  it('nasce a leste (x < 0) e se põe a oeste (x > 0)', () => {
    expect(sunDirectionAt(7).x).toBeLessThan(0);
    expect(sunDirectionAt(17).x).toBeGreaterThan(0);
  });

  it('devolve vetor unitário, reaproveitando o objeto de saída', () => {
    const out = { x: 0, y: 0, z: 0 };
    for (const h of [0, 6, 9.5, 12, 18, 22]) {
      expect(sunDirectionAt(h, out)).toBe(out);
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 9);
      const moon = moonDirectionAt(h);
      expect(Math.hypot(moon.x, moon.y, moon.z)).toBeCloseTo(1, 9);
    }
  });

  it('lua fica acima do horizonte à noite', () => {
    expect(moonDirectionAt(0).y).toBeGreaterThan(0.5);
    expect(moonDirectionAt(12).y).toBeLessThan(0);
  });
});

describe('paletteAt', () => {
  it('é determinística e contínua na virada do dia', () => {
    expect(paletteAt(14.25)).toEqual(paletteAt(14.25));
    expect(paletteAt(0)).toEqual(paletteAt(24));
    const late = paletteAt(23.999);
    const early = paletteAt(0);
    expect(late.keyIntensity).toBeCloseTo(early.keyIntensity, 3);
    expect(late.skyTop[2]).toBeCloseTo(early.skyTop[2], 3);
  });

  it('dia claro ao meio-dia e noite escura à meia-noite', () => {
    const noon = paletteAt(12);
    const midnight = paletteAt(0);
    expect(noon.daylight).toBe(1);
    expect(midnight.daylight).toBe(0);
    expect(noon.keyIntensity).toBeGreaterThan(midnight.keyIntensity);
  });

  it('cores em 0..1 e luz hemisférica nunca abaixo de 0,35 (sem sombra preta)', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const p = paletteAt(h);
      expect(p.hemiIntensity).toBeGreaterThanOrEqual(0.35);
      expect(p.keyIntensity).toBeGreaterThan(0);
      expect(p.keyIntensity).toBeLessThanOrEqual(3);
      for (const c of [...p.skyTop, ...p.skyHorizon, ...p.ground, ...p.sun, ...p.fog]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('TimeOfDay', () => {
  it('começa às 16h e avança 1 hora por minuto no padrão', () => {
    const clock = new TimeOfDay();
    expect(clock.hour).toBe(16);
    clock.update(60);
    expect(clock.hour).toBeCloseTo(17, 9);
  });

  it('dá a volta em 24h e respeita dayLengthSeconds', () => {
    const clock = new TimeOfDay(23, { dayLengthSeconds: 24 });
    clock.update(2);
    expect(clock.hour).toBeCloseTo(1, 9);
  });

  it('não avança pausado nem com delta inválido', () => {
    const clock = new TimeOfDay(10, { paused: true });
    clock.update(100);
    expect(clock.hour).toBe(10);
    clock.paused = false;
    clock.update(-1);
    clock.update(Number.NaN);
    expect(clock.hour).toBe(10);
  });

  it('setTime normaliza e isDay acompanha o sol', () => {
    const clock = new TimeOfDay();
    clock.setTime(36);
    expect(clock.hour).toBe(12);
    expect(clock.isDay).toBe(true);
    clock.setTime(22);
    expect(clock.isDay).toBe(false);
    expect(() => clock.setTime(Number.NaN)).toThrow(RangeError);
  });

  it('rejeita duração de dia não positiva', () => {
    expect(() => new TimeOfDay(12, { dayLengthSeconds: 0 })).toThrow(RangeError);
  });
});
