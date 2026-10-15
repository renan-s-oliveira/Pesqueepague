import credits from '../../ASSETS_LICENSES.md?raw';
import { deriveSeed, type GameConfig } from '../config/gameConfig.ts';
import {
  browserStore,
  defaultSaveData,
  loadSave,
  recordOutcome,
  writeSave,
  type SaveData,
  type Settings,
} from '../config/persistence.ts';
import { CatchPresentation } from '../capture/catchPresentation.ts';
import { savePhotoForCatch } from '../capture/photo.ts';
import { TrophyRoom } from '../capture/trophyRoom.ts';
import { DiagnosticsPanel } from '../engine/diagnostics.ts';
import { getSpecies, individualRarity, lengthForWeightCm } from '../fish/species.ts';
import { FishingVisuals } from '../fishing/visuals/fishingVisuals.ts';
import { FishingSession, type CaughtFish } from '../gameplay/fishingSession.ts';
import type { CatchRecord } from '../progression/types.ts';
import { CatchRepository, DEFAULT_LOCATION_ID } from '../save/catchRepository.ts';
import { IndexedDbAdapter } from '../save/storage.ts';
import { LakeScene } from '../scenes/lakeScene.ts';
import { CatchPanel } from '../ui/catchPanel.ts';
import { GameUI } from '../ui/gameUI.ts';
import type { GalleryDataSource } from '../ui/gallery.ts';
import { SystemClock } from '../utils/clock.ts';
import { Rng } from '../utils/rng.ts';
import { PIER } from '../world/layout.ts';
import { InputController, type GameAction } from './input.ts';
import { GameStateMachine } from './stateMachine.ts';

export interface GameRuntime {
  readonly states: GameStateMachine;
  readonly session: FishingSession;
  readonly scene: LakeScene;
  dispose(): void;
}

export function isWebGL2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const SESSION_SEED_SALT = 0x9e3779b9;
const EYE = { x: PIER.x, y: PIER.deckY + 1.6, z: PIER.zEnd + 1 };

/**
 * Só no build `--mode e2e`: acrescenta getDiagnostics aos ganchos de window.__fp. O main.ts publica o
 * objeto __fp depois que bootstrap() resolve, então a extensão espera a próxima tarefa do event loop.
 */
function extendTestHooks(
  lake: LakeScene,
  session: FishingSession,
  repository: CatchRepository | null,
  capture: Record<string, unknown>,
): void {
  setTimeout(() => {
    const w = window as unknown as { __fp?: Record<string, unknown> };
    if (!w.__fp) {
      console.warn('ganchos de teste __fp ausentes: getDiagnostics não foi exposto');
      return;
    }
    w.__fp['getDiagnostics'] = () => lake.getDiagnostics();
    w.__fp['lastOutcome'] = () => session.journal.at(-1) ?? null;
    w.__fp['saveCatch'] = (record: CatchRecord) =>
      repository ? repository.put(record) : Promise.reject(new Error('IndexedDB indisponível: nada foi gravado'));
    w.__fp['getCatch'] = (id: string) => (repository ? repository.get(id) : Promise.resolve(undefined));
    w.__fp['listCatches'] = () => (repository ? repository.list() : Promise.resolve([]));
    Object.assign(w.__fp, capture);
  }, 0);
}

