/**
 * Coordena os visuais da pesca: vara 3D com flexão vinda da RodPhysics (alimentada pela
 * tensão da sessão), molinete girando com o recolhimento, linha Verlet assentando na água,
 * isca/anzol seguindo o estado do jogo e ondulações na água via callback addRipple.
 */
import { Group, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { GameState } from '../../core/stateMachine.ts';
import type { SpeciesId } from '../../fish/species.ts';
import { LAKE } from '../../world/layout.ts';
import { DEFAULT_CAST_CONFIG, trajectoryAt, type CastResult } from '../cast.ts';
import { LINE_SPECS } from '../linePhysics.ts';
import { DEFAULT_ROD_CONFIG, RodPhysics } from '../rodPhysics.ts';
import { LineRenderer } from './lineRenderer.ts';
import { RodModel } from './rodModel.ts';

export interface VisualsFrame {
  readonly state: GameState;
  readonly chargePower: number;
  readonly cast: CastResult | null;
  readonly flightElapsedMs: number;
  readonly lineDistanceM: number | null;
  readonly tension: number;
  readonly caughtSpecies: SpeciesId | null;
}

type AddRipple = (x: number, z: number, strength: number) => void;

const UP = new Vector3(0, 1, 0);
/** Ângulo de repouso do blank acima da horizontal. */
const ROD_BASE_ANGLE_RAD = 0.55;
/** Offset da base da vara em relação à câmera: direita, abaixo e à frente. */
const ROD_OFFSET = { right: 0.32, down: 0.52, forward: 0.4 } as const;
/** Raio efetivo do carretel para converter metros recolhidos em giro (rad). */
const SPOOL_RADIUS_M = 0.03;
/** Intervalo entre ondulações do rastro da isca durante a briga. */
const WAKE_INTERVAL_S = 0.25;
const WATER_Y = LAKE.waterLevel;

export class FishingVisuals {
  private readonly rodModel = new RodModel(DEFAULT_ROD_CONFIG.segments, ROD_BASE_ANGLE_RAD);
  private readonly rodSim = new RodPhysics();
  private readonly line: LineRenderer;
  private readonly root = new Group();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly tip = new Vector3();
  private readonly lureAt = new Vector3();
  private readonly castOrigin = new Vector3();
  private readonly castDir = new Vector3(0, 0, -1);
  private lastState: GameState | null = null;
  private prevLineOut: number | null = null;
  private wakeCooldownS = 0;
  private rodYaw: number | null = null;
  private rodYawVelocity = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly addRipple: AddRipple,
  ) {
    this.line = new LineRenderer({ x: 0, y: 2, z: 24 });
    this.root.add(this.rodModel.group, this.line.group);
    scene.add(this.root);
  }

  /** No menu a vara some; a cena continua a mesma. */
  setRodVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Um passo visual por frame; dt e elapsed em segundos, como no frame hook da cena. */
  update(frame: VisualsFrame, dt: number, elapsed: number): void {
    const dtMs = Math.min(100, Math.max(0, dt * 1000));
    if (frame.state === 'MENU' || frame.state === 'LOADING' || frame.state === 'BOOT') {
      this.lastState = frame.state;
      this.rodYaw = null;
      this.prevLineOut = null;
      return;
    }
    if (frame.state === 'PAUSED') return;

    // Vara presa à câmera (primeira pessoa), girando só no plano horizontal.
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.right.crossVectors(this.fwd, UP).normalize();
    this.rodModel.group.position
      .copy(this.camera.position)
      .addScaledVector(this.right, ROD_OFFSET.right)
      .addScaledVector(this.fwd, ROD_OFFSET.forward)
      .addScaledVector(UP, -ROD_OFFSET.down);
    const targetYaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    this.rodYaw ??= targetYaw;
    // Inércia lateral: o blank acompanha o olhar com uma pequena resposta amortecida.
    for (let time = dtMs / 1000; time > 0; time -= 1 / 120) {
      const step = Math.min(time, 1 / 120);
      const error = Math.atan2(Math.sin(targetYaw - this.rodYaw), Math.cos(targetYaw - this.rodYaw));
      this.rodYawVelocity += (90 * error - 18 * this.rodYawVelocity) * step;
      this.rodYaw += this.rodYawVelocity * step;
    }
    this.rodModel.group.rotation.set(0, this.rodYaw, 0);

    // Flexão por RodPhysics: tensão da sessão na briga, carga do arremesso em IDLE.
    const tensionN =
      frame.state === 'REELING'
        ? Math.max(0, Math.min(1, frame.tension)) * LINE_SPECS.mono020.breakingStrengthN
        : frame.state === 'IDLE'
          ? Math.max(0, Math.min(1, frame.chargePower)) * 6
          : frame.state === 'HOOKED'
            ? 2
            : 0;
    this.rodSim.setLineTension(tensionN);
    this.rodSim.update(dtMs);

    if (frame.state !== this.lastState) this.onStateChange(frame);

    // Giro do molinete proporcional à linha recolhida neste frame.
    const lineOut = frame.lineDistanceM;
    let spinRad = 0;
    if (frame.state === 'REELING' && lineOut !== null && this.prevLineOut !== null && this.prevLineOut > lineOut) {
      spinRad = (this.prevLineOut - lineOut) / SPOOL_RADIUS_M;
    }
    this.prevLineOut = lineOut;
    const casting = frame.state === 'CASTING' ? Math.exp(-frame.flightElapsedMs / 180) * 0.32 : 0;
    const lift = frame.state === 'IDLE' ? frame.chargePower * 0.32 : 0;
    const fightLift = frame.state === 'REELING' ? frame.tension * 0.2 : 0;
    this.rodModel.update(this.rodSim.points(ROD_BASE_ANGLE_RAD + lift + fightLift - casting), spinRad);
    this.rodModel.getTipWorld(this.tip);

    this.placeLure(frame, elapsed);

    // Rastro da isca na água durante a briga.
    if (frame.state === 'REELING') {
      this.wakeCooldownS -= dt;
      if (this.wakeCooldownS <= 0) {
        this.wakeCooldownS = WAKE_INTERVAL_S;
        this.addRipple(this.lureAt.x, this.lureAt.z, 0.12 + frame.tension * 0.25);
      }
    }

    const distance = this.tip.distanceTo(this.lureAt);
    const tautness = frame.state === 'REELING' ? Math.min(1, Math.max(0, frame.tension)) : frame.state === 'HOOKED' ? 0.7 : 0;
    const slackM = distance * (1.002 + (1 - tautness) * 0.035) + 0.12 * (1 - tautness);
    const resetLine = frame.state !== this.lastState && (frame.state === 'CASTING' || frame.state === 'IDLE' || frame.state === 'CAUGHT' || frame.state === 'ESCAPED');
    this.line.update(dtMs, this.tip, this.lureAt, slackM, resetLine);
    this.lastState = frame.state;
  }

  dispose(): void {
    this.rodModel.dispose();
    this.line.dispose();
    this.scene.remove(this.root);
  }

  /** Posição-alvo da isca no mundo, conforme o estado do jogo. */
  private placeLure(frame: VisualsFrame, elapsed: number): void {
    const cast = frame.cast;
    switch (frame.state) {
      case 'CASTING': {
        if (!cast) break;
        const t = trajectoryAt(cast, Math.max(0, frame.flightElapsedMs));
        const progress = Math.min(1, frame.flightElapsedMs / cast.flightMs);
        this.lureAt.copy(this.castOrigin).addScaledVector(this.castDir, t.x).setY(Math.max(WATER_Y, t.y + this.castOrigin.y * (1 - progress)));
        return;
      }
      case 'WAITING':
      case 'HOOKED': {
        if (!cast) break;
        const dip = frame.state === 'HOOKED' ? -0.06 + Math.sin(elapsed * 12) * 0.03 : Math.sin(elapsed * 2.5) * 0.02;
        this.lureAt.copy(this.castOrigin).addScaledVector(this.castDir, cast.distanceM).setY(WATER_Y + dip);
        return;
      }
      case 'REELING': {
        const d = frame.lineDistanceM ?? cast?.distanceM ?? 1;
        this.lureAt.copy(this.castOrigin).addScaledVector(this.castDir, Math.max(0.3, d)).setY(WATER_Y);
        const surge = Math.sin(elapsed * 2.1) * Math.min(0.6, d * 0.08) * frame.tension;
        this.lureAt.x += -this.castDir.z * surge;
        this.lureAt.z += this.castDir.x * surge;
        return;
      }
      default:
        break;
    }
    // Repouso (IDLE, CAUGHT, ESCAPED…): isca pendurada perto da ponteira.
    const sway = Math.sin(elapsed * 2.8) * 0.035;
    this.lureAt.set(this.tip.x + sway, Math.max(WATER_Y + 0.15, this.tip.y - 0.7), this.tip.z + Math.sin(elapsed * 2) * 0.025);
  }

  /** Transições: fixa origem/direção do arremesso e marca a água quando a isca cai. */
  private onStateChange(frame: VisualsFrame): void {
    if (frame.state === 'CASTING') {
      this.castOrigin.set(this.tip.x === 0 && this.tip.z === 0 ? this.camera.position.x : this.tip.x, 0, this.tip.z || this.camera.position.z);
      this.castOrigin.y = this.tip.y - DEFAULT_CAST_CONFIG.launchHeightM;
      this.castDir.copy(this.fwd);
    } else if (frame.state === 'WAITING' && this.lastState === 'CASTING' && frame.cast) {
      const s = Math.min(1, frame.cast.speedMps / 18);
      const lx = this.castOrigin.x + this.castDir.x * frame.cast.distanceM;
      const lz = this.castOrigin.z + this.castDir.z * frame.cast.distanceM;
      this.addRipple(lx, lz, 0.3 + s * 0.7);
    } else if (frame.state === 'CAUGHT' && frame.caughtSpecies !== null) {
      this.addRipple(this.lureAt.x, this.lureAt.z, 1);
    }
  }
}
