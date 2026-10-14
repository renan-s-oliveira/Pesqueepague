import { describe, expect, it } from 'vitest';
import { Rng } from './rng.ts';
import { ManualClock } from './clock.ts';

describe('Rng', () => {
  it('a mesma seed produz a mesma sequência', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('seeds diferentes divergem', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('int respeita os limites inclusivos', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('getState/setState reproduz a continuação', () => {
    const rng = new Rng(99);
    rng.next();
    const saved = rng.getState();
    const expected = rng.next();
    rng.setState(saved);
    expect(rng.next()).toBe(expected);
  });

  it('valida seed e argumentos', () => {
    expect(() => new Rng(-1)).toThrow(RangeError);
    expect(() => new Rng(1.5)).toThrow(RangeError);
    expect(() => new Rng(0).pick([])).toThrow(RangeError);
    expect(() => new Rng(0).int(5, 1)).toThrow(RangeError);
  });
});

describe('ManualClock', () => {
  it('só avança quando mandado', () => {
    const clock = new ManualClock(10);
    expect(clock.now()).toBe(10);
    clock.advance(5);
    expect(clock.now()).toBe(15);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
