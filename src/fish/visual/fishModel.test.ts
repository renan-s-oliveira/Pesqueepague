import { describe, expect, it } from 'vitest';
import { Mesh, Texture, type BufferGeometry, type Material, type MeshPhysicalMaterial } from 'three';
import { SPECIES_IDS } from '../species.ts';
import {
  FISH_LODS,
  FishModel,
  JAW_BONE,
  OPERCLE_LEFT_BONE,
  OPERCLE_RIGHT_BONE,
  SPINE_BONES,
  bodyTriangleCount,
  seedFromCatchRecord,
} from './fishModel.ts';
import { cachedFishTextureCount, generateFishTexturePixels } from './fishTextures.ts';

function positions(model: FishModel, lod = 0): number[] {
  return Array.from(model.bodies[lod]?.geometry.getAttribute('position').array ?? []);
}

describe('FishModel', () => {
  it('gera a mesma malha para a mesma semente e outra para semente diferente', () => {
    const a = new FishModel('tilapia', { seed: 42 });
    const b = new FishModel('tilapia', { seed: 42 });
    const c = new FishModel('tilapia', { seed: 43 });
    expect(positions(a)).toEqual(positions(b));
    expect(positions(a)).not.toEqual(positions(c));
    const tint = (m: FishModel): number[] => (m.bodies[0]?.material as MeshPhysicalMaterial).color.toArray();
    expect(tint(a)).toEqual(tint(b));
    for (const m of [a, b, c]) m.dispose();
  });

  it('gera texturas determinísticas por espécie', () => {
    const a = generateFishTexturePixels('tucunare', 64, 32);
    const b = generateFishTexturePixels('tucunare', 64, 32);
    const c = generateFishTexturePixels('lambari', 64, 32);
    expect(a.albedo).toEqual(b.albedo);
    expect(a.normal).toEqual(b.normal);
    expect(a.albedo).not.toEqual(c.albedo);
  });

  it('a semente da captura vem do id e é estável', () => {
    expect(seedFromCatchRecord({ id: 'abc' })).toBe(seedFromCatchRecord({ id: 'abc' }));
    expect(seedFromCatchRecord({ id: 'abc' })).not.toBe(seedFromCatchRecord({ id: 'abd' }));
  });

  it('tem coluna, mandíbula e opérculos no esqueleto, com o corpo em SkinnedMesh', () => {
    const m = new FishModel('lambari', { seed: 1 });
    const names = m.skeleton.bones.map((b) => b.name);
    expect(names.filter((n) => n.startsWith('spine_'))).toHaveLength(SPINE_BONES);
    expect(names).toEqual(expect.arrayContaining([JAW_BONE, OPERCLE_LEFT_BONE, OPERCLE_RIGHT_BONE]));
    for (const body of m.bodies) {
      expect(body.isSkinnedMesh).toBe(true);
      expect(body.skeleton).toBe(m.skeleton);
      expect(body.geometry.getAttribute('skinIndex').itemSize).toBe(4);
      const w = body.geometry.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i++) {
        expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
      }
    }
    m.animate(1.3, 1);
    expect(m.skeleton.bones.find((b) => b.name === JAW_BONE)?.rotation.z).not.toBe(0);
    m.dispose();
  });

  it('conta os triângulos de cada nível de LOD', () => {
    const m = new FishModel('tucunare', { seed: 7 });
    expect(m.lod.levels).toHaveLength(2);
    FISH_LODS.forEach((level, i) => {
      const tris = (m.bodies[i]?.geometry.index?.count ?? 0) / 3;
      expect(tris).toBe(bodyTriangleCount(level));
    });
    expect(bodyTriangleCount(FISH_LODS[0])).toBeGreaterThan(4 * bodyTriangleCount(FISH_LODS[1]));
    m.dispose();
  });

  it('as três espécies têm proporções coerentes com a anatomia e malhas diferentes', () => {
    const p = Object.fromEntries(
      SPECIES_IDS.map((id) => {
        const m = new FishModel(id, { seed: 99, lengthM: 1 });
        const result = { proportions: m.proportions(), positions: positions(m) };
        m.dispose();
        return [id, result];
      }),
    );
    const lambari = p['lambari']!;
    const tilapia = p['tilapia']!;
    const tucunare = p['tucunare']!;
    // Tilápia é a mais alta; o tucunaré é o mais alongado e o mais roliço.
    expect(tilapia.proportions.depthRatio).toBeGreaterThan(lambari.proportions.depthRatio);
    expect(lambari.proportions.depthRatio).toBeGreaterThan(tucunare.proportions.depthRatio);
    expect(tucunare.proportions.widthRatio).toBeGreaterThan(lambari.proportions.widthRatio);
    expect(tucunare.proportions.widthRatio).toBeGreaterThan(tilapia.proportions.widthRatio);
    expect(lambari.positions).not.toEqual(tilapia.positions);
    expect(tilapia.positions).not.toEqual(tucunare.positions);
  });

  it('o estado molhado/seco muda o brilho da pele', () => {
    const m = new FishModel('lambari', { seed: 3 });
    const mat = m.bodies[0]?.material as Material & { clearcoat: number; roughness: number };
    m.setWetness(1);
    const wet = { cc: mat.clearcoat, r: mat.roughness };
    m.setWetness(0);
    expect(mat.clearcoat).toBeLessThan(wet.cc);
    expect(mat.roughness).toBeGreaterThan(wet.r);
    m.dispose();
  });

  it('dispose libera todas as geometrias e texturas', () => {
    const before = cachedFishTextureCount();
    const a = new FishModel('tilapia', { seed: 5 });
    const b = new FishModel('tilapia', { seed: 6 });
    const geometries = new Set<BufferGeometry>();
    const textures = new Set<Texture>();
    for (const model of [a, b]) {
      model.root.traverse((o) => {
        if (o instanceof Mesh) {
          geometries.add(o.geometry as BufferGeometry);
          for (const v of Object.values(o.material as Material)) if (v instanceof Texture) textures.add(v);
        }
      });
    }
    expect(textures.size).toBe(3);
    const freedGeo = new Set<BufferGeometry>();
    const freedTex = new Set<Texture>();
    for (const g of geometries) g.addEventListener('dispose', () => freedGeo.add(g));
    for (const t of textures) t.addEventListener('dispose', () => freedTex.add(t));

    a.dispose();
    expect(freedTex.size).toBe(0);
    b.dispose();
    b.dispose();
    expect(freedGeo.size).toBe(geometries.size);
    expect(freedTex.size).toBe(textures.size);
    expect(cachedFishTextureCount()).toBe(before);
  });
});
