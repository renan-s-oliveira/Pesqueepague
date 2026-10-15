import type { GameState, TransitionListener } from '../core/stateMachine.ts';
import type { SfxId } from './synth.ts';

/** O que a ligação do áudio precisa do AudioManager (permite testar sem Web Audio). */
export interface GameAudioSink {
  playSfx(id: SfxId): boolean;
  setAmbience(on: boolean): void;
  setMenuMusic(on: boolean): void;
  setPaused(paused: boolean): Promise<void>;
}

export interface TransitionSource {
  onTransition(listener: TransitionListener): () => void;
}

const IN_GAME: ReadonlySet<GameState> = new Set<GameState>([
  'IDLE',
  'CASTING',
  'WAITING',
  'HOOKED',
  'REELING',
  'CAUGHT',
  'ESCAPED',
]);

/** Eventos de jogo fora da máquina de estados; quem os detecta toca o efeito daqui. */
export type GameAudioEvent = 'fishJumped' | 'lineStressed' | 'weighIn' | 'achievementUnlocked';

const EVENT_SFX: Readonly<Record<GameAudioEvent, SfxId>> = {
  fishJumped: 'jump',
  lineStressed: 'tension',
  weighIn: 'weigh',
  achievementUnlocked: 'achievement',
};

export function sfxForEvent(event: GameAudioEvent): SfxId {
  const id = EVENT_SFX[event];
  if (id === undefined) throw new RangeError(`evento de áudio desconhecido: ${String(event)}`);
  return id;
}

/** Efeito tocado ao entrar em cada estado; WAITING vindo de CASTING é a isca caindo na água. */
export function sfxForTransition(from: GameState, to: GameState): SfxId | null {
  if (from === 'PAUSED') return null;
  switch (to) {
    case 'CASTING':
      return 'cast';
    case 'WAITING':
      return from === 'CASTING' ? 'splash' : null;
    case 'HOOKED':
      return 'bite';
    case 'REELING':
      return 'line';
    case 'CAUGHT':
      return 'catch';
    case 'ESCAPED':
      return 'fail';
    default:
      return null;
  }
}

/** Liga o áudio às transições do jogo: música no menu, ambiente no lago, efeitos por evento e pausa. */
export function wireGameAudio(states: TransitionSource, audio: GameAudioSink): () => void {
  const reportPauseError = (error: unknown): void => console.warn('Áudio: não foi possível pausar/retomar.', error);
  return states.onTransition((from, to) => {
    if (to === 'MENU') {
      audio.setAmbience(false);
      audio.setMenuMusic(true);
    } else if (IN_GAME.has(to) && !IN_GAME.has(from) && from !== 'PAUSED') {
      audio.setMenuMusic(false);
      audio.setAmbience(true);
    }
    if (to === 'PAUSED') audio.setPaused(true).catch(reportPauseError);
    else if (from === 'PAUSED') audio.setPaused(false).catch(reportPauseError);
    const sfx = sfxForTransition(from, to);
    if (sfx !== null) audio.playSfx(sfx);
    // A pesagem acontece logo depois da captura; o som dela acompanha a entrada em CAUGHT.
    if (to === 'CAUGHT' && from !== 'PAUSED') audio.playSfx(sfxForEvent('weighIn'));
  });
}
