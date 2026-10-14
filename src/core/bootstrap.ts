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
import { FishingVisuals } from '../fishing/visuals/fishingVisuals.ts';
import { FishingSession } from '../gameplay/fishingSession.ts';
import { LakeScene } from '../scenes/lakeScene.ts';
import { GameUI } from '../ui/gameUI.ts';
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

  const states = new GameStateMachine();
  const clock = new SystemClock();
  let ui: GameUI | null = null;
  let input: InputController | null = null;
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
      session.continue();
      input?.requestLock();
    },
    onSettingsChange: (settings: Settings) => applySettings(settings, true),
    onResetSettings: () => applySettings(defaultSaveData().settings, true),
  };

  ui = new GameUI(container, handlers, save.settings, credits);
  states.dispatch({ type: 'BOOTED' });
  ui.setLoading(0.1, 'Gerando terreno, água e vegetação…');
  await nextFrame();

  const lake = new LakeScene(container, { seed: config.seed, maxPixelRatio: config.maxPixelRatio });
  ui.setLoading(0.6, 'Preparando a vara e os peixes…');
  await nextFrame();

  const session = new FishingSession(states, new Rng(deriveSeed(config.seed, SESSION_SEED_SALT)), clock);
  const visuals = new FishingVisuals(lake.scene, lake.camera, (x, z, strength) =>
    lake.lake.addRipple(x, z, strength, elapsedNow),
  );
  ui.setLoading(0.85, 'Compilando materiais…');
  await nextFrame();
  lake.engine.renderer.compile(lake.scene, lake.camera);

  function applySettings(settings: Settings, save_: boolean): void {
    lake.setQualityPreset(settings.quality);
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
        session.continue();
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
  });
  applySettings(save.settings, false);

  const offOutcome = session.onOutcome((entry) => {
    save = recordOutcome(save, entry);
    persist();
    catches = countCatches();
    ui?.setJournal(session.journal, save.bestCatch);
    ui?.showOutcome(entry);
    input?.releaseLock();
  });

  let elapsedNow = 0;
  let flightMs = 0;
  let caughtSpecies: (typeof session.journal)[number]['speciesId'] | null = null;
  const offFrame = lake.addFrameHook((dt, elapsed) => {
    elapsedNow = elapsed;
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

  ui.setLoading(1, 'Pronto!');
  lake.start();
  states.dispatch({ type: 'LOADED' });

  return {
    states,
    session,
    scene: lake,
    dispose(): void {
      offFrame();
      offOutcome();
      input?.dispose();
      visuals.dispose();
      ui?.dispose();
      lake.dispose();
    },
  };
}
