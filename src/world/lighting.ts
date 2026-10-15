import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  Scene,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { SUN_DIRECTION } from './layout.ts';

const VALID_SHADOW_SIZES = new Set([256, 512, 1024, 2048, 4096]);
const SUN_DISTANCE = 120;
/** Raio do domo usado só para gerar o environment map, dentro do far da câmera cúbica do PMREM. */
const ENV_SKY_SCALE = 0.1;

export interface KeyLightState {
  /** Direção da luz principal (sol de dia, lua de noite), normalizada. */
  readonly direction: Vector3;
  readonly color: Color;
  readonly intensity: number;
  readonly hemiSky: Color;
  readonly hemiGround: Color;
  readonly hemiIntensity: number;
}

/**
 * Luz dinâmica: direcional (sol/lua) com sombra ajustada pelo preset, luz hemisférica que nunca
 * zera (sombra sem preto) e environment map PMREM gerado do próprio céu para reflexos PBR.
 */
export class Lighting {
  readonly group = new Group();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  private pmrem: PMREMGenerator | null = null;
  private envTarget: WebGLRenderTarget | null = null;
  private readonly envScene = new Scene();

  constructor() {
    this.hemi = new HemisphereLight(0x9fc0e0, 0x5a4a32, 0.9);
    const sun = new DirectionalLight(0xffc48a, 2.4);
    const dir = new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize();
    sun.position.copy(dir.multiplyScalar(SUN_DISTANCE));
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
    this.group.add(this.hemi, sun, sun.target);
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

  /** Aplica o estado da hora/clima sem alocar. A sombra fica mais suave quando a luz é fraca. */
  setKeyLight(state: KeyLightState): void {
    this.sun.position.copy(state.direction).multiplyScalar(SUN_DISTANCE).add(this.sun.target.position);
    this.sun.color.copy(state.color);
    this.sun.intensity = state.intensity;
    this.sun.shadow.radius = state.intensity < 1 ? 3 : 1;
    this.hemi.color.copy(state.hemiSky);
    this.hemi.groundColor.copy(state.hemiGround);
    this.hemi.intensity = state.hemiIntensity;
  }

  /**
   * Regenera o environment map a partir do material do céu e o publica em `scene.environment`.
   * Caro: chamar só quando hora ou clima mudarem o bastante, nunca a cada frame.
   */
  updateEnvironment(
    renderer: WebGLRenderer,
    scene: Scene,
    sky: Mesh<BufferGeometry, Material>,
    intensity: number,
  ): void {
    this.pmrem ??= new PMREMGenerator(renderer);
    if (this.envScene.children.length === 0) {
      const proxy = new Mesh(sky.geometry, sky.material);
      proxy.scale.setScalar(ENV_SKY_SCALE);
      proxy.frustumCulled = false;
      this.envScene.add(proxy);
    }
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.envTarget?.dispose();
    this.envTarget = next;
    scene.environment = next.texture as Texture;
    scene.environmentIntensity = intensity;
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.envTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.envScene.clear();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
  }
}
