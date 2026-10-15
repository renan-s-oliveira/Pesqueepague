import { describe, expect, it } from 'vitest';
import { GameStateMachine, type GameEventType, type GameState } from './stateMachine.ts';

function machineAt(events: GameEventType[]): GameStateMachine {
  const m = new GameStateMachine();
  for (const type of events) expect(m.dispatch({ type }).status).toBe('applied');
  return m;
}

const TO_IDLE: GameEventType[] = ['BOOTED', 'LOADED', 'START'];

describe('GameStateMachine', () => {
  it('começa em BOOT e percorre o fluxo até CAUGHT', () => {
    const m = machineAt([...TO_IDLE, 'CAST', 'LURE_LANDED', 'BITE', 'HOOK_SET', 'FISH_LANDED']);
    expect(m.state).toBe('CAUGHT');
  });

  it('chega a ESCAPED quando o peixe foge durante o recolhimento', () => {
    const m = machineAt([...TO_IDLE, 'CAST', 'LURE_LANDED', 'BITE', 'HOOK_SET', 'FISH_ESCAPED']);
    expect(m.state).toBe('ESCAPED');
  });

  it('LINE_BROKEN leva HOOKED e REELING a ESCAPED e é rejeitado fora da briga', () => {
    const reeling = machineAt([...TO_IDLE, 'CAST', 'LURE_LANDED', 'BITE', 'HOOK_SET', 'LINE_BROKEN']);
    expect(reeling.state).toBe('ESCAPED');
    const hooked = machineAt([...TO_IDLE, 'CAST', 'LURE_LANDED', 'BITE', 'LINE_BROKEN']);
    expect(hooked.state).toBe('ESCAPED');
    const waiting = machineAt([...TO_IDLE, 'CAST', 'LURE_LANDED']);
    expect(waiting.dispatch({ type: 'LINE_BROKEN' }).status).toBe('rejected');
    expect(waiting.state).toBe('WAITING');
  });

  it('rejeita transição inválida sem mudar de estado', () => {
    const m = new GameStateMachine();
    const result = m.dispatch({ type: 'CAST' });
    expect(result.status).toBe('rejected');
    expect(m.state).toBe('BOOT');

    const idle = machineAt(TO_IDLE);
    expect(idle.dispatch({ type: 'FISH_LANDED' }).status).toBe('rejected');
    expect(idle.state).toBe('IDLE');
  });

  it('rejeita evento desconhecido', () => {
    const m = new GameStateMachine();
    const result = m.dispatch({ type: 'NOPE' as GameEventType });
    expect(result.status).toBe('rejected');
    expect(m.state).toBe('BOOT');
  });

  it('não permite pausar fora do jogo nem pausar duas vezes', () => {
    const m = new GameStateMachine();
    expect(m.dispatch({ type: 'PAUSE' }).status).toBe('rejected');
    const idle = machineAt(TO_IDLE);
    expect(idle.dispatch({ type: 'PAUSE' }).status).toBe('applied');
    expect(idle.dispatch({ type: 'PAUSE' }).status).toBe('rejected');
    expect(idle.state).toBe('PAUSED');
  });

  it.each<[GameEventType[], GameState]>([
    [TO_IDLE, 'IDLE'],
    [[...TO_IDLE, 'CAST', 'LURE_LANDED'], 'WAITING'],
    [[...TO_IDLE, 'CAST', 'LURE_LANDED', 'BITE', 'HOOK_SET'], 'REELING'],
  ])('PAUSED restaura o estado anterior (%#)', (path, expected) => {
    const m = machineAt(path);
    expect(m.dispatch({ type: 'PAUSE' })).toMatchObject({ status: 'applied', to: 'PAUSED' });
    expect(m.pausedFrom).toBe(expected);
    expect(m.dispatch({ type: 'RESUME' })).toMatchObject({ status: 'applied', to: expected });
    expect(m.state).toBe(expected);
    expect(m.pausedFrom).toBeNull();
  });

  it('RESUME fora de PAUSED é rejeitado', () => {
    const m = machineAt(TO_IDLE);
    expect(m.dispatch({ type: 'RESUME' }).status).toBe('rejected');
  });

  it('QUIT a partir de PAUSED vai para MENU e descarta o estado anterior', () => {
    const m = machineAt([...TO_IDLE, 'PAUSE', 'QUIT']);
    expect(m.state).toBe('MENU');
    expect(m.pausedFrom).toBeNull();
  });

  it('ignora evento duplicado com o mesmo id', () => {
    const m = machineAt(TO_IDLE);
    let notifications = 0;
    m.onTransition(() => notifications++);

    expect(m.dispatch({ type: 'CAST', id: 'cast-1' }).status).toBe('applied');
    expect(m.dispatch({ type: 'CAST', id: 'cast-1' }).status).toBe('duplicate');
    expect(m.state).toBe('CASTING');
    expect(notifications).toBe(1);
  });

  it('id repetido é ignorado mesmo quando a transição seria válida', () => {
    const m = machineAt(TO_IDLE);
    m.dispatch({ type: 'PAUSE', id: 7 });
    m.dispatch({ type: 'RESUME', id: 8 });
    expect(m.dispatch({ type: 'PAUSE', id: 7 }).status).toBe('duplicate');
    expect(m.state).toBe('IDLE');
  });

  it('evento rejeitado não consome o id', () => {
    const m = machineAt(TO_IDLE);
    expect(m.dispatch({ type: 'BITE', id: 'x' }).status).toBe('rejected');
    expect(m.dispatch({ type: 'CAST', id: 'x' }).status).toBe('applied');
  });

  it('notifica e permite cancelar a inscrição', () => {
    const m = new GameStateMachine();
    const seen: string[] = [];
    const off = m.onTransition((from, to) => seen.push(`${from}->${to}`));
    m.dispatch({ type: 'BOOTED' });
    off();
    m.dispatch({ type: 'LOADED' });
    expect(seen).toEqual(['BOOT->LOADING']);
  });

  it('valida a janela de deduplicação', () => {
    expect(() => new GameStateMachine(0)).toThrow(RangeError);
  });
});
