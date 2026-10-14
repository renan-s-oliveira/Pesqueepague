import { BufferGeometry, InstancedMesh, Line, Mesh, Points, ShaderMaterial, Texture, type Material, type Object3D } from 'three';

/** Libera geometrias, materiais e texturas da árvore, cada recurso uma vez só (há muito compartilhamento). */
export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Points || object instanceof Line) {
      if (object.geometry instanceof BufferGeometry) geometries.add(object.geometry);
      const material: Material | Material[] = object.material;
      if (Array.isArray(material)) material.forEach((m) => materials.add(m));
      else materials.add(material);
    }
    if (object instanceof InstancedMesh) object.dispose();
  });

  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    if (material instanceof ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof Texture) textures.add(uniform.value);
      }
    }
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
}
