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

/**
 * Camada de ações independente de dispositivo. Teclado, mouse, gamepad e toque traduzem
 * seus sinais para estas ações; a sessão de pesca só lê o ActionState.
 */
export type PlayerAction =
  | { readonly kind: 'reel'; readonly active: boolean }
  | { readonly kind: 'reelSpeed'; readonly value: number }
  | { readonly kind: 'drag'; readonly delta: 1 | -1 }
  | { readonly kind: 'moveRod'; readonly x: number; readonly y: number }
  | { readonly kind: 'castAim'; readonly yaw: number };

export interface ActionSnapshot {
  readonly reeling: boolean;
  /** Velocidade de recolhimento em [0, 1]. */
  readonly reelSpeed: number;
  /** Drag do molinete em [0, 1]. */
  readonly drag: number;
  /** Posição da vara em [-1, 1] nos dois eixos. */
  readonly rodX: number;
  readonly rodY: number;
  /** Direção do arremesso em radianos, relativa à frente do jogador, em [-MAX_CAST_YAW, MAX_CAST_YAW]. */
  readonly castYaw: number;
}

export const DRAG_STEP = 0.1;
export const MAX_CAST_YAW = Math.PI / 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Estado acumulado das ações. Valores não finitos são ignorados. */
export class ActionState {
  private s: ActionSnapshot = { reeling: false, reelSpeed: 1, drag: 0.5, rodX: 0, rodY: 0, castYaw: 0 };

  get snapshot(): ActionSnapshot {
    return this.s;
  }

  apply(action: PlayerAction): ActionSnapshot {
    switch (action.kind) {
      case 'reel':
        this.s = { ...this.s, reeling: action.active };
        break;
      case 'reelSpeed':
        if (Number.isFinite(action.value)) this.s = { ...this.s, reelSpeed: clamp(action.value, 0, 1) };
        break;
      case 'drag':
        this.s = { ...this.s, drag: Math.round(clamp(this.s.drag + action.delta * DRAG_STEP, 0, 1) * 100) / 100 };
        break;
      case 'moveRod':
        if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
          this.s = { ...this.s, rodX: clamp(action.x, -1, 1), rodY: clamp(action.y, -1, 1) };
        }
        break;
      case 'castAim':
        if (Number.isFinite(action.yaw)) this.s = { ...this.s, castYaw: clamp(action.yaw, -MAX_CAST_YAW, MAX_CAST_YAW) };
        break;
    }
    return this.s;
  }
}

/** Teclado → ação. Gamepad e toque terão seus próprios mapeadores para o mesmo PlayerAction. */
export function keyToAction(code: string, down: boolean, current: ActionSnapshot): PlayerAction | null {
  switch (code) {
    case 'KeyR':
      return { kind: 'reel', active: down };
    case 'Equal':
    case 'NumpadAdd':
      return down ? { kind: 'drag', delta: 1 } : null;
    case 'Minus':
    case 'NumpadSubtract':
      return down ? { kind: 'drag', delta: -1 } : null;
    case 'Digit1':
    case 'Digit2':
    case 'Digit3':
      return down ? { kind: 'reelSpeed', value: Number(code.slice(5)) / 3 } : null;
    case 'KeyA':
      return down ? { kind: 'castAim', yaw: current.castYaw + MAX_CAST_YAW / 8 } : null;
    case 'KeyD':
      return down ? { kind: 'castAim', yaw: current.castYaw - MAX_CAST_YAW / 8 } : null;
    case 'ArrowLeft':
      return down ? { kind: 'moveRod', x: current.rodX - 0.25, y: current.rodY } : null;
    case 'ArrowRight':
      return down ? { kind: 'moveRod', x: current.rodX + 0.25, y: current.rodY } : null;
    case 'ArrowUp':
      return down ? { kind: 'moveRod', x: current.rodX, y: current.rodY + 0.25 } : null;
    case 'ArrowDown':
      return down ? { kind: 'moveRod', x: current.rodX, y: current.rodY - 0.25 } : null;
    default:
      return null;
  }
}

export interface InputBindings {
  readonly onCrank?: (turns: number) => void;
  readonly onPayout?: (on: boolean) => void;
  /** Elemento que recebe cliques e toques do jogo (o canvas). */
  readonly surface: HTMLElement;
  readonly getState: () => GameState;
  readonly getContext: () => InputContext;
  readonly onAction: (action: GameAction) => void;
  readonly onLook: (deltaYaw: number, deltaPitch: number) => void;
  /** Recebe o estado das ações de jogo a cada mudança (opcional). */
  readonly onPlayerAction?: (snapshot: ActionSnapshot, action: PlayerAction) => void;
}

const BASE_SENSITIVITY = 0.0022;

/** Liga os eventos do DOM ao mapeamento. dispose() remove todos os listeners. */
export class InputController {
  private freeCursor = false;
  private sensitivity = 1;
  private primaryHeld = false;
  private readonly b: InputBindings;
  readonly actions = new ActionState();

  /** Ponto de entrada comum para gamepad, toque ou teclado. */
  applyAction(action: PlayerAction): ActionSnapshot {
    const snap = this.actions.apply(action);
    this.b.onPlayerAction?.(snap, action);
    return snap;
  }

  constructor(bindings: InputBindings) {
    this.b = bindings;
    const s = bindings.surface;
    s.addEventListener('pointerdown', this.onPointerDown);
    s.addEventListener('wheel', this.onWheel, { passive: false });
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
    this.freeCursor = false;
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
    s.removeEventListener('wheel', this.onWheel);
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
    if (e.code === 'KeyC' && !e.repeat && canLook(this.b.getState())) {
      this.freeCursor = !this.freeCursor;
      if (this.freeCursor) this.releaseLock(); else this.requestLock();
      return;
    }
    if (e.code === 'KeyE' && this.b.getState() === 'REELING') { e.preventDefault(); this.b.onPayout?.(true); return; }
    if (!e.repeat && isPlayState(this.b.getState())) {
      const action = keyToAction(e.code, true, this.actions.snapshot);
      if (action) {
        this.applyAction(action);
        return;
      }
    }
    if (e.code === 'Space') {
      if (isPlayState(this.b.getState())) e.preventDefault();
      if (!e.repeat) this.press();
    } else if (e.code === 'KeyH' && !e.repeat) {
      this.emit('help');
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyE') this.b.onPayout?.(false);
    if (e.code === 'Space') this.release();
    else if (e.code === 'KeyR') this.applyAction({ kind: 'reel', active: false });
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.b.surface || !canLook(this.b.getState())) return;
    const k = BASE_SENSITIVITY * this.sensitivity;
    this.b.onLook(-e.movementX * k, -e.movementY * k);
  };

  /** O navegador consome o ESC ao sair do pointer lock: tratamos a saída do lock como pausa. */
  private readonly onLockChange = (): void => {
    if (document.pointerLockElement === null && !this.freeCursor && isPlayState(this.b.getState())) this.emit('pause');
  };

  private readonly onBlur = (): void => {
    this.b.onPayout?.(false);
    this.release();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.b.getState() !== 'REELING') return;
    event.preventDefault();
    if (event.deltaY < 0) this.b.onCrank?.(Math.min(1, Math.abs(event.deltaY) / 160));
  };
}
