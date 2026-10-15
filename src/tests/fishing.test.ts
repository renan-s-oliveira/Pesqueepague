import { describe, expect, it } from 'vitest';
import { castPower, computeCast, DEFAULT_CAST_CONFIG, trajectoryAt, validateCastConfig } from '../fishing/cast.ts';
import { DEFAULT_REEL_CONFIG, DragReel, ReelLine, validateReelConfig } from '../fishing/reel.ts';
import { LINE_SPECS, VerletLine } from '../fishing/linePhysics.ts';
import { RodPhysics } from '../fishing/rodPhysics.ts';

describe('potência do arremesso', () => {
  it('cresce linearmente com o tempo segurado e satura em 1', () => {
    expect(castPower(0)).toBe(0);
    expect(castPower(DEFAULT_CAST_CONFIG.maxHoldMs / 2)).toBeCloseTo(0.5);
    expect(castPower(DEFAULT_CAST_CONFIG.maxHoldMs)).toBe(1);
    expect(castPower(DEFAULT_CAST_CONFIG.maxHoldMs * 3)).toBe(1);
  });

  it('rejeita tempo negativo ou não finito', () => {
    expect(() => castPower(-1)).toThrow(RangeError);
    expect(() => castPower(Number.NaN)).toThrow(RangeError);
  });

  it('mais potência leva a isca mais longe e por mais tempo', () => {
    const weak = computeCast(0);
    const strong = computeCast(1);
    expect(strong.distanceM).toBeGreaterThan(weak.distanceM);
    expect(strong.flightMs).toBeGreaterThan(weak.flightMs);
    expect(() => computeCast(1.1)).toThrow(RangeError);
  });

  it('a trajetória sai da altura de lançamento e termina no ponto de queda', () => {
    const cast = computeCast(0.7);
    const start = trajectoryAt(cast, 0);
    const end = trajectoryAt(cast, cast.flightMs);
    const middle = trajectoryAt(cast, cast.flightMs / 2);
    expect(start).toEqual({ x: 0, y: DEFAULT_CAST_CONFIG.launchHeightM });
    expect(end.x).toBeCloseTo(cast.distanceM);
    expect(end.y).toBeCloseTo(0, 6);
    expect(middle.y).toBeGreaterThan(0);
    expect(trajectoryAt(cast, cast.flightMs * 2)).toEqual(end);
  });

  it('valida a configuração', () => {
    expect(() => validateCastConfig({ ...DEFAULT_CAST_CONFIG, gravity: 0 })).toThrow(RangeError);
    expect(() => validateCastConfig({ ...DEFAULT_CAST_CONFIG, launchAngleRad: Math.PI })).toThrow(RangeError);
  });
});

describe('vara, linha e molinete juntos', () => {
  const frameMs = 1000 / 60;

  it('a tensão do molinete curva a vara e, com a linha rompida, a vara volta ao repouso', () => {
    const reel = new DragReel(LINE_SPECS.mono020, 30, 100);
    const rod = new RodPhysics();
    let maxBend = 0;
    for (let i = 0; i < 180 && reel.status === 'ok'; i++) {
      reel.update(frameMs, { retrieve: 0.5, fishSpeedMps: 3 });
      rod.setLineTension(reel.tensionN);
      rod.update(frameMs);
      maxBend = Math.max(maxBend, rod.bendRad);
    }
    expect(reel.status).toBe('snapped');
    expect(maxBend).toBeGreaterThan(0);
    for (let i = 0; i < 360; i++) {
      rod.setLineTension(reel.tensionN);
      rod.update(frameMs);
    }
    expect(rod.isAtRest()).toBe(true);
  });

  it('a linha Verlet acompanha o comprimento solto pelo molinete', () => {
    const reel = new DragReel(LINE_SPECS.mono030, 10, 20);
    const line = new VerletLine(LINE_SPECS.mono030, reel.lineOutM, { x: 0, y: 2, z: 0 }, { x: 9, y: 0, z: 0 });
    for (let i = 0; i < 60; i++) {
      reel.update(frameMs, { retrieve: 1, fishSpeedMps: -1.2 });
      line.setLength(reel.lineOutM);
      line.update(frameMs);
    }
    expect(line.lengthM).toBeCloseTo(reel.lineOutM, 9);
    expect(line.tensionN).toBeGreaterThan(0);
    expect(line.broken).toBe(false);
  });
});

describe('tensão e recolhimento', () => {
  it('sobe ao recolher e cai ao pausar', () => {
    const line = new ReelLine(20);
    line.step(1000, true, 0.2);
    const afterReel = line.tension;
    expect(afterReel).toBeCloseTo(DEFAULT_REEL_CONFIG.tensionRisePerSec + 0.2);
    expect(line.distanceM).toBeCloseTo(20 - DEFAULT_REEL_CONFIG.reelSpeedMps);
    line.step(500, false, 0.2);
    expect(line.tension).toBeLessThan(afterReel);
    expect(line.distanceM).toBeGreaterThan(20 - DEFAULT_REEL_CONFIG.reelSpeedMps);
  });

  it('não fica negativa', () => {
    const line = new ReelLine(10);
    line.step(5000, false, 0);
    expect(line.tension).toBe(0);
  });

  it('rompe só depois de snapAfterMs acima do limite', () => {
    const line = new ReelLine(50);
    while (line.tension <= DEFAULT_REEL_CONFIG.tensionLimit) line.step(20, true, 1);
    expect(line.status).toBe('fighting');
    expect(line.overLimitMs).toBe(20);
    while (line.overLimitMs + 20 < DEFAULT_REEL_CONFIG.snapAfterMs) expect(line.step(20, true, 1)).toBe('fighting');
    expect(line.step(20, true, 1)).toBe('snapped');
    expect(line.overLimitMs).toBe(DEFAULT_REEL_CONFIG.snapAfterMs);
  });

  it('sair do limite zera a contagem de rompimento', () => {
    const line = new ReelLine(50);
    while (line.tension <= DEFAULT_REEL_CONFIG.tensionLimit) line.step(20, true, 1);
    line.step(DEFAULT_REEL_CONFIG.snapAfterMs / 2, true, 0);
    expect(line.overLimitMs).toBeGreaterThan(0);
    line.step(2000, false, 0);
    expect(line.overLimitMs).toBe(0);
    expect(line.status).toBe('fighting');
  });

  it('captura quando a distância chega a zero', () => {
    const line = new ReelLine(1);
    expect(line.step(400, true, 0)).toBe('fighting');
    expect(line.step(200, true, 0)).toBe('caught');
    expect(line.distanceM).toBe(0);
    expect(line.step(100, true, 5)).toBe('caught');
  });

  it('valida entradas', () => {
    expect(() => new ReelLine(-1)).toThrow(RangeError);
    expect(() => new ReelLine(5).step(-1, true, 0)).toThrow(RangeError);
    expect(() => validateReelConfig({ ...DEFAULT_REEL_CONFIG, maxTension: 0.5 })).toThrow(RangeError);
  });
});
