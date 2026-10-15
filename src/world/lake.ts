import {
  Color,
  DataTexture,
  LinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Fog,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { LAKE, SUN_DIRECTION } from './layout.ts';
import type { SplashKind } from './splash.ts';
import type { Wind } from './weather.ts';

export const MAX_RIPPLES = 8;
/** Profundidade (m) que satura a cor de água funda e a opacidade. */
const MAX_DEPTH = 4;
const DEPTH_MAP_SIZE = 128;
/** Vento acima disto (m/s) não aumenta mais as ondas. */
const WIND_FOR_FULL_WAVES = 8;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uDetail;
uniform vec2 uWindDir;
uniform float uWindStrength;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

// Onda de Gerstner (GPU Gems 1, cap. 1): desloca o vértice em círculo e acumula a normal analítica.
void gerstner(vec2 p, vec2 dir, float wavelength, float steep, float amp, inout vec3 offset, inout vec3 normal) {
  float k = 6.2831853 / wavelength;
  float c = sqrt(9.8 / k);
  float f = k * (dot(dir, p) - c * uTime);
  float cf = cos(f);
  float sf = sin(f);
  offset.x += steep * amp * dir.x * cf;
  offset.z += steep * amp * dir.y * cf;
  offset.y += amp * sf;
  normal.x -= dir.x * k * amp * cf;
  normal.z -= dir.y * k * amp * cf;
  normal.y -= steep * k * amp * sf;
}

vec2 rotate(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 offset = vec3(0.0);
  vec3 normal = vec3(0.0, 1.0, 0.0);
  float a = 0.45 + uWindStrength;
  gerstner(world.xz, uWindDir, 9.0, 0.5, 0.06 * a, offset, normal);
  gerstner(world.xz, rotate(uWindDir, 0.6), 5.5, 0.45, 0.035 * a, offset, normal);
  gerstner(world.xz, rotate(uWindDir, -0.8), 2.6, 0.4, 0.014 * a * uDetail, offset, normal);
  gerstner(world.xz, rotate(uWindDir, 1.9), 1.4, 0.35, 0.006 * a * uDetail, offset, normal);
  world.xyz += offset;
  vNormal = normalize(normal);
  vWorldPos = world.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#ifdef ENVMAP_TYPE_CUBE_UV
uniform sampler2D uEnvMap;
uniform float uEnvIntensity;
#include <cube_uv_reflection_fragment>
#endif
uniform sampler2D uReflectionMap;
uniform mat4 uReflectionMatrix;
uniform float uReflectionStrength;
uniform float uTime;
uniform float uDetail;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSand;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uDepthMap;
uniform float uMaxDepth;
uniform vec4 uRipples[${MAX_RIPPLES}];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vec3 n = vNormal;
  float rippleFoam = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    vec2 d = vWorldPos.xz - r.xy;
    float dist = length(d) + 1e-4;
    float front = age * 1.6;
    float env = exp(-abs(dist - front) * 1.5) * exp(-age * 0.9) * r.w;
    float ring = sin((dist - front) * 9.0) * env;
    n.xz += (d / dist) * ring * 0.35;
    rippleFoam += max(ring, 0.0) * 0.25 * smoothstep(1.2, 0.0, age);
  }
  n = normalize(n);

  // Profundidade real (nível da água menos o terreno), assada da height field.
  float depth = texture2D(uDepthMap, vUv).r * uMaxDepth;
  float shallowness = 1.0 - smoothstep(0.0, uMaxDepth * 0.75, depth);

  vec3 toEye = cameraPosition - vWorldPos;
  float eyeDist = length(toEye);
  vec3 v = toEye / eyeDist;
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(r.y, 0.0, 1.0), 0.6));
  #ifdef ENVMAP_TYPE_CUBE_UV
  // Reflexo do céu pelo env map PMREM gerado pela atmosfera (lighting.ts).
  sky = textureCubeUV(uEnvMap, normalize(vec3(r.x, max(r.y, 0.02), r.z)), 0.06).rgb * uEnvIntensity;
  #endif
  if (uReflectionStrength > 0.0) {
    // Reflexo planar (Alto/Ultra): árvores, píer e montanhas vistos da câmera espelhada.
    vec4 rc = uReflectionMatrix * vec4(vWorldPos, 1.0);
    vec2 ruv = clamp(rc.xy / rc.w + n.xz * 0.04, 0.001, 0.999);
    sky = mix(sky, texture2D(uReflectionMap, ruv).rgb, uReflectionStrength);
  }
  float sun = pow(max(dot(r, uSunDir), 0.0), 180.0);

  // Refração aproximada: o fundo de areia aparece no raso, a cor absorve com a profundidade.
  vec3 body = mix(uDeep, uShallow, shallowness);
  body = mix(body, uSand, pow(shallowness, 3.0) * 0.6);
  body *= 0.55 + 0.45 * max(uSunDir.y, 0.0);

  // Espuma da margem: faixa onde a água fica rasa, quebrada por ondas que chegam à praia.
  float shoreBand = 1.0 - smoothstep(0.0, 0.35, depth);
  float surf = 0.55 + 0.45 * sin(depth * 28.0 - uTime * 1.7 + (vWorldPos.x + vWorldPos.z) * 0.6 * uDetail);
  float foam = clamp(shoreBand * surf + rippleFoam, 0.0, 1.0);

  vec3 color = mix(body, sky, fresnel) + uSunColor * sun * 2.5;
  color = mix(color, vec3(0.92, 0.95, 0.95), foam);
  color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, eyeDist));
  float alpha = mix(0.3, 0.95, smoothstep(0.0, 1.8, depth));
  alpha = max(alpha, max(fresnel, foam));
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface LakeColors {
  readonly skyTop: Color;
  readonly skyHorizon: Color;
  readonly sun: Color;
}

