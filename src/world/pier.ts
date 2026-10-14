import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial, Object3D, type Texture } from 'three';
import { PIER } from './layout.ts';

const PLANK_DEPTH = 0.3;
const PLANK_GAP = 0.04;
const POST_SPACING = 2;

/** Píer de madeira: tábuas e estacas instanciadas, com textura de madeira (procedural quando não há arquivo). */
export function createPier(woodTexture: Texture): Group {
  const group = new Group();
  group.name = 'pier';
  const material = new MeshStandardMaterial({ map: woodTexture, roughness: 0.85, color: 0xb08860 });
  const dummy = new Object3D();

  const length = PIER.zShore - PIER.zEnd;
  const plankCount = Math.floor(length / (PLANK_DEPTH + PLANK_GAP));
  const planks = new InstancedMesh(new BoxGeometry(PIER.halfWidth * 2, 0.08, PLANK_DEPTH), material, plankCount);
  for (let i = 0; i < plankCount; i++) {
    const wobble = ((i * 7) % 5) * 0.004;
    dummy.position.set(PIER.x, PIER.deckY + wobble, PIER.zEnd + PLANK_DEPTH / 2 + i * (PLANK_DEPTH + PLANK_GAP));
    dummy.rotation.set(0, ((i * 13) % 7 - 3) * 0.004, 0);
    dummy.updateMatrix();
    planks.setMatrixAt(i, dummy.matrix);
  }
  planks.castShadow = true;
  planks.receiveShadow = true;
  planks.name = 'pier-planks';

  const postRows = Math.floor(length / POST_SPACING) + 1;
  const postHeight = PIER.deckY + 3.5;
  const posts = new InstancedMesh(new CylinderGeometry(0.12, 0.14, postHeight, 8), material, postRows * 2);
  for (let row = 0; row < postRows; row++) {
    for (let side = 0; side < 2; side++) {
      const x = PIER.x + (side === 0 ? -1 : 1) * (PIER.halfWidth - 0.1);
      dummy.position.set(x, PIER.deckY + 0.15 - postHeight / 2, PIER.zEnd + 0.2 + row * POST_SPACING);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(row * 2 + side, dummy.matrix);
    }
  }
  posts.castShadow = true;
  posts.name = 'pier-posts';

  planks.computeBoundingSphere();
  posts.computeBoundingSphere();
  group.add(planks, posts);
  return group;
}
