import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Object3D,
} from 'three';

/** Parâmetros da leitura amortecida e do posicionamento animado do peixe no prato. */
export interface WeighingParams {
  /** Frequência da oscilação da leitura (Hz). */
  readonly frequencyHz: number;
  /** Decaimento exponencial do envelope da oscilação (1/s). */
  readonly decayPerSec: number;
  /** Fração do peso-alvo abaixo da qual o envelope deixa a leitura estável. */
  readonly stableFraction: number;
  /** Duração do posicionamento animado do peixe sobre o prato (s). */
  readonly placementSec: number;
}

export const DEFAULT_WEIGHING: WeighingParams = {
  frequencyHz: 1.8,
  decayPerSec: 2.2,
  stableFraction: 0.005,
  placementSec: 0.6,
};

export function validateWeighingParams(p: WeighingParams): WeighingParams {
  if (!(Number.isFinite(p.frequencyHz) && p.frequencyHz > 0)) throw new RangeError('frequencyHz deve ser > 0');
  if (!(Number.isFinite(p.decayPerSec) && p.decayPerSec > 0)) throw new RangeError('decayPerSec deve ser > 0');
  if (!(Number.isFinite(p.stableFraction) && p.stableFraction > 0 && p.stableFraction < 1)) {
    throw new RangeError('stableFraction deve estar em (0, 1)');
  }
  if (!(Number.isFinite(p.placementSec) && p.placementSec >= 0)) throw new RangeError('placementSec deve ser >= 0');
  return p;
}

/** Peso com 3 casas e vírgula, como no visor de uma balança digital de pesqueiro. */
export function formatWeighingKg(kg: number): string {
  return `${kg.toFixed(3).replace('.', ',')} kg`;
}

/**
 * Leitura da balança t segundos depois de o peixe pousar no prato: oscilação amortecida
 * r(t) = alvo · (1 − e^(−λt)·cos(2πf·t)). Parte de zero, passa do alvo e converge para ele.
 */
export function weighingReadingKg(targetKg: number, tSec: number, params: WeighingParams = DEFAULT_WEIGHING): number {
  if (!(Number.isFinite(targetKg) && targetKg > 0)) {
    throw new RangeError(`targetKg deve ser > 0; recebido: ${String(targetKg)}`);
  }
  const p = validateWeighingParams(params);
  if (!Number.isFinite(tSec) || tSec <= 0) return 0;
  const envelope = Math.exp(-p.decayPerSec * tSec);
  return Math.max(0, targetKg * (1 - envelope * Math.cos(2 * Math.PI * p.frequencyHz * tSec)));
}

/** A partir deste tempo (s) o envelope fica abaixo de stableFraction e a leitura é estável. */
export function stableAfterSec(params: WeighingParams = DEFAULT_WEIGHING): number {
  const p = validateWeighingParams(params);
  return Math.log(1 / p.stableFraction) / p.decayPerSec;
}

export interface WeighingReadingOptions {
  readonly params?: WeighingParams;
  /** prefers-reduced-motion: sem animação, a leitura já abre estável no peso final. */
  readonly instant?: boolean;
}

/**
 * Estado da pesagem, puro e determinístico: o posicionamento segura a leitura em zero,
 * depois a oscilação amortecida converge até o peso do indivíduo. Estável, a leitura
 * trava exatamente no alvo, como o visor de uma balança digital.
 */
export class WeighingReading {
  readonly targetKg: number;
  readonly params: WeighingParams;
  private readonly instant: boolean;
  private tSec = 0;

  constructor(targetKg: number, options: WeighingReadingOptions = {}) {
    if (!(Number.isFinite(targetKg) && targetKg > 0)) {
      throw new RangeError(`targetKg deve ser > 0; recebido: ${String(targetKg)}`);
    }
    this.targetKg = targetKg;
    this.params = validateWeighingParams(options.params ?? DEFAULT_WEIGHING);
    this.instant = options.instant ?? false;
  }

  /** 0..1 do posicionamento do peixe sobre o prato. */
  get placementProgress(): number {
    if (this.instant || this.params.placementSec <= 0) return 1;
    return Math.min(1, this.tSec / this.params.placementSec);
  }

  private get oscillationSec(): number {
    return this.tSec - this.params.placementSec;
  }

  get stable(): boolean {
    return this.instant || this.oscillationSec >= stableAfterSec(this.params);
  }

  /** Leitura atual (kg); quando estável devolve exatamente o peso-alvo. */
  get readingKg(): number {
    if (this.stable) return this.targetKg;
    return weighingReadingKg(this.targetKg, this.oscillationSec, this.params);
  }

