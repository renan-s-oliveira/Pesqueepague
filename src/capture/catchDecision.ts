import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { getSpecies, individualRarity, lengthForWeightCm, type SpeciesId } from '../fish/species.ts';
import { FishModel } from '../fish/visual/fishModel.ts';
import type { CaughtFish } from '../gameplay/fishingSession.ts';
import {
  evaluateAchievements,
  isNewPersonalRecord,
  newlyUnlocked,
  type AchievementId,
} from '../progression/achievements.ts';
import { evaluateKeep, releaseReward, type InventoryState } from '../progression/inventory.ts';
import type { CatchDisposition, CatchRecord } from '../progression/types.ts';
import { CatchRepository, DEFAULT_LOCATION_ID } from '../save/catchRepository.ts';
import { IndexedDbAdapter } from '../save/storage.ts';
import { FishInspection } from './fishInspection.ts';
import { formatWeighingKg, PLATFORM_TOP_Y, WeighingScale } from './weighingSystem.ts';

/** Nomes das conquistas como o jogador lê no toast. */
export const ACHIEVEMENT_LABELS: Readonly<Record<AchievementId, string>> = {
  first_fish: 'Primeiro peixe',
  over_1kg: 'Mais de 1 kg',
  over_5kg: 'Mais de 5 kg',
  over_10kg: 'Mais de 10 kg',
  ten_species: 'Dez espécies diferentes',
  catches_50: '50 capturas',
  catches_100: '100 capturas',
  first_rare: 'Primeiro raro',
  first_legendary: 'Primeiro lendário',
  personal_record: 'Recorde pessoal',
  sport_master: 'Mestre da pesca esportiva',
};

/** Duração da animação de devolução ao lago (prefers-reduced-motion pula). */
export const RELEASE_ANIMATION_MS = 700;
/** Quanto tempo um toast fica na tela. */
const TOAST_MS = 6000;

