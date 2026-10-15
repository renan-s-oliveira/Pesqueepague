import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3, type Camera } from 'three';
import { SUN_DIRECTION } from './layout.ts';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uDaylight;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 color = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uGround, clamp(-h * 4.0, 0.0, 1.0));
  float clearSky = 1.0 - uCloudCover;
  float sunUp = smoothstep(-0.08, 0.05, uSunDir.y);
  float sd = max(dot(d, uSunDir), 0.0);
  color += uSunColor * (pow(sd, 900.0) * 4.0 + pow(sd, 8.0) * 0.25) * sunUp * (0.3 + 0.7 * clearSky);
  float md = max(dot(d, uMoonDir), 0.0);
  float moonUp = smoothstep(-0.05, 0.05, uMoonDir.y) * (1.0 - uDaylight);
  color += vec3(0.75, 0.8, 0.9) * (smoothstep(0.9993, 0.9996, md) * 0.9 + pow(md, 32.0) * 0.08) * moonUp;
  if (h > 0.0) {
    vec2 cell = floor(d.xz / (h + 0.3) * 260.0);
    float star = step(0.9975, hash(cell)) * (1.0 - uDaylight) * clearSky * smoothstep(0.05, 0.3, h);
    color += vec3(star * 0.8);
  }
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.15) * 1.4 + uCloudOffset;
    float threshold = mix(0.72, 0.32, uCloudCover);
    float cloud = smoothstep(threshold, threshold + 0.28, fbm(uv));
    vec3 lit = mix(vec3(0.93, 0.88, 0.85), uSunColor * 1.15, pow(sd, 3.0) * 0.6 * sunUp);
    vec3 overcast = mix(vec3(0.42, 0.45, 0.5), lit, clearSky);
    vec3 cloudColor = overcast * mix(0.18, 1.0, uDaylight);
    color = mix(color, cloudColor, cloud * smoothstep(0.02, 0.25, h) * mix(0.85, 0.97, uCloudCover));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Cores vivas do céu, compartilhadas por referência com a água (o reflexo acompanha a hora).
 * Começam no fim de tarde e são atualizadas no lugar por Sky.setAtmosphere.
 */
export const SKY_COLORS = {
  top: new Color(0x3d6fa8),
  horizon: new Color(0xf2b37a),
  ground: new Color(0x5a4a3c),
  sun: new Color(0xffc27a),
} as const;

export interface SkyAtmosphere {
  readonly sunDirection: Vector3;
  readonly moonDirection: Vector3;
  readonly daylight: number;
  readonly cloudCover: number;
}

/** Domo de céu físico simplificado: gradiente por hora, sol, lua, estrelas e nuvens levadas pelo vento. */
export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly cloudOffset = new Vector2();

  constructor(radius = 450) {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: SKY_COLORS.top },
        uHorizon: { value: SKY_COLORS.horizon },
        uGround: { value: SKY_COLORS.ground },
        uSunDir: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize() },
        uSunColor: { value: SKY_COLORS.sun },
        uMoonDir: { value: new Vector3(0, -1, 0) },
        uDaylight: { value: 1 },
        uCloudCover: { value: 0.3 },
        uCloudOffset: { value: this.cloudOffset },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Copia direções e parâmetros para os uniforms (sem alocar). As cores vêm de SKY_COLORS. */
  setAtmosphere(state: SkyAtmosphere): void {
    const u = this.mesh.material.uniforms;
    (u['uSunDir']?.value as Vector3 | undefined)?.copy(state.sunDirection);
    (u['uMoonDir']?.value as Vector3 | undefined)?.copy(state.moonDirection);
    if (u['uDaylight']) u['uDaylight'].value = state.daylight;
    if (u['uCloudCover']) u['uCloudCover'].value = state.cloudCover;
  }

  /** Nuvens derivam com o vento (m/s) numa escala de céu distante. */
  update(deltaSeconds: number, camera: Camera, windX = 0, windZ = 0): void {
    this.mesh.position.copy(camera.position);
    this.cloudOffset.x += (0.006 + windX * 0.004) * deltaSeconds;
    this.cloudOffset.y += (0.0025 + windZ * 0.004) * deltaSeconds;
  }
}
