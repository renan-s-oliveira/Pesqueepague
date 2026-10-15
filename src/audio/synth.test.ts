import { describe, expect, it } from 'vitest';
import { renderSound, SOUND_IDS, SOUND_SPECS, soundLength } from './synth.ts';

const SAMPLE_RATE = 8000;

function render(id: (typeof SOUND_IDS)[number], seed: number): Float32Array {
  const out = new Float32Array(soundLength(id, SAMPLE_RATE));
  renderSound(id, out, SAMPLE_RATE, seed);
  return out;
}

describe('síntese procedural', () => {
  it('tem um gerador para cada um dos 18 sons pedidos', () => {
    expect([...SOUND_IDS].sort()).toEqual(
      [
        'forest',
        'water',
        'waves',
        'wind',
        'birds',
        'insects',
        'rain',
        'cast',
        'splash',
        'line',
        'bite',
        'catch',
        'fail',
        'tension',
        'jump',
        'weigh',
        'achievement',
        'menuMusic',
      ].sort(),
    );
    for (const id of SOUND_IDS) expect(typeof SOUND_SPECS[id].generate).toBe('function');
  });

  it.each(SOUND_IDS)('%s gera amostras finitas, audíveis e sem clipping', (id) => {
    const out = render(id, 7);
    let peak = 0;
    let energy = 0;
    let allFinite = true;
    for (const v of out) {
      allFinite &&= Number.isFinite(v);
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    expect(allFinite).toBe(true);
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.sqrt(energy / out.length)).toBeGreaterThan(0.005);
  });

  it('é determinística para a mesma seed', () => {
    expect(render('birds', 3)).toEqual(render('birds', 3));
    expect(render('birds', 3)).not.toEqual(render('birds', 4));
  });

  it('rejeita taxa de amostragem inválida', () => {
    expect(() => soundLength('bite', 0)).toThrow(RangeError);
    expect(() => renderSound('bite', new Float32Array(10), Number.NaN, 1)).toThrow(RangeError);
  });
});
