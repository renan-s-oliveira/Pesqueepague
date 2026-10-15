import { describe, expect, it } from 'vitest';
import { Bone, Object3D } from 'three';
import {
  FISH_ANIM_STATES,
  FISH_ANIM_STEP_MS,
  FISH_CLIPS,
  FishAnimator,
  rigFromFishModel,
  type FishAnimState,
  type FishRig,
} from './fishAnimator.ts';
import { FishModel } from './fishModel.ts';

function makeRig(): FishRig {
  const spine: Bone[] = [];
  for (let i = 0; i < 6; i++) {
    const b = new Bone();
    spine[i - 1]?.add(b);
    spine.push(b);
  }
  const pectoralL = new Object3D();
  const pectoralR = new Object3D();
  pectoralL.rotation.set(-0.9, 0.35, 0);
  pectoralR.rotation.set(0.9, -0.35, 0);
  return { spine, jaw: new Bone(), opercleL: new Bone(), opercleR: new Bone(), pectoralL, pectoralR };
}

function tail(rig: FishRig): number {
  return rig.spine[rig.spine.length - 1]!.rotation.y;
}

/** Ângulo da cauda a cada passo fixo, por `seconds` segundos. */
function tailSeries(anim: FishAnimator, rig: FishRig, seconds: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seconds * (1000 / FISH_ANIM_STEP_MS); i++) {
    anim.update(FISH_ANIM_STEP_MS);
    out.push(tail(rig));
  }
  return out;
}

const EXPECTED_STATES: readonly FishAnimState[] = [
  'slowSwim',
  'fastSwim',
  'approach',
  'bite',
  'hookReaction',
  'flee',
  'resist',
  'outOfWater',
  'releaseSwim',
];

