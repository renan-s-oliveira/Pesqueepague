import { describe, expect, it } from 'vitest';
import { canLook, isPlayState, mapInput } from './input.ts';
import { GAME_STATES } from './stateMachine.ts';

const idle = { charging: false };
const charging = { charging: true };

describe('mapInput', () => {
  it('IDLE: pressionar começa a carga e soltar lança', () => {
    expect(mapInput('IDLE', 'primaryDown', idle)).toBe('beginCharge');
    expect(mapInput('IDLE', 'primaryUp', charging)).toBe('releaseCast');
    expect(mapInput('IDLE', 'primaryUp', idle)).toBe('none');
    expect(mapInput('IDLE', 'primaryDown', charging)).toBe('none');
  });

  it('WAITING recolhe, HOOKED fisga, REELING recolhe enquanto segura', () => {
    expect(mapInput('WAITING', 'primaryDown', idle)).toBe('retrieve');
    expect(mapInput('HOOKED', 'primaryDown', idle)).toBe('hook');
    expect(mapInput('REELING', 'primaryDown', idle)).toBe('reelStart');
    expect(mapInput('REELING', 'primaryUp', idle)).toBe('reelStop');
  });

  it('CAUGHT e ESCAPED continuam; CASTING ignora o botão', () => {
    expect(mapInput('CAUGHT', 'primaryDown', idle)).toBe('continue');
    expect(mapInput('ESCAPED', 'primaryDown', idle)).toBe('continue');
    expect(mapInput('CASTING', 'primaryDown', idle)).toBe('none');
    expect(mapInput('CASTING', 'primaryUp', idle)).toBe('none');
  });

  it('ESC pausa nos estados de jogo e retoma em PAUSED', () => {
    for (const s of ['IDLE', 'CASTING', 'WAITING', 'HOOKED', 'REELING', 'CAUGHT', 'ESCAPED'] as const) {
      expect(mapInput(s, 'pause', idle)).toBe('pause');
    }
    expect(mapInput('PAUSED', 'pause', idle)).toBe('resume');
  });

  it('fora do jogo (BOOT, LOADING, MENU) nenhum gesto gera ação', () => {
    for (const s of ['BOOT', 'LOADING', 'MENU'] as const) {
      for (const g of ['primaryDown', 'primaryUp', 'pause', 'help'] as const) {
        expect(mapInput(s, g, idle)).toBe('none');
      }
    }
  });

  it('H alterna a ajuda só durante o jogo', () => {
    expect(mapInput('WAITING', 'help', idle)).toBe('toggleHelp');
    expect(mapInput('PAUSED', 'help', idle)).toBe('none');
  });

  it('PAUSED ignora o botão principal', () => {
    expect(mapInput('PAUSED', 'primaryDown', idle)).toBe('none');
    expect(mapInput('PAUSED', 'primaryUp', charging)).toBe('none');
  });

  it('cobre todos os estados sem lançar', () => {
    for (const s of GAME_STATES) {
      for (const g of ['primaryDown', 'primaryUp', 'pause', 'help'] as const) {
        expect(typeof mapInput(s, g, idle)).toBe('string');
      }
    }
  });
});

describe('isPlayState / canLook', () => {
  it('olhar só nos estados ativos de pesca', () => {
    expect(isPlayState('MENU')).toBe(false);
    expect(isPlayState('REELING')).toBe(true);
    expect(canLook('IDLE')).toBe(true);
    expect(canLook('CAUGHT')).toBe(false);
    expect(canLook('PAUSED')).toBe(false);
  });
});
