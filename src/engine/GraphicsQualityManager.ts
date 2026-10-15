import type { PostProcessingSettings } from './postprocessing.ts';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityPreset = QualityLevel | 'auto';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra', 'auto'];

/** Rótulos para a interface (Baixa/Média/Alta/Ultra/Auto). */
export const QUALITY_PRESET_LABELS: Readonly<Record<QualityPreset, string>> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  ultra: 'Ultra',
  auto: 'Auto',
};

export interface QualitySettings {
  readonly level: QualityLevel;
  /** Multiplica o pixel ratio do dispositivo (resolução interna). */
  readonly pixelRatioScale: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly particleCount: number;
  /** Fração das instâncias de vegetação desenhadas, em (0, 1]. */
  readonly vegetationDensity: number;
  /** Peso das ondas finas da água, em [0, 1]. */
  readonly waterDetail: number;
  readonly postProcessing: PostProcessingSettings;
}

export const QUALITY_SETTINGS: Readonly<Record<QualityLevel, QualitySettings>> = {
  low: {
    level: 'low',
    pixelRatioScale: 0.6,
    shadows: false,
    shadowMapSize: 512,
    particleCount: 60,
    vegetationDensity: 0.45,
    waterDetail: 0,
    postProcessing: { antialias: 'fxaa', ambientOcclusion: 0, bloomStrength: 0 },
  },
  medium: {
    level: 'medium',
    pixelRatioScale: 0.85,
    shadows: true,
    shadowMapSize: 1024,
    particleCount: 150,
    vegetationDensity: 0.75,
    waterDetail: 0.5,
    postProcessing: { antialias: 'fxaa', ambientOcclusion: 0, bloomStrength: 0.08 },
  },
  high: {
    level: 'high',
    pixelRatioScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    particleCount: 300,
    vegetationDensity: 1,
    waterDetail: 1,
    postProcessing: { antialias: 'smaa', ambientOcclusion: 0.6, bloomStrength: 0.12 },
  },
  ultra: {
    level: 'ultra',
    pixelRatioScale: 1,
    shadows: true,
    shadowMapSize: 4096,
    particleCount: 300,
    vegetationDensity: 1,
    waterDetail: 1,
    postProcessing: { antialias: 'smaa', ambientOcclusion: 0.85, bloomStrength: 0.16 },
  },
};

export interface QualityManagerOptions {
  /** Quantos frames entram na média móvel. */
  readonly windowSize: number;
  /** Média acima disto (ms) baixa um nível. */
  readonly downgradeAboveMs: number;
  /** Média abaixo disto (ms) sobe um nível. Entre os dois limiares nada muda (histerese). */
  readonly upgradeBelowMs: number;
  /** Frames mínimos desde a última troca antes de subir de nível (evita oscilar). */
  readonly upgradeDelayFrames: number;
  readonly minLevel: QualityLevel;
  readonly maxLevel: QualityLevel;
  /** Teto do modo auto: o Ultra só entra por escolha manual. */
  readonly autoMaxLevel: QualityLevel;
  /**
   * Menor escala de resolução dinâmica do modo auto, em [0.5, 1]. Antes de baixar o nível, o auto reduz a
   * resolução interna em passos de RESOLUTION_STEP até este piso; ao sobrar folga, devolve a resolução antes
   * de subir o nível. 1 desliga a escala dinâmica.
   */
  readonly minResolutionScale: number;
  readonly initialLevel: QualityLevel;
  readonly preset: QualityPreset;
}

export const DEFAULT_QUALITY_OPTIONS: QualityManagerOptions = {
  windowSize: 90,
  downgradeAboveMs: 24,
  upgradeBelowMs: 18,
  upgradeDelayFrames: 600,
  minLevel: 'low',
  maxLevel: 'ultra',
  autoMaxLevel: 'high',
  minResolutionScale: 1,
  initialLevel: 'high',
  preset: 'auto',
};

/** Frames acima disto (aba voltando, travada pontual) entram limitados para não derrubar a média sozinhos. */
const MAX_SAMPLE_MS = 250;
export const RESOLUTION_STEP = 0.1;

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && (QUALITY_PRESETS as readonly string[]).includes(value);
}

function levelIndex(level: QualityLevel, field: string): number {
  const index = QUALITY_LEVELS.indexOf(level);
  if (index < 0) throw new RangeError(`${field} inválido: ${String(level)}; use low, medium, high ou ultra`);
  return index;
}

/** Evita deriva de ponto flutuante ao somar passos de 0.1. */
function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

function levelAt(index: number): QualityLevel {
  return QUALITY_LEVELS[index] as QualityLevel;
}

/**
 * Ajusta a qualidade gráfica pela média móvel do frame time.
 * Não depende de relógio: quem chama informa cada frame time, o que deixa o comportamento determinístico nos testes.
 */
export class GraphicsQualityManager {
  private readonly options: QualityManagerOptions;
  private readonly samples: Float64Array;
  private readonly minIndex: number;
  private readonly maxIndex: number;
  private readonly autoMaxIndex: number;
  private head = 0;
  private scale = 1;
  private count = 0;
  private sum = 0;
  private framesSinceChange = 0;
  private index: number;
  private currentPreset: QualityPreset;

