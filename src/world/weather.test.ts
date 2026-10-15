import { describe, expect, it } from 'vitest';
import { WEATHER_PRESETS, Weather, fogRange, isWeatherKind, type WeatherKind } from './weather';

describe('fogRange', () => {
  it('névoa mais densa aproxima near e far', () => {
    const thin = fogRange(0.1, 1);
    const thick = fogRange(0.7, 1);
    expect(thick.far).toBeLessThan(thin.far);
    expect(thick.near).toBeLessThan(thin.near);
  });

  it('noite encurta o alcance e valores fora de 0..1 são limitados', () => {
    expect(fogRange(0.3, 0).far).toBeLessThan(fogRange(0.3, 1).far);
    expect(fogRange(2, 1)).toEqual(fogRange(1, 1));
    expect(fogRange(-1, 5)).toEqual(fogRange(0, 1));
  });

  it('near sempre antes de far', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      for (const day of [0, 0.5, 1]) {
        const { near, far } = fogRange(d, day);
        expect(near).toBeGreaterThan(0);
        expect(far).toBeGreaterThan(near);
      }
    }
  });
});

describe('Weather', () => {
  it('começa no preset pedido', () => {
    const w = new Weather('cloudy');
    expect(w.kind).toBe('cloudy');
    expect(w.cloudCover).toBe(WEATHER_PRESETS.cloudy.cloudCover);
    expect(w.rainIntensity).toBe(0);
    expect(w.fogDensity).toBe(WEATHER_PRESETS.cloudy.fogDensity);
  });

  it('rejeita clima desconhecido', () => {
    expect(isWeatherKind('rain')).toBe(true);
    expect(isWeatherKind('snow')).toBe(false);
    expect(() => new Weather('snow' as WeatherKind)).toThrow(RangeError);
    expect(() => new Weather().setWeather('fog' as WeatherKind)).toThrow(RangeError);
  });

  it('setWeather imediato aplica o preset na hora', () => {
    const w = new Weather('clear');
    w.setWeather('rain', true);
    expect(w.kind).toBe('rain');
    expect(w.rainIntensity).toBe(1);
    expect(w.cloudCover).toBe(WEATHER_PRESETS.rain.cloudCover);
  });

  it('transição suave converge para o alvo sem passar dele', () => {
    const w = new Weather('clear');
    w.setWeather('rain');
    expect(w.rainIntensity).toBe(0);
    w.update(1);
    const first = w.rainIntensity;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    for (let i = 0; i < 120; i++) w.update(1);
    expect(w.rainIntensity).toBeGreaterThan(first);
    expect(w.rainIntensity).toBeLessThanOrEqual(1);
    expect(w.rainIntensity).toBeCloseTo(1, 3);
    expect(w.fogDensity).toBeCloseTo(WEATHER_PRESETS.rain.fogDensity, 3);
  });

  it('ignora delta inválido', () => {
    const w = new Weather('clear');
    w.setWeather('rain');
    w.update(0);
    w.update(-1);
    w.update(Number.NaN);
    expect(w.rainIntensity).toBe(0);
  });

  it('getWind devolve sempre o mesmo objeto, atualizado no lugar', () => {
    const w = new Weather('clear');
    const wind = w.getWind();
    const before = wind.x;
    w.update(0.5);
    expect(w.getWind()).toBe(wind);
    expect(wind.x).not.toBe(before);
    expect(Math.hypot(wind.x, wind.z)).toBeCloseTo(wind.speed, 9);
  });

  it('vento é determinístico para a mesma sequência de updates', () => {
    const a = new Weather('clear');
    const b = new Weather('clear');
    for (const w of [a, b]) {
      w.setWeather('rain');
      for (let i = 0; i < 30; i++) w.update(1 / 30);
    }
    expect({ ...a.getWind() }).toEqual({ ...b.getWind() });
  });

  it('chuva venta mais que céu limpo', () => {
    const clear = new Weather('clear');
    const rain = new Weather('rain');
    expect(rain.getWind().speed).toBeGreaterThan(clear.getWind().speed);
  });
});
