import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng.ts';
import { spawnIndividual } from '../progression/types.ts';
import { getSpecies, type FishSpecies, type LureId } from './species.ts';
import {
  BEHAVIOR_STEP_MS,
  biteChancePerNibble,
  environment,
  fightProfile,
  FishBehavior,
  type DepthProvider,
  type Environment,
  type LureMotion,
  type Stimulus,
} from './behavior.ts';

const lambari = getSpecies('lambari');
const tilapia = getSpecies('tilapia');
const tucunare = getSpecies('tucunare');
const flat = (m: number): DepthProvider => ({ depthAt: () => m });

function stimulus(env: Environment, lureId: LureId, motion: LureMotion = 'slow', extra: Partial<Stimulus> = {}): Stimulus {
  return { env, lure: { lureId, motion, x: 0, z: 1, depthM: 1 }, playerDistanceM: 20, playerMoving: false, ...extra };
}

/** Beliscadas e mordidas observadas na simulação: taxa de mordida = mordidas / beliscadas. */
function biteRate(species: FishSpecies, s: Stimulus, trials = 300): number {
  let nibbles = 0;
  let bites = 0;
  for (let i = 0; i < trials; i++) {
    const rng = new Rng(1000 + i);
    const fish = new FishBehavior(species, spawnIndividual(rng, species), rng, flat(3), { x: 0, z: 0 });
    for (let t = 0; t < 60_000 && fish.state !== 'bite'; t += BEHAVIOR_STEP_MS) {
      const signals = fish.advance(BEHAVIOR_STEP_MS, s);
      nibbles += signals.filter((sig) => sig.type === 'nibble').length;
      if (signals.some((sig) => sig.type === 'state' && sig.from === 'nibble' && sig.to === 'patrol')) break;
    }
    if (fish.state === 'bite') bites++;
  }
  return bites / nibbles;
}

const day = environment(12, 'clear');
const nightRain = environment(23, 'rain');
const nonPreferred: Record<string, LureId> = { lambari: 'spinner', tilapia: 'popper', tucunare: 'corn' };

describe('mordida por isca, hora e clima', () => {
  it('a isca preferida aumenta a taxa de mordida de todas as espécies', () => {
    for (const species of [lambari, tilapia, tucunare]) {
      const preferred = species.preferredLures[0] as LureId;
      const other = nonPreferred[species.id] as LureId;
      expect(species.preferredLures).not.toContain(other);
      expect(biteChancePerNibble(species, stimulus(day, preferred), 3)).toBeGreaterThan(
        biteChancePerNibble(species, stimulus(day, other), 3),
      );
      expect(biteRate(species, stimulus(day, preferred))).toBeGreaterThan(biteRate(species, stimulus(day, other)) + 0.15);
    }
  });

  it('à noite e com chuva a tilápia morde mais, enquanto lambari e tucunaré mordem menos', () => {
    const lure: Record<string, LureId> = { lambari: 'dough', tilapia: 'pellet', tucunare: 'spinner' };
    const rate = (species: FishSpecies, env: Environment): number =>
      biteRate(species, stimulus(env, lure[species.id] as LureId, species.id === 'tucunare' ? 'fast' : 'still'));
    expect(nightRain.waterTempC).toBeLessThan(day.waterTempC);
    expect(rate(tilapia, nightRain)).toBeGreaterThan(rate(tilapia, day) + 0.05);
    expect(rate(lambari, nightRain)).toBeLessThan(rate(lambari, day) - 0.1);
    expect(rate(tucunare, nightRain)).toBeLessThan(rate(tucunare, day) - 0.1);
  });

  it('o movimento da isca pesa conforme a espécie e o fundo raso fora da faixa reduz a chance', () => {
    expect(biteChancePerNibble(tucunare, stimulus(day, 'jig', 'fast'), 3)).toBeGreaterThan(
      biteChancePerNibble(tucunare, stimulus(day, 'jig', 'still'), 3),
    );
    expect(biteChancePerNibble(tilapia, stimulus(day, 'worm', 'still'), 3)).toBeGreaterThan(
      biteChancePerNibble(tilapia, stimulus(day, 'worm', 'fast'), 3),
    );
    expect(biteChancePerNibble(tucunare, stimulus(day, 'jig'), 0.5)).toBeLessThan(
      biteChancePerNibble(tucunare, stimulus(day, 'jig'), 3),
    );
    expect(biteChancePerNibble(tucunare, { ...stimulus(day, 'jig'), lure: null }, 3)).toBe(0);
  });
});

