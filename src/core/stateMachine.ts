export const GAME_STATES = [
  'BOOT',
  'LOADING',
  'MENU',
  'IDLE',
  'CASTING',
  'WAITING',
  'HOOKED',
  'REELING',
  'CAUGHT',
  'ESCAPED',
  'PAUSED',
] as const;

export type GameState = (typeof GAME_STATES)[number];

export const GAME_EVENTS = [
  'BOOTED',
  'LOADED',
  'START',
  'CAST',
  'LURE_LANDED',
  'REEL_IN',
  'BITE',
  'HOOK_SET',
  'FISH_LANDED',
  'FISH_ESCAPED',
  'CONTINUE',
  'QUIT',
  'PAUSE',
  'RESUME',
] as const;

export type GameEventType = (typeof GAME_EVENTS)[number];

export interface GameEvent {
  readonly type: GameEventType;
  /** Identificador único da ocorrência; eventos repetidos com o mesmo id são ignorados. */
  readonly id?: string | number;
}

export type TransitionResult =
  | { readonly status: 'applied'; readonly from: GameState; readonly to: GameState; readonly event: GameEvent }
  | { readonly status: 'rejected'; readonly from: GameState; readonly event: GameEvent; readonly reason: string }
  | { readonly status: 'duplicate'; readonly from: GameState; readonly event: GameEvent };

export type TransitionListener = (from: GameState, to: GameState, event: GameEvent) => void;

type TransitionTable = { readonly [S in GameState]: Partial<Readonly<Record<GameEventType, GameState>>> };

/** Transições fixas. PAUSE e RESUME são tratados à parte porque dependem do estado anterior. */
const TRANSITIONS: TransitionTable = {
  BOOT: { BOOTED: 'LOADING' },
  LOADING: { LOADED: 'MENU' },
  MENU: { START: 'IDLE' },
  IDLE: { CAST: 'CASTING', QUIT: 'MENU' },
  CASTING: { LURE_LANDED: 'WAITING' },
  WAITING: { BITE: 'HOOKED', REEL_IN: 'IDLE' },
  HOOKED: { HOOK_SET: 'REELING', FISH_ESCAPED: 'ESCAPED' },
  REELING: { FISH_LANDED: 'CAUGHT', FISH_ESCAPED: 'ESCAPED' },
  CAUGHT: { CONTINUE: 'IDLE', QUIT: 'MENU' },
  ESCAPED: { CONTINUE: 'IDLE', QUIT: 'MENU' },
  PAUSED: { QUIT: 'MENU' },
};

const PAUSABLE: ReadonlySet<GameState> = new Set<GameState>([
  'IDLE',
  'CASTING',
  'WAITING',
  'HOOKED',
  'REELING',
  'CAUGHT',
  'ESCAPED',
]);

const DEFAULT_DEDUPE_WINDOW = 256;

export function isGameEventType(value: unknown): value is GameEventType {
  return typeof value === 'string' && (GAME_EVENTS as readonly string[]).includes(value);
}

export class GameStateMachine {
  private current: GameState = 'BOOT';
  private resumeTarget: GameState | null = null;
  private readonly seenIds = new Set<string | number>();
  private readonly seenOrder: (string | number)[] = [];
  private readonly listeners = new Set<TransitionListener>();

  constructor(private readonly dedupeWindow: number = DEFAULT_DEDUPE_WINDOW) {
    if (!Number.isInteger(dedupeWindow) || dedupeWindow < 1) {
      throw new RangeError(`dedupeWindow deve ser inteiro >= 1; recebido: ${String(dedupeWindow)}`);
    }
  }

  get state(): GameState {
    return this.current;
  }

  /** Estado para o qual RESUME volta; null fora de PAUSED. */
  get pausedFrom(): GameState | null {
    return this.resumeTarget;
  }

  can(type: GameEventType): boolean {
    return this.resolve(type) !== null;
  }

  dispatch(event: GameEvent): TransitionResult {
    const from = this.current;
    if (!isGameEventType(event.type)) {
      return { status: 'rejected', from, event, reason: `evento desconhecido: ${String(event.type)}` };
    }
    if (event.id !== undefined && this.seenIds.has(event.id)) {
      return { status: 'duplicate', from, event };
    }

    const to = this.resolve(event.type);
    if (to === null) {
      return { status: 'rejected', from, event, reason: `transição inválida: ${from} --${event.type}-->` };
    }

    this.remember(event.id);
    this.resumeTarget = event.type === 'PAUSE' ? from : null;
    this.current = to;
    for (const listener of [...this.listeners]) listener(from, to, event);
    return { status: 'applied', from, to, event };
  }

  onTransition(listener: TransitionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private resolve(type: GameEventType): GameState | null {
    if (type === 'PAUSE') return PAUSABLE.has(this.current) ? 'PAUSED' : null;
    if (type === 'RESUME') return this.current === 'PAUSED' ? this.resumeTarget : null;
    return TRANSITIONS[this.current][type] ?? null;
  }

  private remember(id: string | number | undefined): void {
    if (id === undefined) return;
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > this.dedupeWindow) {
      const oldest = this.seenOrder.shift();
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
  }
}