/** Altura do terreno em (x, z) do mundo; serve para a profundidade e a espuma das margens. */
export type GroundHeight = (x: number, z: number) => number;

/** Recebe o splash que acompanha uma ondulação de impacto (isca, salto, captura). */
export type ImpactListener = (x: number, z: number, kind: SplashKind, strength: number) => void;

/** Força da ondulação → tipo de splash. Abaixo de 0,5 é só ondulação (linha cortando a água). */
export function splashKindFor(strength: number): SplashKind | null {
  if (!Number.isFinite(strength) || strength < 0.5) return null;
  if (strength < 1) return 'lure';
  if (strength < 1.5) return 'jump';
  return 'catch';
}

/** Assa a profundidade da água (0..MAX_DEPTH → 0..255) sobre o plano do lago. */
function createDepthMap(size: number, ground: GroundHeight | undefined): DataTexture {
  const n = DEPTH_MAP_SIZE;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    // DataTexture: linha 0 = v 0. No plano girado, v 0 fica em +z.
    const z = LAKE.centerZ + (0.5 - (j + 0.5) / n) * size;
    for (let i = 0; i < n; i++) {
      const x = LAKE.centerX + ((i + 0.5) / n - 0.5) * size;
      const depth = ground ? LAKE.waterLevel - ground(x, z) : MAX_DEPTH;
      const value = Math.round(Math.min(1, Math.max(0, depth / MAX_DEPTH)) * 255);
      const k = (j * n + i) * 4;
      data[k] = value;
      data[k + 1] = value;
      data[k + 2] = value;
      data[k + 3] = 255;
    }
  }
  const texture = new DataTexture(data, n, n, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Lago com ondas de Gerstner dirigidas pelo vento, fresnel com o céu atual, cor e transparência
 * pela profundidade, espuma nas margens e ondulações interativas por uniform.
 */
export class Lake {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly ripples: Vector4[];
  private readonly windDir = new Vector2(1, 0);
  private nextRipple = 0;
  private impactListener: ImpactListener | null = null;
  private envHeight = 0;
  private reflectionTarget: WebGLRenderTarget | null = null;
  private reflectionScale = 0.5;
  private readonly reflectionMatrix = new Matrix4();
  private readonly mirror = new PerspectiveCamera();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly quat = new Quaternion();
  private readonly clipPlane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly bufferSize = new Vector2();
  private shadowMapsMissing = false;
  private readonly checkShadowMap = (object: Object3D): void => {
    const light = object as Object3D & { isLight?: boolean; shadow?: { map: unknown } };
    if (light.isLight && light.castShadow && light.shadow && !light.shadow.map) this.shadowMapsMissing = true;
  };

  constructor(colors: LakeColors, fog: Fog, ground?: GroundHeight) {
    const size = LAKE.radius * 3;
    const geometry = new PlaneGeometry(size, size, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, 0, 0));
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDetail: { value: 1 },
        uWindDir: { value: this.windDir },
        uWindStrength: { value: 0 },
        uSkyTop: { value: colors.skyTop },
        uSkyHorizon: { value: colors.skyHorizon },
        uDeep: { value: new Color(0x0f2f3a) },
        uShallow: { value: new Color(0x2f6a62) },
        uSand: { value: new Color(0x8f7d5a) },
        uSunDir: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize() },
        uSunColor: { value: colors.sun },
        uFogColor: { value: fog.color },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
        uDepthMap: { value: createDepthMap(size, ground) },
        uMaxDepth: { value: MAX_DEPTH },
        uRipples: { value: this.ripples },
        uEnvMap: { value: null },
        uEnvIntensity: { value: 1 },
        uReflectionMap: { value: null },
        uReflectionMatrix: { value: this.reflectionMatrix },
        uReflectionStrength: { value: 0 },
      },
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'lake';
    this.mesh.position.set(LAKE.centerX, LAKE.waterLevel, LAKE.centerZ);
  }

  setDetail(detail: number): void {
    const uniform = this.mesh.material.uniforms['uDetail'];
    if (uniform) uniform.value = Math.min(1, Math.max(0, detail));
  }

  /** Quem recebe o splash das ondulações de impacto (a cena liga ao pool de partículas). */
  setImpactListener(listener: ImpactListener | null): void {
    this.impactListener = listener;
  }

  /**
   * Dispara uma ondulação circular a partir de (x, z) no instante `time` (segundos do relógio do jogo).
   * Com `splash`, impactos fortes também avisam o ouvinte (ver splashKindFor).
   */
  addRipple(x: number, z: number, strength: number, time: number, splash = true): void {
    if (!(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(strength) && Number.isFinite(time))) return;
    if (strength <= 0) return;
    const slot = this.ripples[this.nextRipple];
    if (!slot) return;
    const s = Math.min(strength, 2);
    slot.set(x, z, time, s);
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
    const kind = splash ? splashKindFor(s) : null;
    if (kind && this.impactListener) this.impactListener(x, z, kind, s);
  }

  update(elapsedSeconds: number, wind?: Wind): void {
    const u = this.mesh.material.uniforms;
    if (u['uTime']) u['uTime'].value = elapsedSeconds;
    if (!wind) return;
    if (wind.speed > 1e-3) this.windDir.set(wind.x / wind.speed, wind.z / wind.speed);
    if (u['uWindStrength']) u['uWindStrength'].value = Math.min(1, Math.max(0, wind.speed) / WIND_FOR_FULL_WAVES);
  }

  get hasEnvironment(): boolean {
    return this.envHeight > 0;
  }

  get reflectionEnabled(): boolean {
    return this.reflectionTarget !== null;
  }

  /**
   * Usa o env map PMREM (scene.environment) como reflexo do céu. Só recompila o shader quando o
   * tamanho do mapa muda; sem env map, volta ao gradiente uSkyTop/uSkyHorizon.
   */
  setEnvironment(texture: Texture | null, intensity: number): void {
    const material = this.mesh.material;
    const u = material.uniforms;
    const height = (texture?.image as { height?: number } | undefined)?.height ?? 0;
    if (u['uEnvMap']) u['uEnvMap'].value = height > 0 ? texture : null;
    if (u['uEnvIntensity']) u['uEnvIntensity'].value = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;
    if (height === this.envHeight) return;
    this.envHeight = height;
    const defines = material.defines as Record<string, string>;
    delete defines['ENVMAP_TYPE_CUBE_UV'];
    delete defines['CUBEUV_TEXEL_WIDTH'];
    delete defines['CUBEUV_TEXEL_HEIGHT'];
    delete defines['CUBEUV_MAX_MIP'];
    if (height > 0) {
      // Mesmas constantes que o WebGLPrograms do three gera para materiais PBR com PMREM.
      const maxMip = Math.log2(height) - 2;
      defines['ENVMAP_TYPE_CUBE_UV'] = '';
      defines['CUBEUV_TEXEL_WIDTH'] = (1 / (3 * Math.max(2 ** maxMip, 7 * 16))).toFixed(10);
      defines['CUBEUV_TEXEL_HEIGHT'] = (1 / height).toFixed(10);
      defines['CUBEUV_MAX_MIP'] = maxMip.toFixed(1);
    }
    material.needsUpdate = true;
  }

  /**
   * Liga o reflexo planar (presets Alto e Ultra) com o render target em `resolutionScale` da tela;
   * desligado, libera o render target e o shader volta ao env map.
   */
  setPlanarReflection(enabled: boolean, resolutionScale = 0.5): void {
    const u = this.mesh.material.uniforms;
    if (!enabled) {
      this.reflectionTarget?.dispose();
      this.reflectionTarget = null;
      if (u['uReflectionMap']) u['uReflectionMap'].value = null;
      if (u['uReflectionStrength']) u['uReflectionStrength'].value = 0;
      return;
    }
    this.reflectionScale = Math.min(1, Math.max(0.25, Number.isFinite(resolutionScale) ? resolutionScale : 0.5));
    this.reflectionTarget ??= new WebGLRenderTarget(1, 1, { type: UnsignedByteType, colorSpace: SRGBColorSpace });
    if (u['uReflectionMap']) u['uReflectionMap'].value = this.reflectionTarget.texture;
  }

  /**
   * Desenha a cena vista da câmera espelhada no plano da água (sem o próprio lago), com plano de
   * corte oblíquo para nada abaixo da superfície aparecer. Chamar antes do render principal; não aloca.
   */
  renderReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    const target = this.reflectionTarget;
    const strength = this.mesh.material.uniforms['uReflectionStrength'];
    if (!target || !strength) return;
    const level = LAKE.waterLevel;
    camera.updateMatrixWorld();
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    if (this.eye.y <= level + 0.01) {
      strength.value = 0;
      return;
    }
    renderer.getDrawingBufferSize(this.bufferSize);
    const w = Math.max(1, Math.floor(this.bufferSize.x * this.reflectionScale));
    const h = Math.max(1, Math.floor(this.bufferSize.y * this.reflectionScale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    camera.getWorldDirection(this.forward).add(this.eye);
    this.up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(this.quat));
    const mirror = this.mirror;
    mirror.position.set(this.eye.x, 2 * level - this.eye.y, this.eye.z);
    mirror.up.set(this.up.x, -this.up.y, this.up.z);
    mirror.lookAt(this.forward.x, 2 * level - this.forward.y, this.forward.z);
    mirror.far = camera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    this.reflectionMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.reflectionMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Projeção oblíqua (Lengyel): o near plane passa a ser a superfície da água.
    this.up.set(0, 1, 0);
    this.clipPlane.set(this.up, -level).applyMatrix4(mirror.matrixWorldInverse);
    this.clip.set(this.clipPlane.normal.x, this.clipPlane.normal.y, this.clipPlane.normal.z, this.clipPlane.constant);
    const e = mirror.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clip.x) + (e[8] ?? 0)) / (e[0] ?? 1),
      (Math.sign(this.clip.y) + (e[9] ?? 0)) / (e[5] ?? 1),
      -1,
      (1 + (e[10] ?? 0)) / (e[14] ?? 1),
    );
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x;
    e[6] = this.clip.y;
    e[10] = this.clip.z + 1;
    e[14] = this.clip.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    const previousTarget = renderer.getRenderTarget();
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;
    const previousXr = renderer.xr.enabled;
    this.mesh.visible = false;
    renderer.xr.enabled = false;
    // Só reaproveita as sombras do frame anterior se todas já existem: depois de uma troca de
    // preset o shadow map é recriado, e um sampler2DShadow sem textura de profundidade dá 1282.
    this.shadowMapsMissing = false;
    scene.traverseVisible(this.checkShadowMap);
    if (!this.shadowMapsMissing) renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, mirror);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.shadowMap.autoUpdate = previousShadowUpdate;
      renderer.xr.enabled = previousXr;
      this.mesh.visible = true;
    }
    strength.value = 0.85;
  }

  dispose(): void {
    (this.mesh.material.uniforms['uDepthMap']?.value as DataTexture | undefined)?.dispose();
    this.reflectionTarget?.dispose();
    this.reflectionTarget = null;
  }
}
