import type { GameState } from './stateMachine.ts';

/** Entradas físicas já abstraídas: mouse, teclado e toque viram o mesmo gesto. */
export type InputGesture = 'primaryDown' | 'primaryUp' | 'pause' | 'help';

/** Ação de jogo resultante; 'none' quando o gesto não vale no estado atual. */
export type GameAction =
  | 'beginCharge'
  | 'releaseCast'
  | 'retrieve'
  | 'hook'
  | 'reelStart'
  | 'reelStop'
  | 'continue'
  | 'pause'
  | 'resume'
  | 'toggleHelp'
  | 'none';

export interface InputContext {
  readonly charging: boolean;
}

const PLAY_STATES: ReadonlySet<GameState> = new Set<GameState>([
  'IDLE',
  'CASTING',
  'WAITING',
  'HOOKED',
  'REELING',
  'CAUGHT',
  'ESCAPED',
]);

export function isPlayState(state: GameState): boolean {
  return PLAY_STATES.has(state);
}

/** Olhar com o mouse só vale durante o jogo (não no menu, carregamento ou pausa). */
export function canLook(state: GameState): boolean {
  return PLAY_STATES.has(state) && state !== 'CAUGHT' && state !== 'ESCAPED';
}

/** Mapeamento puro gesto × estado → ação. */
export function mapInput(state: GameState, gesture: InputGesture, ctx: InputContext): GameAction {
  if (gesture === 'pause') {
    if (state === 'PAUSED') return 'resume';
    return PLAY_STATES.has(state) ? 'pause' : 'none';
  }
  if (gesture === 'help') return PLAY_STATES.has(state) ? 'toggleHelp' : 'none';
  if (gesture === 'primaryDown') {
    switch (state) {
      case 'IDLE':
        return ctx.charging ? 'none' : 'beginCharge';
      case 'WAITING':
        return 'retrieve';
      case 'HOOKED':
        return 'hook';
      case 'REELING':
        return 'reelStart';
      case 'CAUGHT':
      case 'ESCAPED':
        return 'continue';
      default:
        return 'none';
    }
  }
  if (state === 'IDLE' && ctx.charging) return 'releaseCast';
  if (state === 'REELING') return 'reelStop';
  return 'none';
}

export interface InputBindings {
  /** Elemento que recebe cliques e toques do jogo (o canvas). */
  readonly surface: HTMLElement;
  readonly getState: () => GameState;
  readonly getContext: () => InputContext;
  readonly onAction: (action: GameAction) => void;
  readonly onLook: (deltaYaw: number, deltaPitch: number) => void;
}

const BASE_SENSITIVITY = 0.0022;

/** Liga os eventos do DOM ao mapeamento. dispose() remove todos os listeners. */
export class InputController {
  private sensitivity = 1;
  private primaryHeld = false;
  private readonly b: InputBindings;

  constructor(bindings: InputBindings) {
    this.b = bindings;
    const s = bindings.surface;
    s.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('blur', this.onBlur);
  }

  /** Multiplicador de sensibilidade em [0.1, 3]; valores inválidos são ignorados. */
  setSensitivity(value: number): void {
    if (Number.isFinite(value) && value >= 0.1 && value <= 3) this.sensitivity = value;
  }

  requestLock(): void {
    const s = this.b.surface;
    if (document.pointerLockElement !== s && typeof s.requestPointerLock === 'function') {
      try {
        void Promise.resolve(s.requestPointerLock()).catch(() => undefined);
      } catch {
        /* pointer lock indisponível: o jogo segue sem olhar livre */
      }
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.b.surface) document.exitPointerLock();
  }

  dispose(): void {
    const s = this.b.surface;
    s.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('blur', this.onBlur);
    this.releaseLock();
  }

  private emit(gesture: InputGesture): void {
    const action = mapInput(this.b.getState(), gesture, this.b.getContext());
    if (action !== 'none') this.b.onAction(action);
  }

  private press(): void {
    if (this.primaryHeld) return;
    this.primaryHeld = true;
    this.emit('primaryDown');
  }

  private release(): void {
    if (!this.primaryHeld) return;
    this.primaryHeld = false;
    this.emit('primaryUp');
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (!isPlayState(this.b.getState())) return;
    if (e.pointerType === 'mouse') this.requestLock();
    this.press();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.release();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const inForm = !!target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName);
    if (e.code === 'Escape') {
      if (!e.repeat) this.emit('pause');
      return;
    }
    if (inForm) return;
    if (e.code === 'Space') {
      if (isPlayState(this.b.getState())) e.preventDefault();
      if (!e.repeat) this.press();
    } else if (e.code === 'KeyH' && !e.repeat) {
      this.emit('help');
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.release();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.b.surface || !canLook(this.b.getState())) return;
    const k = BASE_SENSITIVITY * this.sensitivity;
    this.b.onLook(-e.movementX * k, -e.movementY * k);
  };

  /** O navegador consome o ESC ao sair do pointer lock: tratamos a saída do lock como pausa. */
  private readonly onLockChange = (): void => {
    if (document.pointerLockElement === null && isPlayState(this.b.getState())) this.emit('pause');
  };

  private readonly onBlur = (): void => {
    this.release();
  };
}
