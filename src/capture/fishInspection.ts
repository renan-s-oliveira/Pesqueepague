import type { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface FishInspectionOptions {
  /** Centro do exemplar no estúdio. */
  readonly target: Vector3;
  /** Comprimento total do peixe em metros: dá a escala dos limites de zoom. */
  readonly fishLengthM: number;
}

/** Fatores dos limites de zoom relativos ao comprimento do peixe. */
export const ZOOM_MIN_FACTOR = 1.4;
export const ZOOM_MAX_FACTOR = 5;
/** No modo 'Ver detalhes' a câmera fica presa perto do corpo. */
export const DETAIL_MAX_FACTOR = 2;

/**
 * Inspeção do exemplar com OrbitControls (three/addons): giro completo de 360° no azimute,
 * inclinação limitada para não atravessar o estúdio, zoom contido entre os fatores acima e o
 * modo 'Ver detalhes', que aproxima e trava a câmera junto ao corpo. Mouse e teclado
 * (setas giram, +/− aproximam) já funcionam pelo próprio OrbitControls.
 */
export class FishInspection {
  readonly controls: OrbitControls;
  private readonly minDist: number;
  private readonly maxDist: number;
  private detail = false;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, options: FishInspectionOptions) {
    if (!(Number.isFinite(options.fishLengthM) && options.fishLengthM > 0)) {
      throw new RangeError(`fishLengthM deve ser > 0; recebido: ${String(options.fishLengthM)}`);
    }
    this.minDist = options.fishLengthM * ZOOM_MIN_FACTOR;
    this.maxDist = options.fishLengthM * ZOOM_MAX_FACTOR;
    const c = new OrbitControls(camera, domElement);
    c.target.copy(options.target);
    c.enablePan = false;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.rotateSpeed = 0.9;
    c.zoomSpeed = 0.8;
    // Azimute livre (360°); polar limitado para a câmera não mergulhar sob o estúdio.
    c.minPolarAngle = 0.25;
    c.maxPolarAngle = Math.PI - 0.6;
    c.minDistance = this.minDist;
    c.maxDistance = this.maxDist;
    c.update();
    this.controls = c;
  }

  get detailMode(): boolean {
    return this.detail;
  }

  /** Liga/desliga a inspeção (desligada durante a transição cinematográfica). */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** 'Ver detalhes': aproxima e limita o zoom junto ao corpo; desligar devolve a amplitude normal. */
  setDetailMode(on: boolean): void {
    if (on === this.detail) return;
    this.detail = on;
    this.controls.maxDistance = on ? this.minDist * (DETAIL_MAX_FACTOR / ZOOM_MIN_FACTOR) : this.maxDist;
    this.controls.update();
  }

  /** Avança o amortecimento; chame uma vez por frame. */
  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
