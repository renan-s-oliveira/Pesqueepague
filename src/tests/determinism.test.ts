import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng.ts';
import { pickSpecies, rollWeightKg } from '../fish/species.ts';
import { planBite } from '../fish/fishBrain.ts';
import { DEFAULT_CONFIG, deriveSeed, parseGameConfig } from '../config/gameConfig.ts';
import { spawnIndividual } from '../progression/types.ts';
import { environment, FishBehavior, type BehaviorSignal, type Stimulus } from '../fish/behavior.ts';

const STIMULUS: Stimulus = {
  env: environment(18, 'cloudy'),
  lure: { lureId: 'worm', motion: 'slow', x: 1, z: 1, depthM: 1 },
  playerDistanceM: 6,
  playerMoving: false,
};

/** Roda a IA de um peixe em pedaços de tempo arbitrários; com `strike`, fisga ao fim do pedaço em que houver mordida. */
function behaviorTrace(seed: number, chunksMs: readonly number[], strike = true): { signals: BehaviorSignal[]; weightKg: number; stamina: number } {
  const rng = new Rng(seed);
  const species = pickSpecies(rng);
  const fish = new FishBehavior(species, spawnIndividual(rng, species), rng, { depthAt: () => 2 }, { x: 0, z: 0 });
  const signals: BehaviorSignal[] = [];
  let total = 0;
  while (total < 40_000) {
    for (const dt of chunksMs) {
      total += dt;
      signals.push(...fish.advance(dt, { ...STIMULUS, lineTension: 0.7 }));
      if (strike) fish.hook();
    }
  }
  return { signals, weightKg: fish.weightKg, stamina: fish.stamina };
}

function sequence(seed: number, count: number): [string, number, number | null][] {
  const rng = new Rng(seed);
  const out: [string, number, number | null][] = [];
  for (let i = 0; i < count; i++) {
    const species = pickSpecies(rng);
    const weight = rollWeightKg(rng, species);
    out.push([species.id, weight, planBite(rng, species).biteAtMs]);
  }
  return out;
}

describe('determinismo por seed', () => {
  it('a mesma seed produz a mesma sequência de espécie, peso e tempo de mordida', () => {
    const a = sequence(20261014, 50);
    const b = sequence(20261014, 50);
    expect(a).toEqual(b);
    expect(new Set(a.map(([id]) => id)).size).toBeGreaterThan(1);
  });

  it('a IA do peixe é determinística pela seed e pelo passo fixo de 20 ms', () => {
    const a = behaviorTrace(20261014, [20]);
    expect(a.signals.length).toBeGreaterThan(2);
    expect(behaviorTrace(20261014, [20])).toEqual(a);
    const free = behaviorTrace(20261014, [20], false);
    expect(behaviorTrace(20261014, [7, 13, 33, 27], false)).toEqual(free);
    expect(behaviorTrace(20261015, [20])).not.toEqual(a);
  });

  it('seeds diferentes produzem sequências diferentes', () => {
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20));
  });

  it('regressão: a sub-seed da sessão derivada de 20261014 é uint32 e aceita pelo Rng', () => {
    const seed = parseGameConfig({ seed: 20261014 }).seed;
    const derived = deriveSeed(seed, 0x9e3779b9);
    expect(seed ^ 0x9e3779b9).toBe(-1627238097);
    expect(derived).toBe(-1627238097 >>> 0);
    expect(derived).toBeGreaterThanOrEqual(0);
    expect(derived).toBeLessThanOrEqual(0xffffffff);
    expect(() => new Rng(derived)).not.toThrow();
  });

  it('deriveSeed devolve uint32 nos extremos e é determinística', () => {
    for (const seed of [0, 1, DEFAULT_CONFIG.seed, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const d = deriveSeed(seed, 0x9e3779b9);
      expect(Number.isInteger(d) && d >= 0 && d <= 0xffffffff).toBe(true);
      expect(deriveSeed(seed, 0x9e3779b9)).toBe(d);
    }
  });

  it('parseGameConfig continua rejeitando seed negativa ou acima de uint32', () => {
    expect(() => parseGameConfig({ seed: -1627238097 })).toThrow(RangeError);
    expect(() => parseGameConfig({ seed: 0x100000000 })).toThrow(RangeError);
    expect(() => parseGameConfig({ seed: 1.5 })).toThrow(RangeError);
  });
});
