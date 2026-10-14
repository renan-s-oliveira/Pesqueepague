import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../utils/clock.ts';
import { TimerManager } from './timers.ts';

describe('TimerManager', () => {
  it('dispara só quando o relógio passa do prazo, em ordem de vencimento', () => {
    const clock = new ManualClock();
    const timers = new TimerManager(clock);
    const order: string[] = [];
    timers.schedule(200, () => order.push('b'));
    timers.schedule(100, () => order.push('a'));
    timers.schedule(200, () => order.push('c'));

    clock.advance(99);
    timers.update();
    expect(order).toEqual([]);

    clock.advance(101);
    timers.update();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(timers.size).toBe(0);
  });

  it('cancela um timer pendente e todos os pendentes', () => {
    const clock = new ManualClock();
    const timers = new TimerManager(clock);
    const fn = vi.fn();
    const h = timers.schedule(10, fn);
    expect(timers.cancel(h)).toBe(true);
    expect(timers.cancel(h)).toBe(false);
    timers.schedule(10, fn);
    timers.schedule(20, fn);
    timers.cancelAll();
    clock.advance(100);
    timers.update();
    expect(fn).not.toHaveBeenCalled();
  });

  it('respeita cancelamento feito por outro callback no mesmo update', () => {
    const clock = new ManualClock();
    const timers = new TimerManager(clock);
    const late = vi.fn();
    const lateHandle = timers.schedule(20, late);
    timers.schedule(10, () => timers.cancel(lateHandle));
    clock.advance(50);
    timers.update();
    expect(late).not.toHaveBeenCalled();
  });

  it('rejeita atraso inválido', () => {
    const timers = new TimerManager(new ManualClock());
    expect(() => timers.schedule(-1, () => {})).toThrow(RangeError);
    expect(() => timers.schedule(Number.NaN, () => {})).toThrow(RangeError);
  });
});
