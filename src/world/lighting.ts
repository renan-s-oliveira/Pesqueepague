import { DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';
import { SUN_DIRECTION } from './layout.ts';

const VALID_SHADOW_SIZES = new Set([256, 512, 1024, 2048, 4096]);

/** Luz de fim de tarde: sol baixo e quente com sombras ajustáveis, mais luz de céu. */
export class Lighting {
  readonly group = new Group();
  readonly sun: DirectionalLight;

  constructor() {
    const hemi = new HemisphereLight(0x9fc0e0, 0x5a4a32, 0.9);
    const sun = new DirectionalLight(0xffc48a, 2.4);
    const dir = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
    sun.position.copy(dir.multiplyScalar(120));
    sun.target.position.set(0, 0, 10);
    const cam = sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.group.add(hemi, sun, sun.target);
    this.setShadows(true, 2048);
  }

  setShadows(enabled: boolean, mapSize: number): void {
    if (!VALID_SHADOW_SIZES.has(mapSize)) throw new RangeError(`tamanho de shadow map inválido: ${mapSize}`);
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
  }
}
