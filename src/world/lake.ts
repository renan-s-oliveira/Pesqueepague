import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector3, Vector4, type Fog } from 'three';
import { LAKE, SUN_DIRECTION } from './layout.ts';

export const MAX_RIPPLES = 4;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uDetail;
varying vec3 vWorldPos;
varying vec3 vNormal;

float wave(vec2 p, vec2 dir, float freq, float speed, float amp, inout vec2 grad) {
  float phase = dot(p, dir) * freq + uTime * speed;
  grad += dir * freq * amp * cos(phase);
  return amp * sin(phase);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 grad = vec2(0.0);
  float h = 0.0;
  h += wave(world.xz, normalize(vec2(1.0, 0.35)), 0.32, 0.9, 0.07, grad);
  h += wave(world.xz, normalize(vec2(-0.4, 1.0)), 0.55, 1.3, 0.04, grad);
  h += wave(world.xz, normalize(vec2(0.8, -0.6)), 1.4, 2.1, 0.015 * uDetail, grad);
  h += wave(world.xz, normalize(vec2(-0.9, -0.2)), 2.3, 2.7, 0.008 * uDetail, grad);
  world.y += h;
  vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec4 uRipples[${MAX_RIPPLES}];
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 n = vNormal;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    vec2 d = vWorldPos.xz - r.xy;
    float dist = length(d) + 1e-4;
    float front = age * 1.6;
    float ring = sin((dist - front) * 9.0) * exp(-abs(dist - front) * 1.5) * exp(-age * 0.9) * r.w;
    n.xz += (d / dist) * ring * 0.35;
  }
  n = normalize(n);

  vec3 toEye = cameraPosition - vWorldPos;
  float eyeDist = length(toEye);
  vec3 v = toEye / eyeDist;
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(r.y, 0.0, 1.0), 0.6));
  float sun = pow(max(dot(r, uSunDir), 0.0), 180.0);
  vec3 body = mix(uShallow, uDeep, clamp(eyeDist / 40.0, 0.0, 1.0));
  vec3 color = mix(body, sky, fresnel) + uSunColor * sun * 2.5;
  color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, eyeDist));
  gl_FragColor = vec4(color, 0.94);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface LakeColors {
  readonly skyTop: Color;
  readonly skyHorizon: Color;
  readonly sun: Color;
}

/** Lago com shader leve: ondas somadas, fresnel, reflexo aproximado do céu e ripples por uniform. */
export class Lake {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly ripples: Vector4[];
  private nextRipple = 0;

  constructor(colors: LakeColors, fog: Fog) {
    const size = LAKE.radius * 3;
    const geometry = new PlaneGeometry(size, size, 96, 96);
    geometry.rotateX(-Math.PI / 2);
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, 0, 0));
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDetail: { value: 1 },
        uSkyTop: { value: colors.skyTop },
        uSkyHorizon: { value: colors.skyHorizon },
        uDeep: { value: new Color(0x0f2f3a) },
        uShallow: { value: new Color(0x2f5f5a) },
        uSunDir: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z).normalize() },
        uSunColor: { value: colors.sun },
        uFogColor: { value: fog.color },
        uFogNear: { value: fog.near },
        uFogFar: { value: fog.far },
        uRipples: { value: this.ripples },
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

  /** Dispara uma ondulação circular a partir de (x, z) no instante `time` (segundos do relógio do jogo). */
  addRipple(x: number, z: number, strength: number, time: number): void {
    if (!(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(strength) && Number.isFinite(time))) return;
    if (strength <= 0) return;
    const slot = this.ripples[this.nextRipple];
    if (!slot) return;
    slot.set(x, z, time, Math.min(strength, 2));
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
  }

  update(elapsedSeconds: number): void {
    const uniform = this.mesh.material.uniforms['uTime'];
    if (uniform) uniform.value = elapsedSeconds;
  }
}