export interface CatchDecisionHandlers {
  /** Galeria; null segue sem gravar (o jogador é avisado ao tentar guardar). */
  readonly repository: CatchRepository | null;
  readonly locationId: string;
  /** Chamado ao fim da decisão, com o registro criado (persistido quando há galeria). */
  readonly onFinish: (record: CatchRecord) => void;
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

function button(text: string, testId: string, onClick: () => void, cls = 'ui-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Pesagem e decisão da captura: a balança digital 3D procedural pesa o exemplar com a
 * oscilação amortecida de WeighingScale e, estável a leitura, o jogador decide —
 * SOLTAR (devolução animada, registro released e recompensa), GUARDAR (passa pelas regras
 * do viveiro em progression/inventory e mostra o motivo da recusa) ou VER DETALHES
 * (inspeção por FishInspection). Persistência pelo catchRepository; conquistas novas
 * viram toast que sobrevive ao fechamento da tela.
 */
export class CatchDecisionScreen {
  readonly root: HTMLElement;
  readonly inspection: FishInspection;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly scale: WeighingScale;
  private readonly model: FishModel;
  private readonly canvas: HTMLCanvasElement;
  private readonly readingEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly releaseBtn: HTMLButtonElement;
  private readonly keepBtn: HTMLButtonElement;
  private readonly detailsBtn: HTMLButtonElement;
  private readonly reducedMotion: boolean;
  private raf = 0;
  private lastT: number | null = null;
  private lastReading = '';
  private decisionsEnabled = false;
  private deciding = false;
  private releaseStartMs: number | null = null;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly fish: CaughtFish,
    private readonly handlers: CatchDecisionHandlers,
  ) {
    this.reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const f = fish.individual;
    const species = getSpecies(f.speciesId);
    const lengthM = Math.max(0.05, f.lengthCm / 100);

    // Balança + o mesmo exemplar (semente e cor do indivíduo), recém-saído da água.
    this.scale = new WeighingScale(f.weightKg, { instant: this.reducedMotion });
    this.model = new FishModel(f.speciesId, { seed: f.color.spotSeed >>> 0, lengthM, color: f.color });
    this.model.setWetness(0.6);
    this.scale.attachFish(this.model.root, lengthM);
    this.scene.add(this.scale.root);

    const key = new DirectionalLight(0xfff0d8, 2.2);
    key.position.set(1.4, 2.0, 2.2);
    const fill = new DirectionalLight(0xbcd7ff, 0.8);
    fill.position.set(-2.0, 0.8, 1.2);
    const rim = new DirectionalLight(0xffffff, 1.6);
    rim.position.set(-0.3, 1.4, -2.4);
    this.scene.add(key, fill, rim, new AmbientLight(0x404a52, 0.7));

    this.camera = new PerspectiveCamera(40, 1, 0.01, 50);
    const dist = Math.max(0.85, lengthM * 2.6);
    this.camera.position.set(Math.sin(0.85) * dist, PLATFORM_TOP_Y + 0.4, Math.cos(0.85) * dist);
    this.camera.lookAt(0, PLATFORM_TOP_Y + 0.08, 0);

    // DOM: tela sobre o jogo com visor acessível, status e as três ações.
    this.root = document.createElement('section');
    this.root.className = 'capture-screen weighing-screen';
    this.root.dataset['testid'] = 'weighing-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', `Pesagem do ${species.name}`);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'capture-canvas';
    this.canvas.setAttribute(
      'aria-label',
      'Balança digital em 3D com o exemplar; arraste para girar, role para aproximar',
    );

    const panel = document.createElement('div');
    panel.className = 'panel weighing-panel';
    const title = document.createElement('h2');
    title.textContent = `Pesagem — ${species.name}`;
    this.readingEl = document.createElement('p');
    this.readingEl.className = 'weighing-reading';
    this.readingEl.dataset['testid'] = 'weighing-reading';
    this.readingEl.setAttribute('aria-live', 'polite');
    this.readingEl.textContent = formatWeighingKg(0);
    this.statusEl = document.createElement('p');
    this.statusEl.className = 'capture-status';
    this.statusEl.dataset['testid'] = 'weighing-status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'assertive');
    this.statusEl.textContent = 'Pesando… aguarde a leitura estabilizar.';
    panel.append(title, this.readingEl, this.statusEl);

    const actions = document.createElement('div');
    actions.className = 'capture-actions';
    this.releaseBtn = button('Soltar o peixe', 'weighing-release', () => this.onRelease(), 'ui-btn primary');
    this.keepBtn = button('Guardar no viveiro', 'weighing-keep', () => void this.onKeep());
    this.detailsBtn = button('Ver detalhes', 'weighing-details', () => this.toggleDetails());
    this.detailsBtn.setAttribute('aria-pressed', 'false');
    this.releaseBtn.disabled = true;
    this.keepBtn.disabled = true;
    actions.append(this.releaseBtn, this.keepBtn, this.detailsBtn);

    this.root.append(this.canvas, panel, actions);
    container.appendChild(this.root);

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.inspection = new FishInspection(this.camera, this.canvas, {
      target: new Vector3(0, PLATFORM_TOP_Y + 0.08, 0),
      fishLengthM: lengthM,
    });
    this.inspection.setEnabled(true);

    this.detailsBtn.focus();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** VER DETALHES: alterna o modo de inspeção aproximada (FishInspection), com estado acessível. */
  private toggleDetails(): void {
    const on = !this.inspection.detailMode;
    this.inspection.setDetailMode(on);
    this.detailsBtn.setAttribute('aria-pressed', String(on));
    this.detailsBtn.classList.toggle('active', on);
  }

  /** SOLTAR: devolução animada e, ao fim dela, registro released com recompensa. */
  private onRelease(): void {
    if (this.deciding || !this.decisionsEnabled) return;
    this.deciding = true;
    this.releaseBtn.disabled = true;
    this.keepBtn.disabled = true;
    this.setStatus('Devolvendo o peixe ao lago…');
    if (this.reducedMotion) void this.finalize('released');
    else this.releaseStartMs = performance.now();
  }

  /** GUARDAR: as regras do viveiro decidem; recusa mostra o motivo e deixa a tela aberta. */
  private async onKeep(): Promise<void> {
    if (this.deciding || !this.decisionsEnabled) return;
    if (this.handlers.repository === null) {
      this.setStatus('A galeria está indisponível agora: não dá para guardar. Você ainda pode soltar o peixe.');
      return;
    }
    this.deciding = true;
    this.releaseBtn.disabled = true;
    this.keepBtn.disabled = true;
    try {
      const existing = await this.handlers.repository.list();
      const f = this.fish.individual;
      const state: InventoryState = {
        stored: existing.filter((r) => r.disposition === 'kept'),
        history: existing,
      };
      const decision = evaluateKeep(
        { speciesId: f.speciesId, weightKg: f.weightKg, lengthCm: f.lengthCm, timestamp: Date.now() },
        state,
      );
      if (!decision.allowed) {
        this.setStatus(decision.message);
        this.deciding = false;
        this.releaseBtn.disabled = false;
        this.keepBtn.disabled = false;
        return;
      }
      await this.finalize('kept', existing);
    } catch (error) {
      this.setStatus('Não foi possível guardar agora. Tente de novo ou solte o peixe.');
      console.warn(`guardar falhou: ${String(error)}`);
      this.deciding = false;
      this.releaseBtn.disabled = false;
      this.keepBtn.disabled = false;
    }
  }

  /** Grava o registro, avalia conquistas (toast) e fecha a tela. */
  private async finalize(disposition: CatchDisposition, listed?: readonly CatchRecord[]): Promise<void> {
    const repo = this.handlers.repository;
    let existing: readonly CatchRecord[] = listed ?? [];
    if (repo !== null && listed === undefined) {
      try {
        existing = await repo.list();
      } catch (error) {
        console.warn(`lista de capturas indisponível: ${String(error)}`);
      }
    }
    const f = this.fish.individual;
    const record: CatchRecord = {
      id: crypto.randomUUID(),
      speciesId: f.speciesId,
      weightKg: f.weightKg,
      lengthCm: f.lengthCm,
      timestamp: Date.now(),
      locationId: this.handlers.locationId,
      lureId: this.fish.lureId,
      rarity: f.rarity,
      disposition,
      isPersonalRecord: isNewPersonalRecord(f, existing),
    };
    if (repo !== null) {
      try {
        await repo.put(record);
        const unlocked = newlyUnlocked(evaluateAchievements(existing), evaluateAchievements([...existing, record]));
        for (const id of unlocked) await repo.unlock(id, record.timestamp);
        if (unlocked.length > 0) {
          this.toast('achievement-toast', `Conquista desbloqueada: ${unlocked.map((id) => ACHIEVEMENT_LABELS[id]).join(', ')}`);
        }
      } catch (error) {
        console.warn(`captura não gravada no IndexedDB: ${String(error)}`);
      }
    }
    if (disposition === 'released') {
      const reward = releaseReward({ speciesId: f.speciesId, weightKg: f.weightKg });
      this.toast('release-toast', `Peixe devolvido ao lago. +${reward} pontos pela soltura.`);
    }
    const finish = this.handlers.onFinish;
    this.dispose();
    finish(record);
  }

  /** Toast fora do root da tela: sobrevive ao fechamento e some sozinho. */
  private toast(testId: string, text: string): void {
    const t = document.createElement('div');
    t.className = 'game-toast';
    t.dataset['testid'] = testId;
    t.setAttribute('role', 'status');
    t.textContent = text;
    t.style.cssText =
      'position:fixed;left:50%;bottom:2rem;transform:translateX(-50%);background:#14301f;color:#eafbe7;' +
      'padding:0.75rem 1.25rem;border-radius:0.5rem;border:1px solid #2f7a4a;z-index:60;max-width:90vw;';
    this.container.appendChild(t);
    setTimeout(() => t.remove(), TOAST_MS);
  }

  private setStatus(text: string): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  private enableDecisions(): void {
    this.decisionsEnabled = true;
    this.releaseBtn.disabled = false;
    this.keepBtn.disabled = false;
    this.setStatus('Peso confirmado. Solte o peixe ou guarde no viveiro.');
  }

  private resize(): void {
    const w = this.root.clientWidth || 1;
    const h = this.root.clientHeight || 1;
    if (this.canvas.clientWidth !== w || this.canvas.clientHeight !== h || this.camera.aspect !== w / h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    // dt real, sem teto: em máquina lenta a balança estabiliza pelo relógio, não pelo frame,
    // e o jogador não fica esperando botões que nunca habilitam.
    const dtMs = this.lastT === null ? 16 : Math.max(0, now - this.lastT);
    this.lastT = now;
    this.resize();

    const kg = this.scale.update(dtMs / 1000);
    const text = formatWeighingKg(this.scale.reading.stable ? this.scale.reading.targetKg : kg);
    if (text !== this.lastReading) {
      this.readingEl.textContent = text;
      this.lastReading = text;
    }
    if (!this.decisionsEnabled && this.scale.reading.stable && !this.deciding) this.enableDecisions();

    if (this.releaseStartMs !== null) {
      const t = Math.min(1, (now - this.releaseStartMs) / RELEASE_ANIMATION_MS);
      const e = smoothstep(t);
      const fishRoot = this.model.root;
      fishRoot.position.x = -1.1 * e;
      fishRoot.position.y = this.scale.fishRestHeight + 0.3 * Math.sin(Math.PI * e) - 0.55 * e;
      fishRoot.rotation.z = -0.5 * e;
      if (t >= 1) {
        this.releaseStartMs = null;
        void this.finalize('released');
      }
    }

    this.inspection.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.inspection.dispose();
    this.scale.dispose();
    this.model.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}

/** Exemplar determinístico para o e2e: tilápia guardável ou tucunaré protegido (recusa). */
function sampleFish(speciesId: SpeciesId): CaughtFish {
  const species = getSpecies(speciesId);
  const weightKg = speciesId === 'tucunare' ? 1.2 : 0.9;
  return {
    individual: {
      speciesId,
      lengthCm: Math.round(lengthForWeightCm(species, weightKg) * 10) / 10,
      weightKg,
      rarity: individualRarity(species, weightKg),
      color: { hueShiftDeg: 3, lightnessShift: 0.02, spotSeed: 123456 },
    },
    lureId: speciesId === 'tucunare' ? 'spinner' : 'worm',
    location: { distanceM: 12 },
    hour: 17.5,
  };
}

/**
 * Só no build `--mode e2e`: ganchos __fp.openWeighing/weighingOpen/lastDecision para o teste
 * chegar direto à pesagem. Espera o main.ts publicar window.__fp (polling curto).
 */
export function installWeighingTestHooks(container: HTMLElement): void {
  let screen: CatchDecisionScreen | null = null;
  let lastRecord: CatchRecord | null = null;
  let repoPromise: Promise<CatchRepository | null> | null = null;
  const repo = (): Promise<CatchRepository | null> => {
    repoPromise ??= IndexedDbAdapter.open()
      .then((db) => new CatchRepository(db))
      .catch((error: unknown) => {
        console.warn(`IndexedDB indisponível para a pesagem: ${String(error)}`);
        return null;
      });
    return repoPromise;
  };
  const install = (tries: number): void => {
    const w = window as unknown as { __fp?: Record<string, unknown> };
    if (w.__fp === undefined) {
      if (tries > 0) setTimeout(() => install(tries - 1), 50);
      return;
    }
    w.__fp['openWeighing'] = async (speciesId?: string): Promise<void> => {
      const repository = await repo();
      screen?.dispose();
      screen = new CatchDecisionScreen(container, sampleFish(speciesId === 'tucunare' ? 'tucunare' : 'tilapia'), {
        repository,
        locationId: DEFAULT_LOCATION_ID,
        onFinish: (record) => {
          lastRecord = record;
          screen = null;
        },
      });
    };
    w.__fp['weighingOpen'] = (): boolean => screen !== null;
    w.__fp['lastDecision'] = (): CatchRecord | null => lastRecord;
  };
  setTimeout(() => install(200), 0);
}
