import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { FishAnimator, rigFromFishModel } from '../fish/visual/fishAnimator.ts';
import { FishModel } from '../fish/visual/fishModel.ts';
import type { CaughtFish } from '../gameplay/fishingSession.ts';
import { FishInspection } from './fishInspection.ts';
import { canvasToPhotoBlob } from './photo.ts';

export interface CatchPresentationHandlers {
  /** Fecha a apresentação e volta a pescar. */
  readonly onContinue: () => void;
  /** Recebe a foto tirada; rejeitar mostra o erro ao jogador sem fechar a tela. */
  readonly onPhoto: (blob: Blob) => Promise<void>;
}

/** Duração da aproximação cinematográfica da câmera, em ms. */
export const TRANSITION_MS = 1400;
/** Debate sutil: o clipe outOfWater rodando devagar. */
const STRUGGLE_SPEED_SCALE = 0.35;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

function button(text: string, testId: string, onClick: () => void, cls = 'ui-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Estúdio 3D da captura sobre o jogo: fundo desfocado (backdrop-filter sobre a cena ao vivo),
 * luz de três pontos (principal quente, preenchimento frio e contraluz), o MESMO exemplar —
 * FishModel com a semente e a cor do indivíduo, em estado seco — e FishAnimator em debate sutil.
 * A câmera chega em travelling suave; com prefers-reduced-motion ela já abre enquadrada.
 * Depois da transição, a inspeção por OrbitControls fica livre (giro 360° e zoom limitado).
 */
export class CatchPresentation {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly inspection: FishInspection;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly model: FishModel;
  private readonly animator: FishAnimator;
  private readonly detailsBtn: HTMLButtonElement;
  private readonly photoBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly reducedMotion: boolean;
  private raf = 0;
  private lastT: number | null = null;
  private transitionT: number;
  private disposed = false;

  constructor(
    container: HTMLElement,
    fish: CaughtFish,
    panel: HTMLElement,
    private readonly handlers: CatchPresentationHandlers,
  ) {
    this.reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.transitionT = this.reducedMotion ? 1 : 0;

    // O mesmo exemplar: semente e variação de cor do indivíduo, comprimento real, pele seca.
    const lengthM = Math.max(0.05, fish.individual.lengthCm / 100);
    this.model = new FishModel(fish.individual.speciesId, {
      seed: fish.individual.color.spotSeed >>> 0,
      lengthM,
      color: fish.individual.color,
    });
    this.model.setWetness(0);
    this.model.root.rotation.y = -0.45;
    this.scene.add(this.model.root);
    this.animator = new FishAnimator(rigFromFishModel(this.model), {
      seed: fish.individual.color.spotSeed >>> 0,
      initialState: 'outOfWater',
    });
    this.animator.setSpeedScale(STRUGGLE_SPEED_SCALE);

    // Luz de três pontos do estúdio.
    const key = new DirectionalLight(0xfff0d8, 2.4);
    key.position.set(1.6, 2.2, 2.4);
    const fill = new DirectionalLight(0xbcd7ff, 0.9);
    fill.position.set(-2.2, 0.6, 1.4);
    const rim = new DirectionalLight(0xffffff, 1.8);
    rim.position.set(-0.4, 1.6, -2.6);
    this.scene.add(key, fill, rim, new AmbientLight(0x404a52, 0.6));

    this.camera = new PerspectiveCamera(35, 1, 0.01, 50);
    this.setCameraAt(this.transitionT, lengthM);

    // DOM: canvas transparente sobre o jogo desfocado, painel da ficha e ações.
    this.root = document.createElement('section');
    this.root.className = 'capture-screen';
    this.root.dataset['testid'] = 'catch-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Peixe capturado');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'capture-canvas';
    this.canvas.setAttribute('aria-label', 'Exemplar capturado em 3D; arraste para girar, role para aproximar');
    this.status = document.createElement('p');
    this.status.className = 'capture-status';
    this.status.dataset['testid'] = 'capture-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'capture-actions';
    this.detailsBtn = button('Ver detalhes', 'capture-details', () => this.toggleDetails());
    this.detailsBtn.setAttribute('aria-pressed', 'false');
    this.photoBtn = button('Tirar foto', 'capture-photo', () => void this.takePhoto());
    const continueBtn = button('Continuar pescando', 'result-continue', () => handlers.onContinue(), 'ui-btn primary');
    actions.append(this.detailsBtn, this.photoBtn, continueBtn);
    this.root.append(this.canvas, panel, actions, this.status);
    container.appendChild(this.root);

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.inspection = new FishInspection(this.camera, this.canvas, { target: new Vector3(0, 0, 0), fishLengthM: lengthM });
    this.inspection.setEnabled(this.transitionT >= 1);

    continueBtn.focus();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Posição da câmera ao longo do travelling (t em [0, 1]). */
  private setCameraAt(t: number, lengthM: number): void {
    const e = smoothstep(Math.min(1, Math.max(0, t)));
    const dist = lengthM * (6 - 3.6 * e);
    const az = 1.25 - 0.7 * e;
    const height = lengthM * (1.6 - 1.15 * e);
    this.camera.position.set(Math.sin(az) * dist, height, Math.cos(az) * dist);
    this.camera.lookAt(0, 0, 0);
  }

  private toggleDetails(): void {
    const on = !this.inspection.detailMode;
    this.inspection.setDetailMode(on);
    this.detailsBtn.setAttribute('aria-pressed', String(on));
    this.detailsBtn.classList.toggle('active', on);
  }

  /** Renderiza um quadro limpo e entrega o Blob ao handler; o status diz o que aconteceu. */
  async takePhoto(): Promise<void> {
    if (this.disposed) return;
    this.photoBtn.disabled = true;
    try {
      this.renderer.render(this.scene, this.camera);
      const blob = await canvasToPhotoBlob(this.canvas);
      await this.handlers.onPhoto(blob);
      this.status.textContent = 'Foto salva na galeria.';
    } catch (error) {
      this.status.textContent = 'Não foi possível salvar a foto. Tente de novo.';
      console.warn(`foto da captura não salva: ${String(error)}`);
    } finally {
      this.photoBtn.disabled = false;
    }
  }

  private resize(): void {
    const w = this.root.clientWidth || 1;
    const h = this.root.clientHeight || 1;
    if (this.canvas.clientWidth !== w || this.canvas.clientHeight !== h || this.camera.aspect !== w / h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const dt = this.lastT === null ? 16 : Math.min(100, now - this.lastT);
    this.lastT = now;
    this.resize();
    if (this.transitionT < 1) {
      this.transitionT = Math.min(1, this.transitionT + dt / TRANSITION_MS);
      this.setCameraAt(this.transitionT, this.model.lengthM);
      if (this.transitionT >= 1) this.inspection.setEnabled(true);
    } else {
      this.inspection.update();
    }
    this.animator.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.inspection.dispose();
    this.model.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
