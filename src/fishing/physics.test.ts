import { describe, expect, it } from 'vitest';
import {
  computeCast,
  DEFAULT_BALLISTIC_CONFIG,
  DEFAULT_CAST_CONFIG,
  dragAcceleration,
  NO_WIND,
  simulateCast,
  type BallisticCastInput,
} from './cast.ts';
import { LINE_SPECS, VerletLine } from './linePhysics.ts';
import { DragReel } from './reel.ts';
import { RodPhysics } from './rodPhysics.ts';

const FRAME_MS = 1000 / 60;

function run(seconds: number, step: (dtMs: number) => void): void {
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  for (let i = 0; i < frames; i++) step(FRAME_MS);
}

const baseCast: BallisticCastInput = {
  power: 0.6,
  elevationRad: Math.PI / 6,
  directionRad: 0,
  lureMassKg: 0.02,
  wind: NO_WIND,
};

const range = (input: BallisticCastInput): number => {
  const { landing } = simulateCast(input);
  return Math.hypot(landing.x, landing.z);
};

describe('arremesso balístico', () => {
  it('alcance cresce com a potência', () => {
    const ranges = [0.2, 0.5, 0.8, 1].map((power) => range({ ...baseCast, power }));
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!).toBeGreaterThan(ranges[i - 1]!);
  });

  it('vento lateral desvia a isca para o lado do vento', () => {
    const calm = simulateCast(baseCast).landing;
    const right = simulateCast({ ...baseCast, wind: { x: 0, z: 4 } }).landing;
    const left = simulateCast({ ...baseCast, wind: { x: 0, z: -4 } }).landing;
    expect(Math.abs(calm.z)).toBeLessThan(1e-9);
    expect(right.z).toBeGreaterThan(0.5);
    expect(left.z).toBeLessThan(-0.5);
    expect(right.z).toBeCloseTo(-left.z, 6);
  });

  it('isca leve sofre mais arrasto e cai mais perto', () => {
    const v = { x: 20, y: 5, z: 0 };
    const light = dragAcceleration(v, 0.005);
    const heavy = dragAcceleration(v, 0.03);
    expect(Math.hypot(light.x, light.y)).toBeCloseTo(Math.hypot(heavy.x, heavy.y) * 6, 9);
    expect(range({ ...baseCast, lureMassKg: 0.005 })).toBeLessThan(range({ ...baseCast, lureMassKg: 0.03 }));
  });

  it('sem ar coincide com a solução analítica e a direção gira o ponto de queda', () => {
    const vacuum = { ...DEFAULT_BALLISTIC_CONFIG, airDensityKgM3: 0, maxSpeedMps: DEFAULT_CAST_CONFIG.maxSpeedMps };
    const sim = simulateCast({ ...baseCast, lureMassKg: 0.005 }, vacuum);
    const analytic = computeCast(baseCast.power);
    expect(Math.abs(sim.landing.x - analytic.distanceM)).toBeLessThan(0.2);
    expect(Math.abs(sim.flightMs - analytic.flightMs)).toBeLessThan(20);
    const turned = simulateCast({ ...baseCast, directionRad: Math.PI / 2 }).landing;
    expect(turned.z).toBeCloseTo(range(baseCast), 6);
    expect(Math.abs(turned.x)).toBeLessThan(1e-9);
  });

  it('valida as entradas', () => {
    expect(() => simulateCast({ ...baseCast, power: 2 })).toThrow(RangeError);
    expect(() => simulateCast({ ...baseCast, lureMassKg: 0 })).toThrow(RangeError);
    expect(() => simulateCast({ ...baseCast, elevationRad: Math.PI / 2 })).toThrow(RangeError);
  });
});

describe('linha Verlet', () => {
  it('reinicia uma linha rompida sem carregar a energia do arremesso anterior', () => {
    const start = { x: 0, y: 3, z: 0 };
    const line = new VerletLine(LINE_SPECS.mono020, 1, start, { x: 10, y: 0, z: 0 });
    line.update(FRAME_MS);
    expect(line.broken).toBe(true);
    const end = { x: 4, y: -0.06, z: 0 };
    line.reset(start, end, 5.2);
    run(2, (dt) => line.update(dt));
    expect(line.broken).toBe(false);
    expect(line.points().at(-1)).toEqual(end);
    expect(line.points()[0]).toEqual(start);
    expect(line.points().every((p) => Math.abs(p.x) < 10 && Math.abs(p.y) < 10)).toBe(true);
  });
  it('rompe acima do limite da própria linha', () => {
    const start = { x: 0, y: 2, z: 0 };
    const farEnd = { x: 10.5, y: 0, z: 0 };
    const thin = new VerletLine(LINE_SPECS.mono020, 10, start, farEnd);
    thin.update(FRAME_MS);
    expect(thin.broken).toBe(true);
    expect(thin.peakTensionN).toBeGreaterThan(LINE_SPECS.mono020.breakingStrengthN);

    const stronger = { ...LINE_SPECS.mono020, id: 'mono020-forte', breakingStrengthN: 80 };
    const strong = new VerletLine(stronger, 10, start, farEnd);
    strong.update(FRAME_MS);
    expect(strong.broken).toBe(false);
    expect(strong.tensionN).toBeCloseTo(thin.peakTensionN, 9);

    const safe = new VerletLine(LINE_SPECS.mono020, 10, start, { x: 10, y: 0, z: 0 });
    safe.update(FRAME_MS);
    expect(safe.broken).toBe(false);
    expect(safe.tensionN).toBeGreaterThan(0);
  });

  it('com folga forma catenária e deita sobre a água', () => {
    const start = { x: 0, y: 3, z: 0 };
    const end = { x: 8, y: 0, z: 0 };
    const line = new VerletLine(LINE_SPECS.mono030, 12, start, end);
    run(3, (dt) => line.update(dt));
    const pts = line.points();
    expect(line.tensionN).toBe(0);
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(mid.y).toBeLessThan(start.y + (end.y - start.y) * (mid.x / end.x));
    expect(pts.every((p) => p.y >= 0)).toBe(true);
    expect(pts.some((p, i) => i > 0 && i < pts.length - 1 && p.y === 0)).toBe(true);
    expect(pts[0]).toEqual(start);
    expect(pts[pts.length - 1]).toEqual(end);
  });

  it('recolher linha com as pontas paradas aumenta a tensão', () => {
    const line = new VerletLine(LINE_SPECS.braid020, 12, { x: 0, y: 2, z: 0 }, { x: 10, y: 0, z: 0 });
    line.update(FRAME_MS);
    expect(line.tensionN).toBe(0);
    line.setLength(10.1);
    line.update(FRAME_MS);
    expect(line.tensionN).toBeGreaterThan(0);
    expect(line.lengthM).toBe(10.1);
    expect(() => line.setLength(0)).toThrow(RangeError);
  });
});

