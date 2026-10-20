import { describe, expect, it, vi } from 'vitest';
import { SPECIES, pickSpecies, getSpecies, individualRarity } from './species.ts';
import { EXTRA_FISH } from './catalogue.ts';
import { LAKE_IDS, lakeSpecies, speciesLake } from '../world/lakes.ts';
import { Rng } from '../utils/rng.ts';
import { LEGENDARY_ODDS, rollLegendary, LEGENDARY_INTRO_MS } from './legendary.ts';
import { FishingSession } from '../gameplay/fishingSession.ts';
import { GameStateMachine } from '../core/stateMachine.ts';
import { ManualClock } from '../utils/clock.ts';
import { defaultSaveData, parseSaveData } from '../config/persistence.ts';

describe('três lagos exclusivos', () => {
  it('contém exatamente 50 novas espécies, as três originais e uma secreta', () => {
    expect(EXTRA_FISH).toHaveLength(50);
    expect(SPECIES).toHaveLength(54);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(54);
    expect(SPECIES.filter((s) => s.secret)).toHaveLength(1);
  });
  it('cada espécie normal pertence a um único lago e todos os lagos são povoados', () => {
    const ids = LAKE_IDS.flatMap((id) => lakeSpecies(id).map((s) => s.id));
    expect(ids).toHaveLength(53);
    expect(new Set(ids).size).toBe(53);
    expect(LAKE_IDS.map((id) => lakeSpecies(id).length)).toEqual([18, 18, 17]);
    for (const id of LAKE_IDS) {
      const rng = new Rng(15);
      for (let n = 0; n < 1000; n++) expect(speciesLake(pickSpecies(rng, lakeSpecies(id)).id)).toBe(id);
    }
  });
  it('o peixe secreto jamais sai da seleção normal, mesmo no extremo do sorteio', () => {
    const rng = new Rng(1); vi.spyOn(rng, 'next').mockReturnValue(.999999999);
    expect(pickSpecies(rng).id).not.toBe('guardiao-abissal');
    expect(individualRarity(getSpecies('guardiao-abissal'), 60)).toBe('legendary');
  });
  it('a sessão real respeita o lago em arremessos sucessivos e mantém a escolha no save', () => {
    for (const id of LAKE_IDS) {
      const machine = new GameStateMachine(); machine.dispatch({ type: 'BOOTED' }); machine.dispatch({ type: 'LOADED' });
      const clock = new ManualClock();
      const session = new FishingSession(machine, new Rng(88), clock, { initialLake: id, legendaryRoll: () => false });
      session.restart();
      for (let i = 0; i < 20; i++) {
        session.beginCharge(); clock.advance(100); session.releaseCast();
        clock.advance(session.currentCast!.flightMs + 40); session.update();
        expect(speciesLake(session.currentFish!.species.id)).toBe(id);
        expect(session.retrieve().ok).toBe(true);
      }
      const save = defaultSaveData();
      expect(parseSaveData({ ...save, settings: { ...save.settings, lakeId: id } }).data.settings.lakeId).toBe(id);
    }
  });
});

describe('encontro de uma chance em um bilhão', () => {
  it('tem quatro vencedores equiprováveis em quatro bilhões de valores aceitos', () => {
    expect(LEGENDARY_ODDS).toBe(1_000_000_000);
    for (const value of [0, 1_000_000_000, 2_000_000_000, 3_000_000_000]) expect(rollLegendary(() => value)).toBe(true);
    for (const value of [1, 999_999_999, 1_000_000_001, 3_999_999_999]) expect(rollLegendary(() => value)).toBe(false);
    const values = [0xffffffff, 4_000_000_000, 0];
    expect(rollLegendary(() => values.shift()!)).toBe(true);
    expect(values).toHaveLength(0);
  });
  it('sorteia somente uma vez por arremesso e pausa a mordida durante a entrada', () => {
    const machine = new GameStateMachine(); machine.dispatch({ type: 'BOOTED' }); machine.dispatch({ type: 'LOADED' });
    const clock = new ManualClock(); const roll = vi.fn(() => true);
    const session = new FishingSession(machine, new Rng(42), clock, { initialLake: 'igapo', legendaryRoll: roll });
    const entrance = vi.fn(); session.onLegendary(entrance);
    session.restart(); session.beginCharge(); clock.advance(100); session.releaseCast();
    expect(roll).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 150 && session.state === 'CASTING'; i++) { clock.advance(20); session.update(); }
    expect(session.currentFish?.species.id).toBe('guardiao-abissal');
    expect(entrance).toHaveBeenCalledTimes(1);
    clock.advance(LEGENDARY_INTRO_MS - 100); session.update();
    expect(session.state).toBe('WAITING'); expect(session.retrieve().ok).toBe(false);
    session.pause(); const remaining = session.cinematicRemainingMs;
    clock.advance(10000); session.update(); expect(session.cinematicRemainingMs).toBe(remaining);
    session.resume(); clock.advance(1000); session.update();
    expect(session.cinematicRemainingMs).toBe(0);
    expect(roll).toHaveBeenCalledTimes(1);
  });
  it('não sorteia o Guardião nos outros dois lagos nem troca lago durante a pesca', () => {
    for (const id of ['tropical', 'serra'] as const) {
      const machine = new GameStateMachine(); machine.dispatch({ type: 'BOOTED' }); machine.dispatch({ type: 'LOADED' });
      const clock = new ManualClock(); const roll = vi.fn(() => true);
      const session = new FishingSession(machine, new Rng(42), clock, { initialLake: id, legendaryRoll: roll });
      session.restart(); session.beginCharge(); clock.advance(100); session.releaseCast();
      expect(roll).not.toHaveBeenCalled(); expect(session.setLake('igapo').ok).toBe(false);
    }
  });
});
