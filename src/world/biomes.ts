import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Rng } from '../utils/rng.ts';
import type { LakeId } from './lakes.ts';

/** Árvores de serra e raízes de igapó; geometria compartilhada entre exemplares. */
export class LakeBiomes {
  readonly group = new Group();
  private readonly highlands = new Group();
  private readonly wetlands = new Group();
  constructor(seed: number) {
    const rng = new Rng((seed ^ 0x79a2) >>> 0);
    const trunk = new CylinderGeometry(.15, .28, 5, 6);
    const crown = new ConeGeometry(2.2, 6, 7);
    const wood = new MeshStandardMaterial({ color: '#5f5647', roughness: .95 });
    const green = new MeshStandardMaterial({ color: '#355b53', roughness: .9 });
    const root = new CylinderGeometry(.12, .25, 5, 6);
    for (let i = 0; i < 64; i++) {
      const angle = i / 64 * Math.PI * 2;
      const radius = rng.range(33, 48);
      if (Math.abs(Math.sin(angle)) < .15 && Math.cos(angle) > 0) continue;
      const tree = new Group();
      tree.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
      tree.scale.setScalar(rng.range(.8, 1.7));
      const stem = new Mesh(trunk, wood); stem.position.y = 2.5;
      tree.add(stem);
      for (let j = 0; j < 3; j++) { const top = new Mesh(crown, green); top.position.y = 4.5 + j * 1.7; top.scale.setScalar(1 - j * .18); tree.add(top); }
      this.highlands.add(tree);
    }
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      if (Math.cos(a) > .85) continue;
      const tree = new Group(); tree.position.set(Math.sin(a) * 28, 0, Math.cos(a) * 28);
      const stem = new Mesh(trunk, wood); stem.position.y = 3; tree.add(stem);
      for (let j = 0; j < 5; j++) {
        const leg = new Mesh(root, wood); const turn = j / 5 * Math.PI * 2;
        leg.position.set(Math.sin(turn) * .9, 1, Math.cos(turn) * .9);
        leg.rotation.set(Math.cos(turn) * .6, 0, Math.sin(turn) * .6); tree.add(leg);
      }
      const top = new Mesh(new ConeGeometry(4, 4, 9), green); top.position.y = 6; tree.add(top);
      this.wetlands.add(tree);
    }
    this.group.add(this.highlands, this.wetlands);
    this.setLake('tropical');
  }
  setLake(id: LakeId): void { this.highlands.visible = id === 'serra'; this.wetlands.visible = id === 'igapo'; }
}
