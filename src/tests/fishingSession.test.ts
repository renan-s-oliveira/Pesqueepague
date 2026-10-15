import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../core/stateMachine.ts';
import { ManualClock } from '../utils/clock.ts';
import { Rng } from '../utils/rng.ts';
import { FishingSession, type CaughtFish, type JournalEntry } from '../gameplay/fishingSession.ts';
import { defaultSaveData, recordOutcome } from '../config/persistence.ts';

const SEED = 20261014;
const FRAME_MS = 16;
const MAX_FRAMES = 100_000;

function setup(seed = SEED) {
  const machine = new GameStateMachine();
  for (const type of ['BOOTED', 'LOADED', 'START'] as const) machine.dispatch({ type });
  const clock = new ManualClock();
  const session = new FishingSession(machine, new Rng(seed), clock);
  const frame = (ms = FRAME_MS) => {
    clock.advance(ms);
    session.update();
  };
  return { machine, clock, session, frame };
}

type Setup = ReturnType<typeof setup>;

function cast({ clock, session, frame }: Setup, holdMs = 900): void {
  expect(session.beginCharge()).toEqual({ ok: true });
  clock.advance(holdMs);
  expect(session.releaseCast()).toEqual({ ok: true });
  for (let i = 0; i < MAX_FRAMES && session.state === 'CASTING'; i++) frame();
}

/** Joga até o fim do arremesso: fisga na hora e segura a tensão abaixo de 0,7. */
function playCast(s: Setup): JournalEntry {
  cast(s);
  for (let i = 0; i < MAX_FRAMES; i++) {
    const { state } = s.session;
    if (state === 'CAUGHT' || state === 'ESCAPED') break;
    if (state === 'HOOKED') s.session.hook();
    if (state === 'REELING') s.session.setReeling(s.session.tension < 0.7);
    s.frame();
  }
  const last = s.session.journal.at(-1);
  if (!last) throw new Error('o arremesso não terminou');
  return last;
}

describe('FishingSession: fluxo completo com seed fixa', () => {
  it('vai de CASTING a CAUGHT, pontua e registra no diário', () => {
    const s = setup();
    const visited: string[] = [];
    s.machine.onTransition((_from, to) => visited.push(to));
    const entry = playCast(s);
    expect(visited).toEqual(['CASTING', 'WAITING', 'HOOKED', 'REELING', 'CAUGHT']);
    expect(entry.outcome).toBe('caught');
    expect(entry.points).toBeGreaterThan(0);
    expect(s.session.score).toBe(entry.points);
    expect(s.session.journal).toHaveLength(1);
    expect(s.session.continue()).toEqual({ ok: true });
    expect(s.session.state).toBe('IDLE');
  });

  it('a mesma seed reproduz o mesmo diário; outra seed muda o resultado', () => {
    const run = (seed: number) => {
      const s = setup(seed);
      for (let i = 0; i < 4; i++) {
        playCast(s);
        s.session.continue();
      }
      return s.session.journal;
    };
    const a = run(SEED);
    expect(a).toHaveLength(4);
    expect(run(SEED)).toEqual(a);
    expect(run(SEED + 1)).not.toEqual(a);
  });

  it('sem fisgar, o peixe escapa por perder a janela', () => {
    const s = setup();
    cast(s);
    for (let i = 0; i < MAX_FRAMES && s.session.state !== 'ESCAPED'; i++) s.frame();
    expect(s.session.state).toBe('ESCAPED');
    expect(s.session.journal[0]).toMatchObject({ outcome: 'escaped', reason: 'missed_hook', points: 0 });
    expect(s.session.score).toBe(0);
  });

  it('recolher sem parar arrebenta a linha', () => {
    const s = setup();
    cast(s, 1500);
    for (let i = 0; i < MAX_FRAMES && s.session.state !== 'REELING'; i++) {
      if (s.session.state === 'HOOKED') s.session.hook();
      s.frame();
    }
    s.session.setReeling(true);
    for (let i = 0; i < MAX_FRAMES && s.session.state === 'REELING'; i++) s.frame();
    // Arremesso longo: a linha rompe antes de a distância chegar a zero.
    expect(s.session.journal[0]).toMatchObject({ outcome: 'escaped', reason: 'line_snapped' });
  });

  it('o diário alimenta a persistência', () => {
    const s = setup();
    let save = defaultSaveData();
    s.session.onOutcome((entry) => {
      save = recordOutcome(save, entry);
    });
    const entry = playCast(s);
    expect(save.stats.catches).toBe(1);
    expect(save.bestCatch).toEqual({ speciesId: entry.speciesId, weightKg: entry.weightKg, points: entry.points });
  });
});

