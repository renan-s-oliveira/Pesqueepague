import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng';
import { SplashPool, isSplashKind } from './splash';

const RealFloat32Array = globalThis.Float32Array;

/** Conta construções de Float32Array (os buffers do pool) enquanto `run` executa. */
function countAllocations(run: () => void): number {
  let count = 0;
  const CountingF32 = new Proxy(RealFloat32Array, {
    construct(target, args) {
      count += 1;
      return Reflect.construct(target, args);
    },
  });
  globalThis.Float32Array = CountingF32;
  try {
    run();
  } finally {
    globalThis.Float32Array = RealFloat32Array;
  }
  return count;
}

afterEach(() => {
  globalThis.Float32Array = RealFloat32Array;
});

describe('SplashPool', () => {
  it('reconhece só os tipos de splash conhecidos', () => {
    expect(isSplashKind('lure')).toBe(true);
    expect(isSplashKind('catch')).toBe(true);
    expect(isSplashKind('boom')).toBe(false);
  });

  it('rejeita capacidade e superfície inválidas', () => {
    expect(() => new SplashPool(new Rng(1), 0, 0)).toThrow(RangeError);
    expect(() => new SplashPool(new Rng(1), 1.5, 0)).toThrow(RangeError);
    expect(() => new SplashPool(new Rng(1), 10, Number.NaN)).toThrow(RangeError);
  });

  it('emite gotas, que sobem, caem e voltam ao pool', () => {
    const pool = new SplashPool(new Rng(7), 200, 0);
    const n = pool.emit(1, 2, 'jump');
    expect(n).toBeGreaterThan(0);
    expect(pool.activeCount).toBe(n);
    for (let i = 0; i < 120; i++) pool.update(1 / 60);
    expect(pool.activeCount).toBe(0);
  });

  it('orçamento do preset reduz as gotas e entrada inválida não emite', () => {
    const pool = new SplashPool(new Rng(7), 200, 0);
    const full = pool.emit(0, 0, 'catch');
    pool.setBudget(0.2);
    const low = pool.emit(0, 0, 'catch');
    expect(low).toBeLessThan(full);
    expect(low).toBeGreaterThan(0);
    expect(pool.emit(Number.NaN, 0, 'lure')).toBe(0);
    expect(pool.emit(0, 0, 'lure', 0)).toBe(0);
  });

  it('com o pool cheio recicla as gotas mais antigas sem passar da capacidade', () => {
    const pool = new SplashPool(new Rng(3), 32, 0);
    for (let i = 0; i < 10; i++) pool.emit(i, 0, 'catch', 2);
    expect(pool.activeCount).toBe(32);
  });

  it('não aloca objetos por frame depois do aquecimento', () => {
    const pool = new SplashPool(new Rng(11), 256, 0);
    const buffer = pool.points.geometry.getAttribute('position').array;
    for (let i = 0; i < 30; i++) {
      pool.emit(0, 0, 'catch');
      pool.update(1 / 60);
    }
    const allocations = countAllocations(() => {
      for (let frame = 0; frame < 600; frame++) {
        if (frame % 20 === 0) pool.emit(frame * 0.01, 0, frame % 40 === 0 ? 'jump' : 'lure');
        pool.update(1 / 60);
      }
    });
    expect(allocations).toBe(0);
    expect(pool.points.geometry.getAttribute('position').array).toBe(buffer);
    expect(pool.activeCount).toBeLessThanOrEqual(pool.capacity);
  });
});