describe('estados', () => {
  it('jogador se mexendo perto deixa o peixe em alerta e ele não se interessa pela isca', () => {
    const rng = new Rng(5);
    const fish = new FishBehavior(tucunare, spawnIndividual(rng, tucunare), rng, flat(3), { x: 0, z: 0 });
    fish.advance(2000, stimulus(day, 'spinner', 'fast', { playerDistanceM: 0.5, playerMoving: true }));
    expect(['alert', 'flee']).toContain(fish.state);
    expect(fish.alert).toBeGreaterThanOrEqual(0.6);
  });

  it('perde a mordida quando a janela de fisgada passa e foge', () => {
    const rng = new Rng(8);
    const fish = new FishBehavior(lambari, spawnIndividual(rng, lambari), rng, flat(1), { x: 0, z: 0 });
    const s = stimulus(day, 'dough');
    while (fish.state !== 'bite') fish.advance(BEHAVIOR_STEP_MS, s);
    fish.advance(2000, s);
    expect(['flee', 'alert']).toContain(fish.state);
    expect(fish.hook()).toBe(false);
  });

  it('valida a entrada', () => {
    const rng = new Rng(1);
    const ind = spawnIndividual(rng, lambari);
    expect(() => new FishBehavior(tilapia, ind, rng, flat(1), { x: 0, z: 0 })).toThrow(RangeError);
    expect(() => new FishBehavior(lambari, ind, rng, flat(Number.NaN), { x: 0, z: 0 })).toThrow(RangeError);
    const fish = new FishBehavior(lambari, ind, rng, flat(1), { x: 0, z: 0 });
    expect(() => fish.advance(20, stimulus({ ...day, hour: 24 }, 'dough'))).toThrow(RangeError);
    expect(() => fish.advance(20, stimulus(day, 'dough', 'slow', { lineTension: 2 }))).toThrow(RangeError);
    expect(() => fish.catchResult()).toThrow();
  });
});

describe('briga', () => {
  function hookedFish(seed: number, species: FishSpecies, lureId: LureId) {
    const rng = new Rng(seed);
    const individual = spawnIndividual(rng, species);
    const fish = new FishBehavior(species, individual, rng, flat(3), { x: 0, z: 0 });
    const s = stimulus(day, lureId, 'fast');
    for (let t = 0; t < 120_000 && fish.state !== 'bite'; t += BEHAVIOR_STEP_MS) fish.advance(BEHAVIOR_STEP_MS, s);
    expect(fish.hook()).toBe(true);
    return { fish, individual, s };
  }

  it('o peso do peixe fisgado é igual ao definido no spawn, do começo ao fim da briga', () => {
    for (const [i, species] of [lambari, tilapia, tucunare].entries()) {
      const { fish, individual, s } = hookedFish(40 + i, species, species.preferredLures[0] as LureId);
      expect(fish.state).toBe('hooked');
      expect(fish.weightKg).toBe(individual.weightKg);
      fish.advance(30_000, { ...s, lineTension: 1 });
      expect(fish.state).toBe('tired');
      const caught = fish.catchResult();
      expect(caught.weightKg).toBe(individual.weightKg);
      expect(caught.lengthCm).toBe(individual.lengthCm);
      expect(caught.speciesId).toBe(species.id);
    }
  });

  it('cansa com a briga, puxa menos cansado e recupera fôlego com a linha frouxa', () => {
    const { fish, s } = hookedFish(77, tilapia, 'pellet');
    fish.advance(BEHAVIOR_STEP_MS, { ...s, lineTension: 1 });
    const fresh = fish.pullPerSec;
    expect(fresh).toBeGreaterThan(0);
    fish.advance(60_000, { ...s, lineTension: 1 });
    expect(fish.state).toBe('tired');
    expect(fish.pullPerSec).toBeLessThan(fresh);
    const exhausted = fish.stamina;
    fish.advance(6_000, { ...s, lineTension: 0 });
    expect(fish.stamina).toBeGreaterThan(exhausted);
    expect(fish.state).toBe('hooked');
  });

  it('o perfil de resistência cresce com espécie e tamanho e cai com o cansaço', () => {
    expect(fightProfile(tucunare, 3, 1).basePull).toBeGreaterThan(fightProfile(lambari, 0.05, 1).basePull);
    expect(fightProfile(tilapia, 2.4, 1).basePull).toBeGreaterThan(fightProfile(tilapia, 0.4, 1).basePull);
    const fresh = fightProfile(tilapia, 1, 1);
    const tired = fightProfile(tilapia, 1, 0.1);
    expect(tired.basePull).toBeLessThan(fresh.basePull);
    expect(tired.burstChancePerSec).toBeLessThan(fresh.burstChancePerSec);
    expect(tired.burstMs).toBeLessThan(fresh.burstMs);
  });
});