  /** Avança dt segundos (negativo ou não finito conta como zero) e devolve a leitura. */
  step(dtSec: number): number {
    this.tSec += Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    return this.readingKg;
  }
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Altura do topo do prato, onde o peixe repousa. */
export const PLATFORM_TOP_Y = 0.125;
/** De onde o peixe desce no posicionamento animado. */
const FISH_DROP_Y = 0.5;
/** Quanto o prato cede sob o peso, no máximo. */
const PLATFORM_DIP = 0.008;

/**
 * Balança digital 3D procedural: base, prato metálico e visor com textura de canvas que
 * mostra a leitura ao vivo. O peixe anexado desce animado até o prato e a leitura segue
 * a oscilação amortecida de WeighingReading até estabilizar no peso do indivíduo.
 */
export class WeighingScale {
  readonly root = new Group();
  readonly reading: WeighingReading;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly platform: Mesh;
  private readonly platformY: number;
  private displayCtx: CanvasRenderingContext2D | null = null;
  private displayTexture: CanvasTexture | null = null;
  private fish: Object3D | null = null;
  private fishRestY = 0;
  private placed = false;
  private lastText = '';

  constructor(targetKg: number, options: WeighingReadingOptions = {}) {
    this.reading = new WeighingReading(targetKg, options);

    const mat = (color: number, metalness: number, roughness: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, metalness, roughness });
      this.materials.push(m);
      return m;
    };
    const mesh = (geometry: BufferGeometry, material: MeshStandardMaterial): Mesh => {
      this.geometries.push(geometry);
      const m = new Mesh(geometry, material);
      this.root.add(m);
      return m;
    };

    const base = mesh(new BoxGeometry(0.56, 0.1, 0.42), mat(0x272c31, 0.3, 0.55));
    base.position.y = 0.05;
    this.platformY = PLATFORM_TOP_Y - 0.0175;
    this.platform = mesh(new CylinderGeometry(0.17, 0.19, 0.035, 28), mat(0x9aa4ab, 0.85, 0.35));
    this.platform.position.y = this.platformY;
    const housing = mesh(new BoxGeometry(0.24, 0.1, 0.035), mat(0x1b1f23, 0.2, 0.6));
    housing.position.set(0, 0.075, 0.21);
    housing.rotation.x = -0.35;

    // Visor: textura de canvas (atualizada ao vivo) sobre uma tela emissiva legível.
    const screenMat = new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 0.85 });
    this.materials.push(screenMat);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        this.displayCtx = ctx;
        this.displayTexture = new CanvasTexture(canvas);
        this.displayTexture.colorSpace = SRGBColorSpace;
        screenMat.map = this.displayTexture;
        screenMat.emissiveMap = this.displayTexture;
      }
    }
    const screenGeo = new PlaneGeometry(0.2, 0.065);
    this.geometries.push(screenGeo);
    const screen = new Mesh(screenGeo, screenMat);
    screen.position.set(0, 0.078, 0.2305);
    screen.rotation.x = -0.35;
    this.root.add(screen);
    this.drawDisplay(formatWeighingKg(0));
  }

  /** Anexa o peixe sobre a balança; ele desce animado até o prato durante o posicionamento. */
  attachFish(fish: Object3D, lengthM: number): void {
    this.fish = fish;
    this.fishRestY = PLATFORM_TOP_Y + Math.max(0.01, lengthM * 0.13);
    const done = this.reading.placementProgress >= 1;
    fish.position.set(0, done ? this.fishRestY : FISH_DROP_Y, 0);
    fish.rotation.y = -0.35;
    this.placed = done;
    this.root.add(fish);
  }

  /** Posição de repouso do peixe no prato (para animações de devolução). */
  get fishRestHeight(): number {
    return this.fishRestY;
  }

  /** Avança a pesagem: move o peixe, cede o prato e atualiza o visor. Devolve a leitura (kg). */
  update(dtSec: number): number {
    const kg = this.reading.step(dtSec);
    if (this.fish !== null && !this.placed) {
      const p = smoothstep(this.reading.placementProgress);
      this.fish.position.y = FISH_DROP_Y + (this.fishRestY - FISH_DROP_Y) * p;
      if (this.reading.placementProgress >= 1) this.placed = true;
    }
    this.platform.position.y = this.platformY - PLATFORM_DIP * Math.min(1, kg / this.reading.targetKg);
    this.drawDisplay(formatWeighingKg(this.reading.stable ? this.reading.targetKg : kg));
    return kg;
  }

  private drawDisplay(text: string): void {
    if (this.displayCtx === null || this.displayTexture === null || text === this.lastText) return;
    this.lastText = text;
    const ctx = this.displayCtx;
    ctx.fillStyle = '#0c1210';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#7dffae';
    ctx.font = 'bold 44px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
    this.displayTexture.needsUpdate = true;
  }

  /** Libera geometrias, materiais e a textura do visor; o peixe pertence a quem o anexou. */
  dispose(): void {
    if (this.fish !== null) this.root.remove(this.fish);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.displayTexture?.dispose();
  }
}
