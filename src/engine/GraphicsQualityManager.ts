export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityPreset = QualityLevel | 'auto';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'auto'];

/** Rótulos para a interface (Baixa/Média/Alta/Auto). */
export const QUALITY_PRESET_LABELS: Readonly<Record<QualityPreset, string>> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
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
  },
  medium: {
    level: 'medium',
    pixelRatioScale: 0.85,
    shadows: true,
    shadowMapSize: 1024,
    particleCount: 150,
    vegetationDensity: 0.75,
    waterDetail: 0.5,
  },
  high: {
    level: 'high',
    pixelRatioScale: 1,
    shadows: true,
    shadowMapSize: 2048,
    particleCount: 300,
    vegetationDensity: 1,
    waterDetail: 1,
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
  readonly initialLevel: QualityLevel;
  readonly preset: QualityPreset;
}

export const DEFAULT_QUALITY_OPTIONS: QualityManagerOptions = {
  windowSize: 90,
  downgradeAboveMs: 24,
  upgradeBelowMs: 18,
  upgradeDelayFrames: 600,
  minLevel: 'low',
  maxLevel: 'high',
  initialLevel: 'high',
  preset: 'auto',
};

/** Frames acima disto (aba voltando, travada pontual) entram limitados para não derrubar a média sozinhos. */
const MAX_SAMPLE_MS = 250;

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && (QUALITY_PRESETS as readonly string[]).includes(value);
}

function levelIndex(level: QualityLevel, field: string): number {
  const index = QUALITY_LEVELS.indexOf(level);
  if (index < 0) throw new RangeError(`${field} inválido: ${String(level)}; use low, medium ou high`);
  return index;
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
  private head = 0;
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
    if (!isQualityPreset(options.preset)) throw new RangeError(`preset inválido: ${String(options.preset)}`);

    this.options = options;
    this.samples = new Float64Array(options.windowSize);
    this.index = this.clampIndex(levelIndex(options.initialLevel, 'initialLevel'));
    this.currentPreset = options.preset;
    if (options.preset !== 'auto') this.index = this.clampIndex(levelIndex(options.preset, 'preset'));
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

  /** Média atual do frame time em ms, ou null enquanto a janela não encheu. */
  get averageFrameMs(): number | null {
    return this.count < this.samples.length ? null : this.sum / this.samples.length;
  }

  /** Troca o preset. Presets fixos também respeitam minLevel/maxLevel. Devolve true se o nível mudou. */
  setPreset(preset: QualityPreset): boolean {
    if (!isQualityPreset(preset)) throw new RangeError(`preset inválido: ${String(preset)}`);
    const before = this.index;
    this.currentPreset = preset;
    if (preset !== 'auto') this.index = this.clampIndex(levelIndex(preset, 'preset'));
    this.resetWindow();
    return before !== this.index;
  }

  /** Registra o frame time (ms) de um frame. Devolve true quando o nível mudou. Não aloca. */
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

    if (average > this.options.downgradeAboveMs && this.index > this.minIndex) {
      this.index -= 1;
    } else if (
      average < this.options.upgradeBelowMs &&
      this.index < this.maxIndex &&
      this.framesSinceChange >= this.options.upgradeDelayFrames
    ) {
      this.index += 1;
    } else {
      return false;
    }
    this.resetWindow();
    return true;
  }

  private clampIndex(index: number): number {
    return Math.min(this.maxIndex, Math.max(this.minIndex, index));
  }

  private resetWindow(): void {
    this.samples.fill(0);
    this.head = 0;
    this.count = 0;
    this.sum = 0;
    this.framesSinceChange = 0;
  }
}