describe('FishingSession: pausa e retomada', () => {
  it('pausar no recolhimento congela tensão, distância e peixe', () => {
    const s = setup();
    cast(s);
    for (let i = 0; i < MAX_FRAMES && s.session.state !== 'REELING'; i++) {
      if (s.session.state === 'HOOKED') s.session.hook();
      s.frame();
    }
    s.session.setReeling(true);
    for (let i = 0; i < 20; i++) s.frame();
    expect(s.session.pause()).toEqual({ ok: true });
    const snapshot = [s.session.tension, s.session.lineDistanceM, s.session.currentFish?.elapsedMs];
    for (let i = 0; i < 500; i++) s.frame(100);
    expect(s.session.state).toBe('PAUSED');
    expect([s.session.tension, s.session.lineDistanceM, s.session.currentFish?.elapsedMs]).toEqual(snapshot);
    expect(s.session.resume()).toEqual({ ok: true });
    expect(s.session.state).toBe('REELING');
    s.frame(40);
    expect(s.session.tension).toBeGreaterThan(snapshot[0] ?? 0);
  });

  it('pausa durante a espera não deixa o tempo de mordida correr', () => {
    const paused = setup();
    const straight = setup();
    cast(paused);
    cast(straight);
    paused.session.pause();
    paused.frame(60_000);
    paused.session.resume();
    const biteFrame = (s: Setup) => {
      let n = 0;
      while (s.session.state === 'WAITING' && n < MAX_FRAMES) {
        s.frame();
        n++;
      }
      return n;
    };
    expect(biteFrame(paused)).toBe(biteFrame(straight));
  });

  it('pausar cancela a carga do arremesso', () => {
    const s = setup();
    s.session.beginCharge();
    s.session.pause();
    expect(s.session.isCharging).toBe(false);
    s.session.resume();
    expect(s.session.releaseCast().ok).toBe(false);
    expect(s.session.state).toBe('IDLE');
  });
});

describe('FishingSession: bloqueios e reinício', () => {
  it('bloqueia arremesso simultâneo', () => {
    const s = setup();
    expect(s.session.beginCharge().ok).toBe(true);
    expect(s.session.beginCharge().ok).toBe(false);
    s.clock.advance(500);
    expect(s.session.releaseCast().ok).toBe(true);
    expect(s.session.beginCharge().ok).toBe(false);
    expect(s.session.releaseCast().ok).toBe(false);
    expect(s.session.state).toBe('CASTING');
  });

  it('não registra captura dupla', () => {
    const s = setup();
    playCast(s);
    expect(s.session.state).toBe('CAUGHT');
    s.session.setReeling(true);
    for (let i = 0; i < 200; i++) s.frame();
    expect(s.session.hook().ok).toBe(false);
    expect(s.session.journal).toHaveLength(1);
    expect(s.machine.dispatch({ type: 'FISH_LANDED' }).status).toBe('rejected');
  });

  it('fisgar fora da mordida falha', () => {
    const s = setup();
    expect(s.session.hook().ok).toBe(false);
    cast(s);
    expect(s.session.state).toBe('WAITING');
    expect(s.session.hook()).toEqual({ ok: false, reason: 'não há mordida para fisgar' });
  });

  it('recolher a isca sem peixe volta a IDLE', () => {
    const s = setup();
    cast(s);
    expect(s.session.retrieve()).toEqual({ ok: true });
    expect(s.session.state).toBe('IDLE');
    expect(s.session.currentFish).toBeNull();
  });

  it.each(['IDLE', 'WAITING', 'REELING', 'CAUGHT', 'PAUSED'] as const)('reinicia a partir de %s', (target) => {
    const s = setup();
    playCast(s);
    s.session.continue();
    if (target !== 'IDLE') {
      cast(s);
      for (let i = 0; i < MAX_FRAMES && s.session.state !== target; i++) {
        if (s.session.state === 'HOOKED') s.session.hook();
        if (s.session.state === 'REELING') s.session.setReeling(s.session.tension < 0.7);
        if (target === 'PAUSED' && s.session.state === 'WAITING') s.session.pause();
        else s.frame();
      }
    }
    expect(s.session.state).toBe(target);
    expect(s.session.restart()).toEqual({ ok: true });
    expect(s.session.state).toBe('IDLE');
    expect(s.session.score).toBe(0);
    expect(s.session.journal).toEqual([]);
    expect(s.session.currentFish).toBeNull();
    const entry = playCast(s);
    expect(entry.castNumber).toBe(1);
  });

  it('valida a configuração', () => {
    const machine = new GameStateMachine();
    expect(() => new FishingSession(machine, new Rng(1), new ManualClock(), { stepMs: 0 })).toThrow(RangeError);
    expect(() => new FishingSession(machine, new Rng(1), new ManualClock(), { species: [] })).toThrow(RangeError);
  });
});