  constructor(overrides: Partial<QualityManagerOptions> = {}) {
    const options: QualityManagerOptions = { ...DEFAULT_QUALITY_OPTIONS, ...overrides };
    if (!Number.isInteger(options.windowSize) || options.windowSize < 1 || options.windowSize > 1000) {
      throw new RangeError('windowSize deve ser inteiro entre 1 e 1000');
    }
    if (!(Number.isFinite(options.upgradeBelowMs) && options.upgradeBelowMs > 0)) {
      throw new RangeError('upgradeBelowMs deve ser um número positivo');
    }
    if (!(Number.isFinite(options.downgradeAboveMs) && options.downgradeAboveMs > options.upgradeBelowMs)) {
      throw new RangeError('downgradeAboveMs deve ser maior que upgradeBelowMs para existir faixa de histerese');
    }
    if (!Number.isInteger(options.upgradeDelayFrames) || options.upgradeDelayFrames < 0) {
      throw new RangeError('upgradeDelayFrames deve ser inteiro não negativo');
    }
    this.minIndex = levelIndex(options.minLevel, 'minLevel');
    this.maxIndex = levelIndex(options.maxLevel, 'maxLevel');
    if (this.minIndex > this.maxIndex) throw new RangeError('minLevel não pode ser maior que maxLevel');
    this.autoMaxIndex = Math.max(this.minIndex, Math.min(this.maxIndex, levelIndex(options.autoMaxLevel, 'autoMaxLevel')));
    if (!(Number.isFinite(options.minResolutionScale) && options.minResolutionScale >= 0.5 && options.minResolutionScale <= 1)) {
      throw new RangeError('minResolutionScale deve estar entre 0.5 e 1');
    }
    if (!isQualityPreset(options.preset)) throw new RangeError(`preset inválido: ${String(options.preset)}`);

    this.options = options;
    this.samples = new Float64Array(options.windowSize);
    this.currentPreset = options.preset;
    this.index =
      options.preset === 'auto'
        ? this.clampIndex(levelIndex(options.initialLevel, 'initialLevel'), this.autoMaxIndex)
        : this.clampIndex(levelIndex(options.preset, 'preset'));
  }

  get preset(): QualityPreset {
    return this.currentPreset;
  }

  get level(): QualityLevel {
    return levelAt(this.index);
  }

  get settings(): QualitySettings {
    return QUALITY_SETTINGS[this.level];
  }

  /** Escala de resolução dinâmica do modo auto, em [minResolutionScale, 1]; presets fixos ficam em 1. */
  get resolutionScale(): number {
    return this.scale;
  }

  /** Pixel ratio efetivo: o do nível vezes a escala dinâmica. */
  get pixelRatioScale(): number {
    return this.settings.pixelRatioScale * this.scale;
  }

  /** Média atual do frame time em ms, ou null enquanto a janela não encheu. */
  get averageFrameMs(): number | null {
    return this.count < this.samples.length ? null : this.sum / this.samples.length;
  }

  /**
   * Troca o preset. Presets fixos respeitam minLevel/maxLevel; o auto parte do nível atual limitado a autoMaxLevel.
   * Devolve true se o nível ou a escala de resolução mudou.
   */
  setPreset(preset: QualityPreset): boolean {
    if (!isQualityPreset(preset)) throw new RangeError(`preset inválido: ${String(preset)}`);
    const before = this.index;
    const beforeScale = this.scale;
    this.currentPreset = preset;
    this.scale = 1;
    this.index =
      preset === 'auto' ? this.clampIndex(this.index, this.autoMaxIndex) : this.clampIndex(levelIndex(preset, 'preset'));
    this.resetWindow();
    return before !== this.index || beforeScale !== this.scale;
  }

  /** Registra o frame time (ms) de um frame. Devolve true quando o nível ou a escala mudou. Não aloca. */
  sample(frameMs: number): boolean {
    if (this.currentPreset !== 'auto') return false;
    if (!Number.isFinite(frameMs) || frameMs <= 0) return false;

    const value = Math.min(frameMs, MAX_SAMPLE_MS);
    const size = this.samples.length;
    if (this.count === size) this.sum -= this.samples[this.head] ?? 0;
    else this.count += 1;
    this.samples[this.head] = value;
    this.sum += value;
    this.head = (this.head + 1) % size;
    this.framesSinceChange += 1;

    if (this.count < size) return false;
    const average = this.sum / size;

    const minScale = this.options.minResolutionScale;
    if (average > this.options.downgradeAboveMs && this.scale > minScale) {
      this.scale = Math.max(minScale, roundScale(this.scale - RESOLUTION_STEP));
    } else if (average > this.options.downgradeAboveMs && this.index > this.minIndex) {
      this.index -= 1;
      this.scale = 1;
    } else if (average < this.options.upgradeBelowMs && this.framesSinceChange >= this.options.upgradeDelayFrames) {
      if (this.scale < 1) this.scale = Math.min(1, roundScale(this.scale + RESOLUTION_STEP));
      else if (this.index < this.autoMaxIndex) this.index += 1;
      else return false;
    } else {
      return false;
    }
    this.resetWindow();
    return true;
  }

  private clampIndex(index: number, max = this.maxIndex): number {
    return Math.min(max, Math.max(this.minIndex, index));
  }

  private resetWindow(): void {
    this.samples.fill(0);
    this.head = 0;
    this.count = 0;
    this.sum = 0;
    this.framesSinceChange = 0;
  }
}
