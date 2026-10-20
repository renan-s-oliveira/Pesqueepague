/**
 * Renderização da linha de pesca: uma VerletLine (catenária que assenta na água) presa
 * na ponteira e na isca, desenhada como THREE.Line com buffer fixo, mais a isca (boia)
 * e o anzol pendurado abaixo dela.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  CatmullRomCurve3,
  Vector3,
} from 'three';
import { disposeObject3D } from '../../world/dispose.ts';
import { DEFAULT_LINE_CONFIG, LINE_SPECS, VerletLine, type Vec3 } from '../linePhysics.ts';

const HOOK_DROP_M = 0.09;

export class LineRenderer {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly verlet: VerletLine;
  private readonly lure: Mesh;
  private readonly hook: Mesh;
  private readonly curve = new CatmullRomCurve3(Array.from({ length: DEFAULT_LINE_CONFIG.points }, () => new Vector3()));
  private readonly sample = new Vector3();

  constructor(start: Vec3) {
    this.positions = new Float32Array(96 * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    const line = new Line(this.geometry, new LineBasicMaterial({ color: 0xf4f1e8, transparent: true, opacity: 0.8 }));
    line.frustumCulled = false;
    this.verlet = new VerletLine(LINE_SPECS.mono020, 1, start, { x: start.x, y: Math.max(0.1, start.y - 0.8), z: start.z });
    this.lure = new Mesh(new SphereGeometry(0.045, 10, 8), new MeshStandardMaterial({ color: 0xe8543c, roughness: 0.4 }));
    this.hook = new Mesh(
      new TorusGeometry(0.022, 0.004, 5, 10, Math.PI * 1.45),
      new MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.3, metalness: 0.85 }),
    );
    this.group.add(line, this.lure, this.hook);
  }

  /** Avança a física da linha com as âncoras do frame e copia os pontos para o buffer da GPU. */
  update(dtMs: number, tip: Vec3, lureAt: Vec3, lengthM: number, reset = false): void {
    if (reset) this.verlet.reset(tip, lureAt, Math.max(DEFAULT_LINE_CONFIG.minLengthM, lengthM));
    this.verlet.setAnchors(tip, lureAt);
    this.verlet.setLength(Math.max(DEFAULT_LINE_CONFIG.minLengthM, lengthM));
    this.verlet.update(dtMs);
    const pts = this.verlet.points();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      this.curve.points[i]!.set(p.x, p.y, p.z);
    }
    for (let i = 0; i < 96; i++) {
      this.curve.getPoint(i / 95, this.sample);
      this.positions[i * 3] = this.sample.x;
      this.positions[i * 3 + 1] = this.sample.y;
      this.positions[i * 3 + 2] = this.sample.z;
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.lure.position.set(lureAt.x, lureAt.y, lureAt.z);
    this.hook.position.set(lureAt.x, lureAt.y - HOOK_DROP_M, lureAt.z);
  }

  dispose(): void {
    disposeObject3D(this.group);
    this.group.removeFromParent();
  }
}