describe('FishingSession: controles e isca', () => {
  it('setLure troca a isca registrada na captura e rejeita isca desconhecida', () => {
    const s = setup();
    expect(s.session.setLure('spinner')).toEqual({ ok: true });
    expect(s.session.setLure('banana' as never).ok).toBe(false);
    expect(s.session.lureId).toBe('spinner');
    const caught: CaughtFish[] = [];
    s.session.onCatch((fish) => caught.push(fish));
    playCast(s);
    expect(s.session.state).toBe('CAUGHT');
    expect(caught[0]!.lureId).toBe('spinner');
  });

  it('o drag padrão é 60 N e com reelSpeed 0 recolher não puxa linha', () => {
    const s = setup();
    expect(s.session.dragN).toBe(60);
    cast(s);
    for (let i = 0; i < MAX_FRAMES && s.session.state !== 'REELING'; i++) {
      if (s.session.state === 'HOOKED') s.session.hook();
      s.frame();
    }
    expect(s.session.state).toBe('REELING');
    const before = s.session.lineDistanceM;
    s.session.setControls({ reelSpeed: 0, drag: 0.5, rodX: 0, rodY: 0, castYaw: 0 });
    s.session.setReeling(true);
    for (let i = 0; i < 100; i++) s.frame();
    expect(s.session.lineDistanceM).toBe(before);
    expect(s.session.state).toBe('REELING');
  });

  it('setControls limita às faixas e ignora valores não finitos', () => {
    const s = setup();
    s.session.setControls({ reelSpeed: Number.NaN, drag: 5, rodX: -3, rodY: 0.5, castYaw: 0.2 });
    expect(s.session.controls).toEqual({ reelSpeed: 1, drag: 1, rodX: -1, rodY: 0.5, castYaw: 0.2 });
    expect(s.session.dragN).toBe(120);
  });
});

describe('FishingSession: captura e vara', () => {
  it('o peso no evento de captura é o mesmo do indivíduo do spawn', () => {
    const s = setup();
    const caught: CaughtFish[] = [];
    s.session.onCatch((fish) => caught.push(fish));
    let spawnedWeight: number | null = null;
    cast(s);
    for (let i = 0; i < MAX_FRAMES; i++) {
      const { state } = s.session;
      if (state === 'CAUGHT' || state === 'ESCAPED') break;
      if (state === 'HOOKED') {
        spawnedWeight = s.session.currentIndividual?.weightKg ?? null;
        s.session.hook();
      }
      if (state === 'REELING') s.session.setReeling(s.session.tension < 0.7);
      s.frame();
    }
    expect(s.session.state).toBe('CAUGHT');
    expect(caught).toHaveLength(1);
    expect(spawnedWeight).not.toBeNull();
    expect(caught[0]!.individual.weightKg).toBe(spawnedWeight);
    expect(caught[0]!.individual.weightKg).toBe(s.session.journal.at(-1)!.weightKg);
    expect(caught[0]!.lureId).toBe('worm');
    expect(caught[0]!.hour).toBe(12);
  });

  it('a mordida mexe a ponta da vara e a briga a curva', () => {
    const s = setup();
    cast(s);
    let maxWaitingBend = 0;
    let maxFightBend = 0;
    for (let i = 0; i < MAX_FRAMES; i++) {
      const { state } = s.session;
      if (state === 'CAUGHT' || state === 'ESCAPED') break;
      if (state === 'WAITING' || state === 'HOOKED') maxWaitingBend = Math.max(maxWaitingBend, s.session.rodBendRad);
      if (state === 'HOOKED') s.session.hook();
      if (state === 'REELING') {
        s.session.setReeling(s.session.tension < 0.7);
        maxFightBend = Math.max(maxFightBend, s.session.rodBendRad);
      }
      s.frame();
    }
    expect(maxWaitingBend).toBeGreaterThan(0);
    expect(maxFightBend).toBeGreaterThan(maxWaitingBend);
  });
});
