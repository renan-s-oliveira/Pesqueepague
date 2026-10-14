import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { GameState } from '../../core/stateMachine.ts';
import { trajectoryAt, type CastResult } from '../cast.ts';
import type { SpeciesId } from '../../fish/species.ts';
import { disposeObject3D } from '../../world/dispose.ts';

const LINE_POINTS = 24;
const SWING_SECONDS = 0.35;

export interface VisualFrame {
  readonly state: GameState;
  readonly chargePower: number;
  readonly cast: CastResult | null;
  /** Tempo de voo decorrido (ms) no estado CASTING. */
  readonly flightElapsedMs: number;
  readonly lineDistanceM: number | null;
  readonly tension: number;
  readonly caughtSpecies: SpeciesId | null;
}

export type RippleSink = (x: number, z: number, strength: number) => void;

const SPECIES_LOOK: Readonly<Record<SpeciesId, { color: number; belly: number; length: number; height: number }>> = {
  lambari: { color: 0xc9d4dc, belly: 0xf2f2e6, length: 0.22, height: 0.07 },
  tilapia: { color: 0x6f7f6a, belly: 0xd8d2b4, length: 0.4, height: 0.18 },
  tucunare: { color: 0xc9a63a, belly: 0xe8d9a0, length: 0.55, height: 0.16 },
};

function buildFish(id: SpeciesId): Group {
  const look = SPECIES_LOOK[id];
  const g = new Group();
  const body = new Mesh(new SphereGeometry(0.5, 20, 14), new MeshStandardMaterial({ color: look.color, roughness: 0.45, metalness: 0.2 }));
  body.scale.set(look.length, look.height, look.height * 0.45);
  const belly = new Mesh(new SphereGeometry(0.5, 16, 10), new MeshStandardMaterial({ color: look.belly, roughness: 0.6 }));
  belly.scale.set(look.length * 0.8, look.height * 0.6, look.height * 0.4);
  belly.position.y = -look.height * 0.15;
  const tail = new Mesh(new ConeGeometry(look.height * 0.5, look.length * 0.35, 4), new MeshStandardMaterial({ color: look.color }));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -look.length * 0.6;
  g.add(body, belly, tail);
  if (id === 'tucunare') {
    const spot = new Mesh(new SphereGeometry(0.5, 10, 8), new MeshStandardMaterial({ color: 0x1a1a1a }));
    spot.scale.set(look.height * 0.25, look.height * 0.25, look.height * 0.5);
    spot.position.set(-look.length * 0.35, 0, 0);
    g.add(spot);
  }
  g.visible = false;
  return g;
}

