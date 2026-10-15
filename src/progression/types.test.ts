import { describe, expect, it } from 'vitest';
import { Rng } from '../utils/rng.ts';
import { expectedWeightKg, getSpecies, SPECIES, trophyWeightKg } from '../fish/species.ts';
import {
  CONDITION_FACTOR_SPREAD,
  HUE_SHIFT_MAX_DEG,
  LIGHTNESS_SHIFT_MAX,
  spawnIndividual,
  type CatchRecord,
} from './types.ts';

/** Fator de condição mais o arredondamento do peso a gramas no menor peixe (20 g). */
const WEIGHT_TOLERANCE = CONDITION_FACTOR_SPREAD + 0.03;

describe('spawnIndividual', () => {
  it('o mesmo seed gera o mesmo peso, comprimento e cor', () => {
    for (const species of SPECIES) {
      const a = new Rng(2024);
      const b = new Rng(2024);
      for (let i = 0; i < 50; i++) {
        const first = spawnIndividual(a, species);
        const second = spawnIndividual(b, species);
        expect(second).toEqual(first);
      }
    }
  });

  it('seeds diferentes geram indivíduos diferentes', () => {
    const tilapia = getSpecies('tilapia');
    expect(spawnIndividual(new Rng(1), tilapia)).not.toEqual(spawnIndividual(new Rng(2), tilapia));
  });

  it('o peso segue W = a·L^b dentro da tolerância', () => {
    const rng = new Rng(77);
    for (const species of SPECIES) {
      for (let i = 0; i < 500; i++) {
        const fish = spawnIndividual(rng, species);
        const expected = expectedWeightKg(species, fish.lengthCm);
        expect(Math.abs(fish.weightKg / expected - 1)).toBeLessThanOrEqual(WEIGHT_TOLERANCE);
      }
    }
  });

  it('peso fica na faixa da espécie e a cor dentro dos limites', () => {
    const rng = new Rng(5);
    for (const species of SPECIES) {
      for (let i = 0; i < 500; i++) {
        const fish = spawnIndividual(rng, species);
        expect(fish.speciesId).toBe(species.id);
        expect(fish.weightKg).toBeGreaterThanOrEqual(species.minWeightKg);
        expect(fish.weightKg).toBeLessThanOrEqual(species.maxWeightKg);
        expect(fish.lengthCm).toBeGreaterThan(0);
        expect(Math.abs(fish.color.hueShiftDeg)).toBeLessThanOrEqual(HUE_SHIFT_MAX_DEG);
        expect(Math.abs(fish.color.lightnessShift)).toBeLessThanOrEqual(LIGHTNESS_SHIFT_MAX);
        expect(Number.isInteger(fish.color.spotSeed)).toBe(true);
      }
    }
  });

  it('peixe maior é mais pesado', () => {
    const tucunare = getSpecies('tucunare');
    expect(expectedWeightKg(tucunare, 60)).toBeGreaterThan(expectedWeightKg(tucunare, 40));
  });

  it("só os troféus (topo de peso) são 'legendary'; os demais herdam a raridade da espécie", () => {
    const rng = new Rng(31);
    for (const species of SPECIES) {
      let legendary = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const fish = spawnIndividual(rng, species);
        if (fish.weightKg >= trophyWeightKg(species)) {
          expect(fish.rarity).toBe('legendary');
          legendary++;
        } else {
          expect(fish.rarity).toBe(species.rarity);
        }
      }
      expect(legendary).toBeGreaterThan(0);
      expect(legendary / n).toBeLessThan(0.15);
    }
  });
});

describe('CatchRecord', () => {
  it('monta um registro a partir do indivíduo', () => {
    const fish = spawnIndividual(new Rng(9), getSpecies('tucunare'));
    const record: CatchRecord = {
      id: 'catch-1',
      speciesId: fish.speciesId,
      weightKg: fish.weightKg,
      lengthCm: fish.lengthCm,
      timestamp: 1_760_000_000_000,
      locationId: 'lago-principal',
      lureId: 'spinner',
      rarity: fish.rarity,
      disposition: 'released',
      isPersonalRecord: true,
    };
    expect(record.photoId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });
});
