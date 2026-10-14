/** Fonte de tempo em milissegundos. A lógica do jogo só lê o tempo por aqui. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return performance.now();
  }
}

/** Relógio controlado manualmente, para testes e simulações determinísticas. */
export class ManualClock implements Clock {
  private t: number;

  constructor(startMs = 0) {
    if (!Number.isFinite(startMs)) throw new RangeError(`tempo inicial inválido: ${String(startMs)}`);
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance() exige ms finito e >= 0; recebido: ${String(ms)}`);
    }
    this.t += ms;
  }
}
