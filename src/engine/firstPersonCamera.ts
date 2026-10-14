import type { PerspectiveCamera } from 'three';

export interface LookLimits {
  readonly minYaw: number;
  readonly maxYaw: number;
  readonly minPitch: number;
  readonly maxPitch: number;
}

const HALF_PI = Math.PI / 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Câmera em primeira pessoa parada num ponto, com yaw e pitch limitados. */
export class FirstPersonCamera {
  readonly camera: PerspectiveCamera;
  private readonly limits: LookLimits;
  private yaw: number;
  private pitch: number;

  constructor(camera: PerspectiveCamera, limits: LookLimits) {
    const { minYaw, maxYaw, minPitch, maxPitch } = limits;
    if (![minYaw, maxYaw, minPitch, maxPitch].every(Number.isFinite) || minYaw > maxYaw || minPitch > maxPitch) {
      throw new RangeError('limites de câmera inválidos: min deve ser <= max e todos finitos');
    }
    if (minPitch < -HALF_PI || maxPitch > HALF_PI) {
      throw new RangeError('pitch deve ficar dentro de [-π/2, π/2]');
    }
    this.camera = camera;
    this.limits = limits;
    this.yaw = clamp(0, minYaw, maxYaw);
    this.pitch = clamp(0, minPitch, maxPitch);
    camera.rotation.order = 'YXZ';
    this.apply();
  }

  get angles(): { readonly yaw: number; readonly pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  setPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
  }

  setAngles(yaw: number, pitch: number): void {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.yaw = clamp(yaw, this.limits.minYaw, this.limits.maxYaw);
    this.pitch = clamp(pitch, this.limits.minPitch, this.limits.maxPitch);
    this.apply();
  }

  rotate(deltaYaw: number, deltaPitch: number): void {
    this.setAngles(this.yaw + deltaYaw, this.pitch + deltaPitch);
  }

  /** Olhar com o mouse (pointer lock ao clicar). Devolve a função que remove os listeners. */
  attachPointer(element: HTMLElement, sensitivity = 0.0022): () => void {
    if (!(Number.isFinite(sensitivity) && sensitivity > 0 && sensitivity < 0.05)) {
      throw new RangeError('sensibilidade do mouse deve estar entre 0 e 0.05');
    }
    const onClick = (): void => {
      if (document.pointerLockElement !== element) void element.requestPointerLock();
    };
    const onMove = (event: MouseEvent): void => {
      if (document.pointerLockElement !== element) return;
      this.rotate(-event.movementX * sensitivity, -event.movementY * sensitivity);
    };
    element.addEventListener('click', onClick);
    document.addEventListener('mousemove', onMove);
    return () => {
      element.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMove);
      if (document.pointerLockElement === element) document.exitPointerLock();
    };
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
