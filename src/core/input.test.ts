import { describe, expect, it } from 'vitest';
import { ActionState, MAX_CAST_YAW, canLook, isPlayState, keyToAction, mapInput } from './input.ts';
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

describe('ActionState / keyToAction', () => {
  it('drag sobe e desce em passos e fica em [0, 1]', () => {
    const a = new ActionState();
    expect(a.apply({ kind: 'drag', delta: 1 }).drag).toBeCloseTo(0.6);
    for (let i = 0; i < 20; i++) a.apply({ kind: 'drag', delta: 1 });
    expect(a.snapshot.drag).toBe(1);
    for (let i = 0; i < 20; i++) a.apply({ kind: 'drag', delta: -1 });
    expect(a.snapshot.drag).toBe(0);
  });

  it('recolher, velocidade, vara e direção do arremesso são limitados e ignoram valores inválidos', () => {
    const a = new ActionState();
    expect(a.apply({ kind: 'reel', active: true }).reeling).toBe(true);
    expect(a.apply({ kind: 'reelSpeed', value: 2 }).reelSpeed).toBe(1);
    expect(a.apply({ kind: 'reelSpeed', value: Number.NaN }).reelSpeed).toBe(1);
    expect(a.apply({ kind: 'moveRod', x: -5, y: 0.5 })).toMatchObject({ rodX: -1, rodY: 0.5 });
    expect(a.apply({ kind: 'castAim', yaw: 10 }).castYaw).toBe(MAX_CAST_YAW);
    expect(a.apply({ kind: 'castAim', yaw: Number.POSITIVE_INFINITY }).castYaw).toBe(MAX_CAST_YAW);
  });

  it('teclado vira a mesma ação que gamepad ou toque usariam', () => {
    const a = new ActionState();
    expect(keyToAction('KeyR', true, a.snapshot)).toEqual({ kind: 'reel', active: true });
    expect(keyToAction('KeyR', false, a.snapshot)).toEqual({ kind: 'reel', active: false });
    expect(keyToAction('Equal', true, a.snapshot)).toEqual({ kind: 'drag', delta: 1 });
    expect(keyToAction('Minus', true, a.snapshot)).toEqual({ kind: 'drag', delta: -1 });
    expect(keyToAction('Digit3', true, a.snapshot)).toEqual({ kind: 'reelSpeed', value: 1 });
    expect(keyToAction('ArrowLeft', true, a.snapshot)).toEqual({ kind: 'moveRod', x: -0.25, y: 0 });
    const aim = keyToAction('KeyA', true, a.snapshot);
    expect(aim?.kind).toBe('castAim');
    expect(keyToAction('KeyZ', true, a.snapshot)).toBeNull();
    expect(keyToAction('Equal', false, a.snapshot)).toBeNull();
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