describe('FishAnimator', () => {
  it('tem os 9 estados do pedido, cada um com clipe próprio', () => {
    expect([...FISH_ANIM_STATES].sort()).toEqual([...EXPECTED_STATES].sort());
    const signatures = new Set(FISH_ANIM_STATES.map((s) => JSON.stringify(FISH_CLIPS[s].params)));
    expect(signatures.size).toBe(9);
  });

  it.each(EXPECTED_STATES)('entra no estado %s com mistura suave e pose finita', (state) => {
    const rig = makeRig();
    const initialState: FishAnimState = state === 'resist' ? 'flee' : 'resist';
    const anim = new FishAnimator(rig, { seed: 11, initialState });
    const twinRig = makeRig();
    const twin = new FishAnimator(twinRig, { seed: 11, initialState });
    tailSeries(anim, rig, 1);
    tailSeries(twin, twinRig, 1);
    anim.setState(state);
    expect(anim.state).toBe(state);
    expect(anim.blendWeight).toBe(0);
    anim.update(FISH_ANIM_STEP_MS);
    twin.update(FISH_ANIM_STEP_MS);
    // Um passo depois da troca, a pose ainda está perto da de quem seguiu no estado anterior.
    expect(Math.abs(tail(rig) - tail(twinRig))).toBeLessThan(0.06);
    const weights: number[] = [];
    for (let i = 0; i < 10; i++) {
      weights.push(anim.blendWeight);
      anim.update(FISH_ANIM_STEP_MS);
    }
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]!);
    const series = tailSeries(anim, rig, 0.4);
    for (const v of series) expect(Number.isFinite(v)).toBe(true);
    expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(0.01);
    const target = FISH_CLIPS[state];
    if (target.durationS === undefined) {
      tailSeries(anim, rig, 1);
      expect(anim.blendWeight).toBe(1);
      expect(anim.params).toEqual(target.params);
    }
  });

  it('mordida volta à aproximação e a reação à fisgada passa para fuga sozinhas', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 3, initialState: 'approach' });
    anim.setState('bite');
    tailSeries(anim, rig, FISH_CLIPS.bite.durationS! + 0.05);
    expect(anim.state).toBe('approach');
    anim.setState('hookReaction');
    tailSeries(anim, rig, FISH_CLIPS.hookReaction.durationS! + 0.05);
    expect(anim.state).toBe('flee');
  });

  it('ao soltar, nada de volta e depois assume o nado lento', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 5, initialState: 'outOfWater' });
    anim.setState('releaseSwim');
    tailSeries(anim, rig, 1);
    expect(anim.state).toBe('releaseSwim');
    tailSeries(anim, rig, FISH_CLIPS.releaseSwim.durationS!);
    expect(anim.state).toBe('slowSwim');
  });

  it('repetir o estado atual não reinicia a mistura', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 9 });
    anim.setState('resist');
    tailSeries(anim, rig, 0.2);
    const w = anim.blendWeight;
    anim.setState('resist');
    expect(anim.blendWeight).toBe(w);
  });

  it('nado rápido tem cauda mais ampla e mais rápida que o lento', () => {
    const measure = (state: FishAnimState): { range: number; crossings: number } => {
      const rig = makeRig();
      const anim = new FishAnimator(rig, { seed: 21, initialState: state });
      const s = tailSeries(anim, rig, 4);
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      let crossings = 0;
      for (let i = 1; i < s.length; i++) if ((s[i - 1]! - mean) * (s[i]! - mean) < 0) crossings++;
      return { range: Math.max(...s) - Math.min(...s), crossings };
    };
    const slow = measure('slowSwim');
    const fast = measure('fastSwim');
    expect(fast.range).toBeGreaterThan(slow.range);
    expect(fast.crossings).toBeGreaterThan(slow.crossings);
  });

  it('avança só em passo fixo: o mesmo tempo em frames diferentes dá a mesma pose', () => {
    const rigA = makeRig();
    const rigB = makeRig();
    const a = new FishAnimator(rigA, { seed: 77 });
    const b = new FishAnimator(rigB, { seed: 77 });
    for (let i = 0; i < 100; i++) a.update(FISH_ANIM_STEP_MS);
    for (let i = 0; i < 40; i++) b.update(FISH_ANIM_STEP_MS * 2.5);
    expect(a.elapsedS).toBeCloseTo(b.elapsedS, 9);
    expect(tail(rigA)).toBeCloseTo(tail(rigB), 9);
  });

  it('a mesma semente repete o movimento; sementes diferentes não ficam em fase', () => {
    const rigs = [makeRig(), makeRig(), makeRig()];
    const [a, b, c] = [
      new FishAnimator(rigs[0]!, { seed: 1 }),
      new FishAnimator(rigs[1]!, { seed: 1 }),
      new FishAnimator(rigs[2]!, { seed: 2 }),
    ];
    const sa = tailSeries(a, rigs[0]!, 3);
    const sb = tailSeries(b, rigs[1]!, 3);
    const sc = tailSeries(c, rigs[2]!, 3);
    expect(sa).toEqual(sb);
    const maxDiff = Math.max(...sa.map((v, i) => Math.abs(v - sc[i]!)));
    expect(maxDiff).toBeGreaterThan(0.05);
  });

  it('o ruído evita ciclo exato: a cauda não se repete após um período nominal', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 4, initialState: 'resist' });
    const s = tailSeries(anim, rig, 6);
    const half = s.length / 2;
    const repeated = s.slice(0, half).every((v, i) => Math.abs(v - s[i + half]!) < 1e-6);
    expect(repeated).toBe(false);
  });

  it('nadadeiras peitorais se movem de forma independente e a boca/guelras respiram', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 8, initialState: 'approach' });
    const l: number[] = [];
    const r: number[] = [];
    const jaw: number[] = [];
    const gill: number[] = [];
    for (let i = 0; i < 150; i++) {
      anim.update(FISH_ANIM_STEP_MS);
      l.push(rig.pectoralL!.rotation.y - 0.35);
      r.push(-(rig.pectoralR!.rotation.y + 0.35));
      jaw.push(rig.jaw.rotation.z);
      gill.push(rig.opercleR.rotation.y);
    }
    expect(Math.max(...l.map((v, i) => Math.abs(v - r[i]!)))).toBeGreaterThan(0.05);
    expect(Math.max(...jaw) - Math.min(...jaw)).toBeGreaterThan(0.05);
    expect(Math.max(...gill) - Math.min(...gill)).toBeGreaterThan(0.1);
    expect(Math.max(...jaw)).toBeLessThan(0);
    // A rotação de repouso das nadadeiras é preservada (o animador soma por cima).
    expect(rig.pectoralL!.rotation.x).toBeCloseTo(-0.9, 9);
  });

  it('mudar de direção curva o corpo para dentro da curva', () => {
    const rig = makeRig();
    const anim = new FishAnimator(rig, { seed: 12 });
    const meanBend = (): number => {
      let sum = 0;
      const steps = 200;
      for (let i = 0; i < steps; i++) {
        anim.update(FISH_ANIM_STEP_MS);
        for (let j = 1; j < rig.spine.length; j++) sum += rig.spine[j]!.rotation.y;
      }
      return sum / steps;
    };
    const straight = meanBend();
    anim.setTurnRate(2);
    const turning = meanBend();
    anim.setTurnRate(-2);
    const other = meanBend();
    expect(turning).toBeGreaterThan(straight + 0.2);
    expect(other).toBeLessThan(straight - 0.2);
  });

  it('valida entradas', () => {
    const rig = makeRig();
    expect(() => new FishAnimator({ ...rig, spine: [new Bone()] }, { seed: 1 })).toThrow(RangeError);
    expect(() => new FishAnimator(rig, { seed: 1, fixedDtMs: 0 })).toThrow(RangeError);
    const anim = new FishAnimator(rig, { seed: 1 });
    expect(() => anim.update(Number.NaN)).toThrow(RangeError);
    expect(() => anim.setSpeedScale(-1)).toThrow(RangeError);
    expect(() => anim.setTurnRate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => anim.setState('dance' as FishAnimState)).toThrow(RangeError);
  });

  it('anima os ossos de um FishModel de verdade', () => {
    const model = new FishModel('tucunare', { seed: 31 });
    const rig = rigFromFishModel(model);
    expect(rig.spine).toHaveLength(6);
    expect(rig.pectoralL).not.toBeNull();
    expect(rig.pectoralR).not.toBeNull();
    expect(rig.pectoralL!.position.z).toBeLessThan(0);
    const anim = new FishAnimator(rig, { seed: 31, initialState: 'outOfWater' });
    const s = tailSeries(anim, rig, 1);
    expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(0.2);
    expect(rig.spine[0]!.rotation.x).not.toBe(0);
    model.dispose();
  });
});
