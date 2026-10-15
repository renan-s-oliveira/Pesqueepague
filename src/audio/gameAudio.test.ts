import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../core/stateMachine.ts';
import { sfxForTransition, wireGameAudio, type GameAudioSink } from './gameAudio.ts';
import type { SfxId } from './synth.ts';

function fakeSink() {
  const log: string[] = [];
  const sink: GameAudioSink = {
    playSfx: (id: SfxId) => {
      log.push(`sfx:${id}`);
      return true;
    },
    setAmbience: (on) => void log.push(`ambience:${String(on)}`),
    setMenuMusic: (on) => void log.push(`menu:${String(on)}`),
    setPaused: async (paused) => void log.push(`paused:${String(paused)}`),
  };
  return { sink, log };
}

describe('wireGameAudio', () => {
  it('toca música no menu, ambiente no jogo e os efeitos do ciclo de pesca', () => {
    const states = new GameStateMachine();
    const { sink, log } = fakeSink();
    const off = wireGameAudio(states, sink);
    for (const type of ['BOOTED', 'LOADED', 'START', 'CAST', 'LURE_LANDED', 'BITE', 'HOOK_SET', 'FISH_LANDED'] as const) {
      states.dispatch({ type });
    }
    expect(log).toEqual([
      'ambience:false',
      'menu:true',
      'menu:false',
      'ambience:true',
      'sfx:cast',
      'sfx:splash',
      'sfx:bite',
      'sfx:line',
      'sfx:catch',
      'sfx:weigh',
    ]);
    off();
    states.dispatch({ type: 'QUIT' });
    expect(log).toHaveLength(10);
  });

  it('suspende na pausa e retoma sem repetir o efeito do estado anterior', () => {
    const states = new GameStateMachine();
    const { sink, log } = fakeSink();
    for (const type of ['BOOTED', 'LOADED', 'START', 'CAST', 'LURE_LANDED', 'BITE'] as const) states.dispatch({ type });
    wireGameAudio(states, sink);
    states.dispatch({ type: 'PAUSE' });
    states.dispatch({ type: 'RESUME' });
    expect(log).toEqual(['paused:true', 'paused:false']);
  });

  it('a fuga toca o efeito de falha e a linha recolhida antes da mordida não toca nada', () => {
    expect(sfxForTransition('HOOKED', 'ESCAPED')).toBe('fail');
    expect(sfxForTransition('WAITING', 'IDLE')).toBeNull();
    expect(sfxForTransition('PAUSED', 'HOOKED')).toBeNull();
  });
});
