import { BufferAttribute, Color, Mesh, MeshStandardMaterial, PlaneGeometry, type Texture } from 'three';
import { Rng } from '../utils/rng.ts';
import { LAKE, PIER, TERRAIN, distanceToLakeCenter, isOnPier } from './layout.ts';
import { createNoise2D, fbm, smoothstep } from './noise.ts';

export type HeightField = (x: number, z: number) => number;

export interface Terrain {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  readonly heightAt: HeightField;
}

/**
 * Altura procedural: bacia do lago, margem com largura irregular, morros ondulados no meio
 * da distância e anel de montanhas ao fundo. O interior do lago não muda com a irregularidade.
 */
export function createHeightField(rng: Rng): HeightField {
  const noise = createNoise2D(rng);
  const r = LAKE.radius;
  return (x, z) => {
    const d = distanceToLakeCenter(x, z);
    const wobble = fbm(noise, x * 0.045 + 11, z * 0.045 - 5, 3);
    const shore = smoothstep(r * 0.85, r * (1.25 + wobble * 0.18), d);
    const hills = (fbm(noise, x * 0.03, z * 0.03, 4) * 0.5 + 0.5) * 1.6 + 0.3;
    const rolling = fbm(noise, x * 0.02 - 9, z * 0.02 + 23, 4) * 0.5 + 0.5;
    const backHills = smoothstep(45, 95, d) * rolling * rolling * 10;
    const ridge = fbm(noise, x * 0.012 + 40, z * 0.012 - 17, 5) * 0.5 + 0.5;
    const mountains = smoothstep(70, 150, d) * (12 + ridge * 48);
    let h = -3 + shore * 3 + shore * hills + backHills + mountains;
    if (isOnPier(x, z, 1.5)) h = Math.min(h, PIER.deckY - 0.35);
    return h;
  };
}

/** Cores-base (albedo médio) de cada camada do splat; o detalhe da textura modula cada uma. */
const SPLAT_COLORS = {
  sand: new Color(0xc9b28a),
  dirt: new Color(0x6e5338),
  grass: new Color(0x5d7a3a),
  rock: new Color(0x7a736c),
} as const;

/**
 * Terreno com splat PBR procedural: cada vértice carrega o peso de areia, terra, grama e pedra
 * (por altura, inclinação e manchas de ruído). O fragment shader mistura as camadas com o detalhe
 * amostrado em duas escalas, para não haver repetição evidente, e ajusta a rugosidade por camada.
 */
export function createTerrain(rng: Rng, detail: Texture): Terrain {
  const heightAt = createHeightField(rng);
  const patches = createNoise2D(new Rng((rng.getState() ^ 0x9e3779b9) >>> 0));
  const geometry = new PlaneGeometry(TERRAIN.size, TERRAIN.size, TERRAIN.segments, TERRAIN.segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  const normal = geometry.getAttribute('normal');
  const splat = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const patch = fbm(patches, x * 0.06, z * 0.06, 3) * 0.5 + 0.5;
    const rock = Math.min(1, smoothstep(0.86, 0.62, normal.getY(i)) + smoothstep(28, 48, y) * 0.6);
    const sand = smoothstep(0.9, -0.3, y + patch * 0.6) * (1 - rock);
    const dirt = smoothstep(0.45, 0.75, patch) * (1 - sand) * (1 - rock) * (0.55 + smoothstep(6, 20, y) * 0.45);
    const grass = Math.max(0, 1 - sand - dirt - rock);
    splat[i * 4] = sand;
    splat[i * 4 + 1] = dirt;
    splat[i * 4 + 2] = grass;
    splat[i * 4 + 3] = rock;
  }
  geometry.setAttribute('splat', new BufferAttribute(splat, 4));

  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uSand = { value: SPLAT_COLORS.sand };
    shader.uniforms.uDirt = { value: SPLAT_COLORS.dirt };
    shader.uniforms.uGrass = { value: SPLAT_COLORS.grass };
    shader.uniforms.uRock = { value: SPLAT_COLORS.rock };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vGroundUv;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvGroundUv = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform sampler2D uDetail;',
          'uniform vec3 uSand;',
          'uniform vec3 uDirt;',
          'uniform vec3 uGrass;',
          'uniform vec3 uRock;',
          'varying vec4 vSplat;',
          'varying vec2 vGroundUv;',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          'vec3 detailNear = texture2D(uDetail, vGroundUv * 0.23).rgb;',
          'vec3 detailFar = texture2D(uDetail, vGroundUv.yx * 0.029 + 0.37).rgb;',
          'vec3 groundDetail = mix(detailNear, detailFar, 0.45);',
          'vec4 splatW = vSplat / max(dot(vSplat, vec4(1.0)), 1e-4);',
          'vec3 groundAlbedo = uSand * (0.78 + 0.44 * groundDetail.r) * splatW.x',
          '  + uDirt * (0.7 + 0.6 * groundDetail.g) * splatW.y',
          '  + uGrass * (0.62 + 0.76 * groundDetail.g) * splatW.z',
          '  + uRock * (0.55 + 0.9 * groundDetail.b) * splatW.w;',
          'diffuseColor.rgb *= groundAlbedo;',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness * dot(splatW, vec4(0.92, 0.97, 0.88, 0.72 + 0.2 * groundDetail.b));',
      );
  };
  material.customProgramCacheKey = () => 'terrain-splat-v1';

  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return { mesh, heightAt };
}