/** Vara em primeira pessoa, linha, boia e peixe da captura. O update não aloca objetos. */
export class FishingVisuals {
  private readonly rod = new Group();
  private readonly rodTip = new Group();
  private readonly bobber: Group;
  private readonly line: Line;
  private readonly linePositions = new Float32Array(LINE_POINTS * 3);
  private readonly lineAttr: BufferAttribute;
  private readonly fish: Readonly<Record<SpeciesId, Group>>;
  private readonly world = new Group();
  private readonly tipWorld = new Vector3();
  private readonly bobberPos = new Vector3();
  private readonly origin = new Vector3();
  private readonly dir = new Vector3();
  private swing = 0;
  private lastState: GameState = 'BOOT';

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly ripple: RippleSink,
  ) {
    const wood = new MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.7 });
    const blank = new Mesh(new CylinderGeometry(0.008, 0.02, 1.6, 8), wood);
    blank.position.y = 0.8;
    const handle = new Mesh(new CylinderGeometry(0.028, 0.028, 0.3, 10), new MeshStandardMaterial({ color: 0x222222 }));
    handle.position.y = 0.1;
    this.rodTip.position.y = 1.6;
    this.rod.add(blank, handle, this.rodTip);
    this.rod.position.set(0.32, -0.42, -0.55);
    this.rod.rotation.set(-0.9, 0, -0.15);
    camera.add(this.rod);

    this.bobber = new Group();
    const top = new Mesh(new SphereGeometry(0.06, 12, 8), new MeshStandardMaterial({ color: 0xd8262b }));
    const bottom = new Mesh(new SphereGeometry(0.06, 12, 8), new MeshStandardMaterial({ color: 0xf5f5f5 }));
    top.position.y = 0.04;
    bottom.position.y = -0.03;
    this.bobber.add(top, bottom);
    this.bobber.visible = false;

    const geo = new BufferGeometry();
    this.lineAttr = new BufferAttribute(this.linePositions, 3);
    geo.setAttribute('position', this.lineAttr);
    this.line = new Line(geo, new LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.line.visible = false;

    this.fish = { lambari: buildFish('lambari'), tilapia: buildFish('tilapia'), tucunare: buildFish('tucunare') };
    for (const f of Object.values(this.fish)) {
      f.position.set(0, -0.05, -0.9);
      camera.add(f);
    }
    this.world.add(this.bobber, this.line);
    scene.add(this.world);
  }

  setRodVisible(visible: boolean): void {
    this.rod.visible = visible;
  }

  update(f: VisualFrame, dt: number, elapsed: number): void {
    const s = f.state;
    if (s === 'PAUSED') return;
    if (s !== this.lastState) {
      if (s === 'CASTING') {
        this.swing = SWING_SECONDS;
        this.origin.copy(this.camera.position);
        this.camera.getWorldDirection(this.dir);
        this.dir.y = 0;
        this.dir.normalize();
      }
      if (s === 'WAITING' || s === 'HOOKED') this.ripple(this.bobberPos.x, this.bobberPos.z, s === 'HOOKED' ? 1 : 0.6);
      this.lastState = s;
    }

    // Vara: puxa para trás com a carga e balança para frente no arremesso.
    this.swing = Math.max(0, this.swing - dt);
    const back = s === 'IDLE' ? f.chargePower * 0.7 : 0;
    const forward = this.swing > 0 ? Math.sin((1 - this.swing / SWING_SECONDS) * Math.PI) * 0.6 : 0;
    const bend = s === 'REELING' ? f.tension * 0.35 : 0;
    this.rod.rotation.x = -0.9 + back - forward - bend;

    const lureOut = (s === 'CASTING' || s === 'WAITING' || s === 'HOOKED' || s === 'REELING') && f.cast !== null;
    this.bobber.visible = lureOut;
    this.line.visible = lureOut;
    if (lureOut && f.cast) {
      let dist = f.cast.distanceM;
      let y = 0.02 + Math.sin(elapsed * 2.2) * 0.015;
      if (s === 'CASTING') {
        const p = trajectoryAt(f.cast, f.flightElapsedMs);
        dist = p.x;
        y = p.y;
      } else if (s === 'HOOKED') {
        y = -0.05 + Math.sin(elapsed * 25) * 0.03;
      } else if (s === 'REELING') {
        dist = f.lineDistanceM ?? dist;
        y = Math.sin(elapsed * 18) * 0.02 * (0.5 + f.tension);
      }
      this.bobberPos.set(this.origin.x + this.dir.x * dist, y, this.origin.z + this.dir.z * dist);
      this.bobber.position.copy(this.bobberPos);
      this.updateLine(s === 'REELING' ? 0.05 : 0.6);
    }

    for (const id in this.fish) {
      const fishGroup = this.fish[id as SpeciesId];
      const show = (s === 'CAUGHT') && f.caughtSpecies === id;
      fishGroup.visible = show;
      if (show) {
        fishGroup.rotation.y = elapsed * 0.8;
        fishGroup.rotation.z = Math.sin(elapsed * 6) * 0.15;
      }
    }
  }

  dispose(): void {
    this.camera.remove(this.rod);
    for (const g of Object.values(this.fish)) this.camera.remove(g);
    this.scene.remove(this.world);
    disposeObject3D(this.rod);
    disposeObject3D(this.world);
    for (const g of Object.values(this.fish)) disposeObject3D(g);
  }

  /** Curva quadrática da ponta da vara até a boia, com barriga proporcional à folga. */
  private updateLine(sag: number): void {
    this.rodTip.getWorldPosition(this.tipWorld);
    const a = this.tipWorld;
    const b = this.bobberPos;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const my = Math.min(a.y, b.y) - sag;
    const p = this.linePositions;
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1);
      const u = 1 - t;
      p[i * 3] = u * u * a.x + 2 * u * t * mx + t * t * b.x;
      p[i * 3 + 1] = u * u * a.y + 2 * u * t * my + t * t * b.y;
      p[i * 3 + 2] = u * u * a.z + 2 * u * t * mz + t * t * b.z;
    }
    this.lineAttr.needsUpdate = true;
  }
}
