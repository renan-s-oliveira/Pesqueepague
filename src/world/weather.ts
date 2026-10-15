/** Estado de clima puro (sem three): cobertura de nuvens, chuva, névoa e o vetor de vento compartilhado. */

export type WeatherKind = 'clear' | 'cloudy' | 'rain';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain'];

/** Vento no plano XZ em m/s. `x`/`z` já incluem a rajada; `speed` é o módulo. */
export interface Wind {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
}

interface WeatherTarget {
  readonly cloudCover: number;
  readonly rain: number;
  readonly fogDensity: number;
  readonly windSpeed: number;
}

export const WEATHER_PRESETS: Readonly<Record<WeatherKind, WeatherTarget>> = {
  clear: { cloudCover: 0.3, rain: 0, fogDensity: 0.1, windSpeed: 1.5 },
  cloudy: { cloudCover: 0.75, rain: 0, fogDensity: 0.35, windSpeed: 3.5 },
  rain: { cloudCover: 0.95, rain: 1, fogDensity: 0.7, windSpeed: 6 },
};

/** Alcance da névoa linear (near/far em metros) para uma densidade 0..1 e a luz do dia 0..1. */
export function fogRange(fogDensity: number, daylight: number): { near: number; far: number } {
  const d = Math.min(1, Math.max(0, fogDensity));
  const night = 1 - Math.min(1, Math.max(0, daylight));
  const far = (380 - 250 * d) * (1 - 0.25 * night);
  const near = (70 - 60 * d) * (1 - 0.3 * night);
  return { near, far };
}

export function isWeatherKind(value: unknown): value is WeatherKind {
  return typeof value === 'string' && (WEATHER_KINDS as readonly string[]).includes(value);
}

/** Tempo (s) para a transição percorrer ~63% do caminho até o clima alvo. */
const TRANSITION_SECONDS = 8;
/** Direção base do vento (rad): soprando do lago para o píer, levemente de lado. */
const BASE_WIND_ANGLE = 0.6;

/**
 * Clima atual com transição suave. O vento usa só funções do tempo acumulado (sem aleatório),
 * então a mesma sequência de update dá o mesmo vento: água, vegetação e arremesso leem getWind().
 */
export class Weather {
  private target: WeatherKind;
  private elapsed = 0;
  private cover: number;
  private rainAmount: number;
  private fog: number;
  private windBase: number;
  private readonly wind = { x: 0, z: 0, speed: 0 };

  constructor(kind: WeatherKind = 'clear') {
    if (!isWeatherKind(kind)) throw new RangeError(`clima inválido: ${String(kind)}`);
    this.target = kind;
    const p = WEATHER_PRESETS[kind];
    this.cover = p.cloudCover;
    this.rainAmount = p.rain;
    this.fog = p.fogDensity;
    this.windBase = p.windSpeed;
    this.computeWind();
  }

  get kind(): WeatherKind {
    return this.target;
  }

  get cloudCover(): number {
    return this.cover;
  }

  get rainIntensity(): number {
    return this.rainAmount;
  }

  get fogDensity(): number {
    return this.fog;
  }

  /** Troca o clima alvo; `immediate` pula a transição (usado no e2e e ao carregar). */
  setWeather(kind: WeatherKind, immediate = false): void {
    if (!isWeatherKind(kind)) throw new RangeError(`clima inválido: ${String(kind)}. Use clear, cloudy ou rain.`);
    this.target = kind;
    if (immediate) {
      const p = WEATHER_PRESETS[kind];
      this.cover = p.cloudCover;
      this.rainAmount = p.rain;
      this.fog = p.fogDensity;
      this.windBase = p.windSpeed;
      this.computeWind();
    }
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed += deltaSeconds;
    const p = WEATHER_PRESETS[this.target];
    const k = 1 - Math.exp(-deltaSeconds / TRANSITION_SECONDS);
    this.cover += (p.cloudCover - this.cover) * k;
    this.rainAmount += (p.rain - this.rainAmount) * k;
    this.fog += (p.fogDensity - this.fog) * k;
    this.windBase += (p.windSpeed - this.windBase) * k;
    this.computeWind();
  }

  /** Vetor de vento compartilhado: o mesmo objeto, atualizado no lugar a cada update (sem alocar). */
  getWind(): Wind {
    return this.wind;
  }

  private computeWind(): void {
    const t = this.elapsed;
    const gust = 1 + 0.25 * Math.sin(t * 0.7) + 0.12 * Math.sin(t * 2.3 + 1.1);
    const angle = BASE_WIND_ANGLE + 0.2 * Math.sin(t * 0.05);
    const speed = this.windBase * gust;
    this.wind.x = Math.cos(angle) * speed;
    this.wind.z = Math.sin(angle) * speed;
    this.wind.speed = speed;
  }
}
