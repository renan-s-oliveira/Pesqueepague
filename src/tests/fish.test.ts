import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng.ts';
import {
  computePoints,
  fightPull,
  getSpecies,
  hookWindowMs,
  pickSpecies,
  rollWeightKg,
  SPECIES,
  spawnProbability,
  validateSpeciesTable,
  type FishSpecies,
} from '../fish/species.ts';
import { biteProbability, DEFAULT_BITE_CONFIG, FishBrain, planBite, type BitePlan } from '../fish/fishBrain.ts';

const lambari = getSpecies('lambari');
const tilapia = getSpecies('tilapia');
const tucunare = getSpecies('tucunare');

describe('espécies', () => {
  it('a tabela padrão é válida e tem as três espécies', () => {
    expect(validateSpeciesTable(SPECIES).map((s) => s.id)).toEqual(['lambari', 'tilapia', 'tucunare']);
  });

  it('rejeita configuração inválida', () => {
    const broken: FishSpecies = { ...lambari, minWeightKg: 1, maxWeightKg: 0.5 };
    expect(() => validateSpeciesTable([broken])).toThrow(RangeError);
    expect(() => validateSpeciesTable([lambari, lambari])).toThrow(RangeError);
    expect(() => validateSpeciesTable([{ ...lambari, difficulty: 2 }])).toThrow(RangeError);
    expect(() => validateSpeciesTable([])).toThrow(RangeError);
  });

  it('sorteia pela probabilidade configurada', () => {
    const rng = new Rng(42);
    const counts = { lambari: 0, tilapia: 0, tucunare: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[pickSpecies(rng).id]++;
    expect(counts.lambari / n).toBeCloseTo(spawnProbability('lambari'), 1);
    expect(counts.tilapia / n).toBeCloseTo(spawnProbability('tilapia'), 1);
    expect(counts.tucunare / n).toBeCloseTo(spawnProbability('tucunare'), 1);
  });

  it('o peso sorteado fica na faixa da espécie', () => {
    const rng = new Rng(7);
    for (const species of SPECIES) {
      for (let i = 0; i < 500; i++) {
        const w = rollWeightKg(rng, species);
        expect(w).toBeGreaterThanOrEqual(species.minWeightKg);
        expect(w).toBeLessThanOrEqual(species.maxWeightKg);
      }
    }
  });
});

describe('dificuldade', () => {
  it('peixe mais difícil tem janela de fisgada menor', () => {
    const base = DEFAULT_BITE_CONFIG.hookWindowBaseMs;
    expect(hookWindowMs(lambari, base)).toBeGreaterThan(hookWindowMs(tilapia, base));
    expect(hookWindowMs(tilapia, base)).toBeGreaterThan(hookWindowMs(tucunare, base));
  });

  it('peixe mais difícil e mais pesado puxa mais; arrancada puxa mais que o normal', () => {
    expect(fightPull(tucunare, 2, false)).toBeGreaterThan(fightPull(lambari, 0.05, false));
    expect(fightPull(tilapia, 2.5, false)).toBeGreaterThan(fightPull(tilapia, 0.3, false));
    expect(fightPull(tilapia, 1, true)).toBeGreaterThan(fightPull(tilapia, 1, false));
  });

  it('a pontuação cresce com peso, raridade e dificuldade', () => {
    expect(computePoints(tucunare, 1)).toBeGreaterThan(computePoints(tilapia, 1));
    expect(computePoints(tilapia, 2)).toBeGreaterThan(computePoints(tilapia, 1));
    expect(computePoints(lambari, 0.02)).toBeGreaterThanOrEqual(1);
  });
});

describe('probabilidade e tempo de mordida', () => {
  it('a fórmula de probabilidade bate com a frequência simulada', () => {
    for (const species of SPECIES) {
      const rng = new Rng(1234);
      const n = 5000;
      let bites = 0;
      for (let i = 0; i < n; i++) if (planBite(rng, species).biteAtMs !== null) bites++;
      expect(bites / n).toBeCloseTo(biteProbability(species), 1);
    }
  });

  it('peixe mais arisco morde com menos frequência', () => {
    expect(biteProbability(lambari)).toBeGreaterThan(biteProbability(tucunare));
  });

  it('a mordida acontece com intervalo variável depois da aproximação', () => {
    const rng = new Rng(99);
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const plan = planBite(rng, tilapia);
      const first = plan.nibbleTimesMs[0] ?? plan.biteAtMs ?? plan.leaveAtMs;
      expect(first).toBeGreaterThanOrEqual(DEFAULT_BITE_CONFIG.approachMinMs);
      expect(first).toBeLessThanOrEqual(DEFAULT_BITE_CONFIG.approachMaxMs);
      if (plan.biteAtMs !== null) delays.add(plan.biteAtMs);
    }
    expect(delays.size).toBeGreaterThan(10);
  });
});

describe('máquina de estados do peixe', () => {
  const plan: BitePlan = { nibbleTimesMs: [1000, 1500], biteAtMs: 2000, leaveAtMs: 2000 };

  it('percorre approach → nibble → bite → fight', () => {
    const fish = new FishBrain(tilapia, 1, plan, 500);
    expect(fish.phase).toBe('approach');
    expect(fish.advance(999)).toEqual([]);
    expect(fish.advance(1)).toEqual([{ type: 'nibble', atMs: 1000 }]);
    expect(fish.phase).toBe('nibble');
    expect(fish.hook()).toBe(false);
    expect(fish.advance(1000)).toEqual([
      { type: 'nibble', atMs: 1500 },
      { type: 'bite', atMs: 2000 },
    ]);
    expect(fish.phase).toBe('bite');
    expect(fish.hook()).toBe(true);
    expect(fish.phase).toBe('fight');
    expect(fish.pull(20, new Rng(1))).toBeGreaterThan(0);
  });

  it('escapa quando a janela de fisgada passa', () => {
    const fish = new FishBrain(tilapia, 1, plan, 500);
    fish.advance(2000);
    expect(fish.advance(500)).toEqual([]);
    expect(fish.advance(1)).toEqual([{ type: 'escape', reason: 'missed_hook', atMs: 2500 }]);
    expect(fish.phase).toBe('escape');
    expect(fish.hook()).toBe(false);
  });

  it('perde o interesse quando nenhuma beliscada vira mordida', () => {
    const fish = new FishBrain(tucunare, 2, { nibbleTimesMs: [100], biteAtMs: null, leaveAtMs: 800 }, 300);
    expect(fish.advance(900)).toEqual([
      { type: 'nibble', atMs: 100 },
      { type: 'escape', reason: 'lost_interest', atMs: 800 },
    ]);
    expect(fish.escapeReason).toBe('lost_interest');
  });

  it('fora da luta não puxa linha', () => {
    expect(new FishBrain(lambari, 0.05, plan, 500).pull(20, new Rng(1))).toBe(0);
  });
});