/** Sobe a cena única do lago, o menu sobre ela e o jogo, de BOOT até MENU. */
export async function bootstrap(container: HTMLElement, config: GameConfig): Promise<GameRuntime> {
  if (!isWebGL2Available()) {
    throw new Error('Este navegador não oferece WebGL2. Atualize o navegador ou ative a aceleração de hardware.');
  }
  const store = browserStore();
  let save: SaveData = loadSave(store).data;
  const persist = (): void => {
    const r = writeSave(store, save);
    if (!r.ok) console.warn(r.error);
  };

  // Galeria em IndexedDB; bestCatch e stats do localStorage migram uma única vez.
  // Com o IDB bloqueado ou ausente, o jogo segue com aviso e sem gravar capturas.
  let repository: CatchRepository | null = null;
  try {
    repository = new CatchRepository(await IndexedDbAdapter.open());
    await repository.migrateLegacySave(save);
  } catch (error) {
    repository = null;
    console.warn(`IndexedDB indisponível — o jogo segue sem gravar capturas: ${String(error)}`);
  }

  // Galeria, conquistas e sala de troféus leem do mesmo repositório; sem IDB, a UI mostra o estado indisponível.
  const repo = repository;
  const galleryData: GalleryDataSource | null =
    repo === null
      ? null
      : {
          listCatches: () => repo.list(),
          getPhoto: (id: string) => repo.getPhoto(id),
        };
  let trophyRoom: TrophyRoom | null = null;
  const closeTrophyRoom = (): void => {
    trophyRoom?.dispose();
    trophyRoom = null;
  };

  const states = new GameStateMachine();
  const clock = new SystemClock();
  let ui: GameUI | null = null;
  let input: InputController | null = null;
  let presentation: CatchPresentation | null = null;
  let lastCatchRecordId: string | null = null;
  let lastPhoto: { readonly id: string; readonly size: number } | null = null;
  let catches = 0;
  const countCatches = (): number => session.journal.filter((e) => e.outcome === 'caught').length;

  const handlers = {
    onPlay: () => {
      session.restart();
      catches = countCatches();
      ui?.setJournal(session.journal, save.bestCatch);
      lake.look.setPosition(EYE.x, EYE.y, EYE.z);
      lake.look.setAngles(0, -0.05);
      input?.requestLock();
    },
    onResume: () => {
      session.resume();
      input?.requestLock();
    },
    onQuitToMenu: () => {
      if (states.can('PAUSE') && !states.can('QUIT')) session.pause();
      if (states.can('QUIT')) states.dispatch({ type: 'QUIT' });
      input?.releaseLock();
    },
    onContinue: () => {
      presentation?.dispose();
      presentation = null;
      session.continue();
      input?.requestLock();
    },
    onSettingsChange: (settings: Settings) => applySettings(settings, true),
    onResetSettings: () => applySettings(defaultSaveData().settings, true),
    onOpenTrophyRoom: () => {
      closeTrophyRoom();
      void (async (): Promise<void> => {
        let records: readonly CatchRecord[] = [];
        if (repo !== null) {
          try {
            records = await repo.list();
          } catch (error) {
            console.warn(`sala de troféus sem dados do IndexedDB: ${String(error)}`);
          }
        }
        trophyRoom = new TrophyRoom(container, records, { onClose: closeTrophyRoom });
      })();
    },
  };

  ui = new GameUI(container, handlers, save.settings, credits, galleryData);
  states.dispatch({ type: 'BOOTED' });
  ui.setLoading(0.1, 'Gerando terreno, água e vegetação…');
  await nextFrame();

  const lake = new LakeScene(container, { seed: config.seed, maxPixelRatio: config.maxPixelRatio });
  ui.setLoading(0.6, 'Preparando a vara e os peixes…');
  await nextFrame();

  const session = new FishingSession(states, new Rng(deriveSeed(config.seed, SESSION_SEED_SALT)), clock, {
    hourOfDay: () => lake.timeOfDay.hour,
  });
  const visuals = new FishingVisuals(lake.scene, lake.camera, (x, z, strength) =>
    lake.lake.addRipple(x, z, strength, elapsedNow),
  );
  ui.setLoading(0.85, 'Compilando materiais…');
  await nextFrame();
  lake.engine.renderer.compile(lake.scene, lake.camera);

  function applySettings(settings: Settings, save_: boolean): void {
    lake.setQualityPreset(settings.quality);
    session.setLure(settings.lureId);
    input?.setSensitivity(settings.cameraSensitivity);
    ui?.setSettings(settings);
    if (save_) {
      save = { ...save, settings };
      persist();
    }
  }

  const onAction = (action: GameAction): void => {
    switch (action) {
      case 'beginCharge':
        session.beginCharge();
        break;
      case 'releaseCast':
        session.releaseCast();
        break;
      case 'retrieve':
        session.retrieve();
        break;
      case 'hook':
        session.hook();
        break;
      case 'reelStart':
        session.setReeling(true);
        break;
      case 'reelStop':
        session.setReeling(false);
        break;
      case 'continue':
        handlers.onContinue();
        break;
      case 'pause':
        session.pause();
        input?.releaseLock();
        break;
      case 'resume':
        handlers.onResume();
        break;
      case 'toggleHelp':
        ui?.toggleHelp();
        break;
      case 'none':
        break;
    }
  };

  input = new InputController({
    surface: lake.canvas,
    getState: () => states.state,
    getContext: () => ({ charging: session.isCharging }),
    onAction,
    onLook: (dy, dp) => lake.look.rotate(dy, dp),
    onPlayerAction: (snapshot, action) => {
      if (action.kind === 'reel' && states.state === 'REELING') session.setReeling(snapshot.reeling);
    },
  });
  applySettings(save.settings, false);

  /** Estúdio da captura: o exemplar real em 3D sobre o jogo desfocado, ficha completa e foto. */
  const openCapture = (fish: CaughtFish): void => {
    presentation?.dispose();
    const isRecord = save.bestCatch === null || fish.individual.weightKg >= save.bestCatch.weightKg;
    const panel = new CatchPanel(fish, DEFAULT_LOCATION_ID, isRecord);
    presentation = new CatchPresentation(container, fish, panel.root, {
      onContinue: () => handlers.onContinue(),
      onPhoto: async (blob) => {
        if (repository === null || lastCatchRecordId === null) {
          throw new Error('galeria indisponível: a captura não tem registro para receber a foto');
        }
        const id = await savePhotoForCatch(repository, lastCatchRecordId, blob);
        lastPhoto = { id, size: blob.size };
      },
    });
    void (async (): Promise<void> => {
      const best = save.bestCatch?.weightKg ?? null;
      let biggest = fish.individual.weightKg;
      if (repository !== null) {
        try {
          for (const c of await repository.query({ speciesId: fish.individual.speciesId })) {
            biggest = Math.max(biggest, c.weightKg);
          }
        } catch (error) {
          console.warn(`maior exemplar indisponível: ${String(error)}`);
        }
      }
      panel.setRecords(best, biggest);
    })();
  };
  const offCatch = session.onCatch(openCapture);

  const offOutcome = session.onOutcome((entry) => {
    if (entry.outcome === 'caught' && repository !== null) {
      const species = getSpecies(entry.speciesId);
      const captured: CatchRecord = {
        id: crypto.randomUUID(),
        speciesId: entry.speciesId,
        weightKg: entry.weightKg,
        lengthCm: Math.round(lengthForWeightCm(species, entry.weightKg) * 10) / 10,
        timestamp: Date.now(),
        locationId: DEFAULT_LOCATION_ID,
        lureId: save.settings.lureId,
        rarity: individualRarity(species, entry.weightKg),
        disposition: 'kept',
        isPersonalRecord: save.bestCatch === null || entry.weightKg > save.bestCatch.weightKg,
      };
      lastCatchRecordId = captured.id;
      repository.put(captured).catch((error: unknown) => console.warn(`captura não gravada no IndexedDB: ${String(error)}`));
    }
    save = recordOutcome(save, entry);
    persist();
    catches = countCatches();
    ui?.setJournal(session.journal, save.bestCatch);
    // Captura ganha a tela do estúdio 3D; a tela antiga de resultado fica só para o peixe que escapou.
    if (entry.outcome !== 'caught' || presentation === null) ui?.showOutcome(entry);
    input?.releaseLock();
  });

  let elapsedNow = 0;
  let flightMs = 0;
  let caughtSpecies: (typeof session.journal)[number]['speciesId'] | null = null;
  const offFrame = lake.addFrameHook((dt, elapsed) => {
    elapsedNow = elapsed;
    if (input) session.setControls(input.actions.snapshot);
    session.update();
    const state = states.state;
    if (state === 'MENU') {
      // Câmera cinematográfica do menu sobre a mesma cena.
      lake.look.setPosition(EYE.x + Math.sin(elapsed * 0.07) * 1.5, EYE.y + 1.2, EYE.z + 4);
      lake.look.setAngles(Math.sin(elapsed * 0.09) * 0.6, -0.12);
    }
    flightMs = state === 'CASTING' ? flightMs + dt * 1000 : 0;
    if (state === 'CAUGHT') {
      const last = session.journal.at(-1);
      caughtSpecies = last?.outcome === 'caught' ? last.speciesId : null;
    }
    visuals.setRodVisible(state !== 'MENU');
    const dist = session.lineDistanceM;
    const total = session.currentCast?.distanceM ?? 0;
    visuals.update(
      {
        state,
        chargePower: session.chargePower,
        cast: session.currentCast,
        flightElapsedMs: flightMs,
        lineDistanceM: dist,
        tension: session.tension,
        caughtSpecies,
      },
      dt,
      elapsed,
    );
    ui?.update({
      state,
      chargePower: session.chargePower,
      charging: session.isCharging,
      tension: session.tension,
      progress: dist !== null && total > 0 ? 1 - dist / total : 0,
      catches,
      score: session.score,
    });
  });

  const diagnosticsPanel = new DiagnosticsPanel(container, () => lake.getDiagnostics());

  ui.setLoading(1, 'Pronto!');
  lake.start();
  states.dispatch({ type: 'LOADED' });
  if (import.meta.env.MODE === 'e2e') {
    /** Captura de amostra determinística: leva o teste direto ao estúdio, sem pescar. */
    const sampleCaughtFish = (): CaughtFish => {
      const species = getSpecies('tilapia');
      const weightKg = 0.9;
      return {
        individual: {
          speciesId: species.id,
          lengthCm: Math.round(lengthForWeightCm(species, weightKg) * 10) / 10,
          weightKg,
          rarity: individualRarity(species, weightKg),
          color: { hueShiftDeg: 3, lightnessShift: 0.02, spotSeed: 123456 },
        },
        lureId: 'worm',
        location: { distanceM: 12 },
        hour: 17.5,
      };
    };
    extendTestHooks(lake, session, repository, {
      openCapture: async (): Promise<void> => {
        const fish = sampleCaughtFish();
        if (repository !== null) {
          const record: CatchRecord = {
            id: `captura-e2e-${Date.now()}`,
            speciesId: fish.individual.speciesId,
            weightKg: fish.individual.weightKg,
            lengthCm: fish.individual.lengthCm,
            timestamp: Date.now(),
            locationId: DEFAULT_LOCATION_ID,
            lureId: fish.lureId,
            rarity: fish.individual.rarity,
            disposition: 'kept',
            isPersonalRecord: save.bestCatch === null || fish.individual.weightKg > save.bestCatch.weightKg,
          };
          await repository.put(record);
          lastCatchRecordId = record.id;
        }
        openCapture(fish);
      },
      captureOpen: () => presentation !== null,
      lastPhoto: () => lastPhoto,
      lastCatchRecord: () =>
        repository !== null && lastCatchRecordId !== null ? repository.get(lastCatchRecordId) : Promise.resolve(undefined),
    });
  }

  return {
    states,
    session,
    scene: lake,
    dispose(): void {
      offFrame();
      offCatch();
      offOutcome();
      closeTrophyRoom();
      presentation?.dispose();
      diagnosticsPanel.dispose();
      input?.dispose();
      visuals.dispose();
      ui?.dispose();
      repository?.close();
      lake.dispose();
    },
  };
}
