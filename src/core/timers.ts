import type { Clock } from '../utils/clock.ts';

export type TimerHandle = number;

interface PendingTimer {
  readonly handle: TimerHandle;
  readonly dueAt: number;
  readonly callback: () => void;
}

/**
 * Timers dirigidos pelo relógio do jogo: só disparam em update(), em ordem de vencimento
 * (empate resolvido pela ordem de criação). Pausar o jogo = não chamar update().
 */
export class TimerManager {
  private readonly pending = new Map<TimerHandle, PendingTimer>();
  private nextHandle: TimerHandle = 1;

  constructor(private readonly clock: Clock) {}

  get size(): number {
    return this.pending.size;
  }

  schedule(delayMs: number, callback: () => void): TimerHandle {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError(`delayMs deve ser finito e >= 0; recebido: ${String(delayMs)}`);
    }
    const handle = this.nextHandle++;
    this.pending.set(handle, { handle, dueAt: this.clock.now() + delayMs, callback });
    return handle;
  }

  /** Devolve true se o timer ainda estava pendente. */
  cancel(handle: TimerHandle): boolean {
    return this.pending.delete(handle);
  }

  cancelAll(): void {
    this.pending.clear();
  }

  update(): void {
    const now = this.clock.now();
    const due = [...this.pending.values()]
      .filter((t) => t.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt || a.handle - b.handle);
    for (const timer of due) {
      // Um callback anterior pode ter cancelado este timer.
      if (!this.pending.delete(timer.handle)) continue;
      timer.callback();
    }
  }
}