describe('molinete com drag', () => {
  const surge = { retrieve: 0, fishSpeedMps: 4 };

  it('drag mais solto reduz o pico de tensão e cede linha', () => {
    const locked = new DragReel(LINE_SPECS.braid020, 30, 120);
    const loose = new DragReel(LINE_SPECS.braid020, 30, 30);
    run(1.5, (dt) => {
      locked.update(dt, surge);
      loose.update(dt, surge);
    });
    expect(loose.peakTensionN).toBeLessThan(locked.peakTensionN);
    expect(loose.peakTensionN).toBeLessThanOrEqual(30);
    expect(loose.isSlipping).toBe(true);
    expect(loose.lineOutM).toBeGreaterThan(locked.lineOutM);
  });

  it('rompe quando a tensão passa do limite da linha', () => {
    const tight = new DragReel(LINE_SPECS.mono020, 30, 100);
    const set = new DragReel(LINE_SPECS.mono020, 30, 30);
    run(1.5, (dt) => {
      tight.update(dt, surge);
      set.update(dt, surge);
    });
    expect(tight.status).toBe('snapped');
    expect(tight.tensionN).toBe(0);
    expect(set.status).toBe('ok');
  });

  it('a velocidade de recolhimento é variável', () => {
    const slow = new DragReel(LINE_SPECS.mono030, 50, 20);
    const fast = new DragReel(LINE_SPECS.mono030, 50, 20);
    run(1, (dt) => {
      slow.update(dt, { retrieve: 0.5, fishSpeedMps: -2 });
      fast.update(dt, { retrieve: 1, fishSpeedMps: -2 });
    });
    expect(50 - slow.lineOutM).toBeCloseTo(0.6, 2);
    expect(50 - fast.lineOutM).toBeCloseTo(1.2, 2);
    expect(() => fast.setDrag(-1)).toThrow(RangeError);
    expect(() => fast.update(FRAME_MS, { retrieve: 1.5, fishSpeedMps: 0 })).toThrow(RangeError);
  });
});

describe('vara em segmentos', () => {
  it('aumenta a flexão com a carga e reduz o braço de alavanca ao curvar', () => {
    const one = new RodPhysics();
    const two = new RodPhysics();
    one.setLineTension(1);
    two.setLineTension(2);
    run(4, (dt) => {
      one.update(dt);
      two.update(dt);
    });
    expect(one.bendRad).toBeGreaterThan(0);
    expect(two.bendRad).toBeGreaterThan(one.bendRad);
    expect(two.bendRad).toBeLessThan(one.bendRad * 2);
    expect(one.bendRad).toBeCloseTo(one.staticBendRad(1), 4);
  });

  it('não enrola sobre si mesma sob a carga máxima da linha e mantém o comprimento', () => {
    const rod = new RodPhysics();
    rod.setLineTension(LINE_SPECS.mono020.breakingStrengthN);
    run(5, (dt) => rod.update(dt));
    expect(rod.bendRad).toBeGreaterThan(0.5);
    expect(rod.bendRad).toBeLessThan(Math.PI / 2);
    const points = rod.points(0);
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
    expect(length).toBeCloseTo(2.4, 8);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('produz a mesma flexão em 30 e 120 fps', () => {
    const slow = new RodPhysics();
    const fast = new RodPhysics();
    slow.setLineTension(15);
    fast.setLineTension(15);
    for (let i = 0; i < 60; i++) slow.update(1000 / 30);
    for (let i = 0; i < 240; i++) fast.update(1000 / 120);
    expect(slow.bendRad).toBeCloseTo(fast.bendRad, 7);
  });

  it('volta ao repouso vibrando depois de soltar a tensão', () => {
    const rod = new RodPhysics();
    rod.setLineTension(3);
    run(2, (dt) => rod.update(dt));
    const loaded = rod.bendRad;
    expect(loaded).toBeGreaterThan(0);
    rod.setLineTension(0);
    let minBend = loaded;
    run(5, (dt) => {
      rod.update(dt);
      minBend = Math.min(minBend, rod.bendRad);
    });
    expect(minBend).toBeLessThan(0);
    expect(rod.isAtRest()).toBe(true);
    expect(Math.abs(rod.bendRad)).toBeLessThan(1e-4);
    const tip = rod.points(0).at(-1)!;
    expect(tip.x).toBeCloseTo(2.4, 4);
    expect(tip.y).toBeCloseTo(0, 4);
  });
});
