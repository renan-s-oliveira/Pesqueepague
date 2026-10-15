/**
 * Modelo 3D da vara: blank afilado em segmentos que seguem os pontos da RodPhysics,
 * cabo de cortiça, molinete com carretel e manivela que giram no recolhimento e
 * passadores (guias) acompanhando a flexão. Sem alocação por frame no update.
 */
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { disposeObject3D } from '../../world/dispose.ts';
import type { RodPoint } from '../rodPhysics.ts';

const Y_AXIS = new Vector3(0, 1, 0);
const BUTT_RADIUS = 0.011;
const TIP_RADIUS = 0.0032;
const GUIDE_FRACTIONS = [0.35, 0.65, 0.9] as const;

/** Converte um ponto do plano da vara (x adiante, y para cima) para o espaço local do grupo. */
function planeToLocal(p: RodPoint, out: Vector3): Vector3 {
  return out.set(0, p.y, -p.x);
}

export class RodModel {
  readonly group = new Group();
  private readonly blankSegments: Mesh[] = [];
  private readonly guides: Mesh[] = [];
  private readonly reelSpool: Mesh;
  private readonly reelHandle: Group;
  private readonly tipLocal = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly dir = new Vector3();

  constructor(private readonly segmentCount: number, baseAngleRad: number) {
    const blankMat = new MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.45, metalness: 0.15 });
    const corkMat = new MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
    const reelMat = new MeshStandardMaterial({ color: 0x39414a, roughness: 0.35, metalness: 0.65 });
    const metalMat = new MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.3, metalness: 0.8 });

    for (let i = 0; i < segmentCount; i++) {
      const t0 = i / segmentCount;
      const t1 = (i + 1) / segmentCount;
      const rBottom = BUTT_RADIUS + (TIP_RADIUS - BUTT_RADIUS) * t0;
      const rTop = BUTT_RADIUS + (TIP_RADIUS - BUTT_RADIUS) * t1;
      const seg = new Mesh(new CylinderGeometry(rTop, rBottom, 1, 7), blankMat);
      seg.matrixAutoUpdate = true;
      this.blankSegments.push(seg);
      this.group.add(seg);
    }
    for (const f of GUIDE_FRACTIONS) {
      const r = BUTT_RADIUS * (1.6 - f);
      const guide = new Mesh(new TorusGeometry(Math.max(0.006, r), 0.0015, 5, 10), metalMat);
      this.guides.push(guide);
      this.group.add(guide);
    }

    // Cabo de cortiça atrás da origem, na direção oposta ao primeiro segmento.
    const back = new Vector3(0, -Math.sin(baseAngleRad), Math.cos(baseAngleRad)).normalize();
    const handle = new Mesh(new CylinderGeometry(0.014, 0.016, 0.34, 8), corkMat);
    handle.position.copy(back).multiplyScalar(0.14);
    handle.quaternion.setFromUnitVectors(Y_AXIS, back);
    this.group.add(handle);

    // Molinete: corpo preso abaixo do cabo, carretel e manivela que giram no recolhimento.
    const reel = new Group();
    reel.position.copy(back).multiplyScalar(0.04).add(new Vector3(0, -0.07, 0));
    const body = new Mesh(new CylinderGeometry(0.018, 0.018, 0.05, 10), reelMat);
    body.rotation.z = Math.PI / 2;
    this.reelSpool = new Mesh(new CylinderGeometry(0.032, 0.032, 0.03, 12), metalMat);
    this.reelSpool.rotation.z = Math.PI / 2;
    this.reelHandle = new Group();
    const arm = new Mesh(new CylinderGeometry(0.004, 0.004, 0.07, 6), reelMat);
    arm.position.y = 0.035;
    const knob = new Mesh(new SphereGeometry(0.009, 8, 6), metalMat);
    knob.position.y = 0.07;
    this.reelHandle.add(arm, knob);
    this.reelHandle.position.x = 0.035;
    reel.add(body, this.reelSpool, this.reelHandle);
    this.group.add(reel);
  }

  /**
   * Posiciona cada segmento do blank entre dois pontos da RodPhysics (do cabo à ponteira)
   * e gira o carretel/manivela pelo ângulo recolhido neste frame.
   */
  update(points: readonly RodPoint[], spinDeltaRad: number): void {
    const n = Math.min(this.segmentCount, points.length - 1);
    for (let i = 0; i < n; i++) {
      const seg = this.blankSegments[i]!;
      planeToLocal(points[i]!, this.a);
      planeToLocal(points[i + 1]!, this.b);
      this.dir.subVectors(this.b, this.a);
      const len = Math.max(1e-4, this.dir.length());
      seg.position.addVectors(this.a, this.b).multiplyScalar(0.5);
      seg.scale.set(1, len, 1);
      seg.quaternion.setFromUnitVectors(Y_AXIS, this.dir.normalize());
    }
    for (let g = 0; g < this.guides.length; g++) {
      const idx = Math.min(points.length - 1, Math.max(1, Math.round(GUIDE_FRACTIONS[g]! * (points.length - 1))));
      const guide = this.guides[g]!;
      planeToLocal(points[idx]!, guide.position);
      const seg = this.blankSegments[Math.min(idx, n) - 1];
      if (seg) guide.quaternion.copy(seg.quaternion);
    }
    planeToLocal(points[points.length - 1]!, this.tipLocal);
    if (Number.isFinite(spinDeltaRad)) {
      this.reelSpool.rotation.x += spinDeltaRad;
      this.reelHandle.rotation.x += spinDeltaRad * 1.6;
    }
  }

  /** Ponteira da vara em coordenadas de mundo, sem alocar. */
  getTipWorld(out: Vector3): Vector3 {
    out.copy(this.tipLocal);
    return this.group.localToWorld(out);
  }

  dispose(): void {
    disposeObject3D(this.group);
    this.group.removeFromParent();
  }
}
