import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera } from 'three';
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
uniform float uTime;
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
  float sd = max(dot(d, uSunDir), 0.0);
  color += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 8.0) * 0.3);
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.15) * 1.4 + vec2(uTime * 0.012, uTime * 0.005);
    float cloud = smoothstep(0.5, 0.78, fbm(uv));
    vec3 cloudColor = mix(vec3(0.93, 0.84, 0.8), uSunColor * 1.3, pow(sd, 3.0) * 0.7);
    color = mix(color, cloudColor, cloud * smoothstep(0.02, 0.25, h) * 0.85);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Cores do fim de tarde, compartilhadas com a água para o reflexo bater com o céu. */
export const SKY_COLORS = {
  top: new Color(0x3d6fa8),
  horizon: new Color(0xf2b37a),
  ground: new Color(0x5a4a3c),
  sun: new Color(0xffc27a),
} as const;

/** Domo de céu com gradiente, sol e nuvens procedurais; acompanha a câmera. */
export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

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
        uTime: { value: 0 },
      },
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  update(elapsedSeconds: number, camera: Camera): void {
    this.mesh.position.copy(camera.position);
    const uniform = this.mesh.material.uniforms['uTime'];
    if (uniform) uniform.value = elapsedSeconds;
  }
}
