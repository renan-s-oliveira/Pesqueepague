import './styles/game.css';
import { CanvasTexture } from 'three';
import { TextureProvider } from './assets/textures.ts';
import { AudioManager } from './audio/AudioManager.ts';
import { wireGameAudio } from './audio/gameAudio.ts';
import { DEFAULT_CONFIG, parseGameConfig, type GameConfig } from './config/gameConfig.ts';
import { browserStore, loadSave, type Quality } from './config/persistence.ts';
import { bootstrap, type GameRuntime } from './core/bootstrap.ts';

const container = document.querySelector<HTMLElement>('#app');
if (!container) throw new Error('Elemento #app não encontrado no index.html');

function showFatal(error: unknown): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  const msg = document.createElement('p');
  msg.textContent = error instanceof Error ? error.message : 'Não foi possível iniciar o jogo.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'ui-btn primary';
  retry.textContent = 'Tentar de novo';
  retry.addEventListener('click', () => location.reload());
  box.append(msg, retry);
  container?.replaceChildren(box);
  console.error(error);
}

/** Só no build `--mode e2e`: no build de produção este ramo some e a query string é ignorada. */
const E2E = import.meta.env.MODE === 'e2e';

/** Seed via ?seed= e relógio manual via ?clock=manual, ambos validados; só em modo de teste. */
function testConfig(params: URLSearchParams): GameConfig {
  const seed = params.get('seed');
  return parseGameConfig(seed === null ? undefined : { seed: Number(seed) });
}

interface ManualClock {
  advance(ms: number): void;
  /** Congela o tempo do jogo (o real continua) para o teste agir dentro de janelas curtas, como a da fisgada. */
  setFrozen(frozen: boolean): void;
}

function installManualClock(): ManualClock {
  const base = performance.now.bind(performance);
  let offset = 0;
  let frozenAt: number | null = null;
  performance.now = () => frozenAt ?? base() + offset;
  return {
    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`advance() exige ms >= 0; recebido: ${String(ms)}`);
      if (frozenAt === null) offset += ms;
      else frozenAt += ms;
    },
    setFrozen(frozen: boolean): void {
      if (frozen && frozenAt === null) frozenAt = base() + offset;
      else if (!frozen && frozenAt !== null) {
        offset = frozenAt - base();
        frozenAt = null;
      }
    },
  };
}

function exposeTestHooks(game: GameRuntime, clock: ManualClock | null): void {
  const manual = (): ManualClock => {
    if (clock === null) throw new Error('Abra com ?clock=manual para controlar o relógio.');
    return clock;
  };
  const hooks = {
    state: () => game.states.state,
    tension: () => game.session.tension,
    catches: () => game.session.journal.filter((e) => e.outcome === 'caught').length,
    advance: (ms: number) => manual().advance(ms),
    freeze: (frozen: boolean) => manual().setFrozen(frozen === true),
    setQuality: (quality: Quality) => game.scene.setQualityPreset(quality),
    /** Pede uma textura registrada que não existe; o fallback procedural tem de continuar no lugar. */
    probeAssetFallback: (path: string) => {
      const provider = new TextureProvider({ probe: path });
      const texture = provider.get('probe', () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 4;
        return new CanvasTexture(canvas);
      });
      return () => texture.image instanceof HTMLCanvasElement;
    },
  };
  Object.assign(window, { __fp: hooks });
}

/**
 * No Chromium headless o pointer lock entra e sai sozinho, e a saída vira pausa no meio da pesca.
 * Com ?pointerlock=off o pedido é recusado como num navegador sem suporte: o jogo segue sem olhar livre.
 */
function disablePointerLock(): void {
  Element.prototype.requestPointerLock = function requestPointerLock(): Promise<void> {
    return Promise.reject(new DOMException('pointer lock desligado no modo e2e', 'NotSupportedError'));
  };
}

const params = new URLSearchParams(location.search);
if (E2E && params.get('pointerlock') === 'off') disablePointerLock();
const manualClock = E2E && params.get('clock') === 'manual' ? installManualClock() : null;
const config = E2E ? testConfig(params) : DEFAULT_CONFIG;

bootstrap(container, config).then((game) => {
  const audio = new AudioManager({ seed: config.seed, volumes: loadSave(browserStore()).data.volumes });
  audio.attachUnlock(window);
  const offAudio = wireGameAudio(game.states, audio);
  const offLegendaryAudio = game.session.onLegendary(() => audio.startLoop('legendaryMusic'));
  const startOpeningMusic = (): void => audio.startLoop('legendaryMusic');
  const finishOpeningMusic = (): void => { if (!game.session.legendaryActive) audio.stopLoop('legendaryMusic'); };
  container.addEventListener('cinematic-start', startOpeningMusic);
  container.addEventListener('cinematic-end', finishOpeningMusic);
  const offEncounterAudio = game.states.onTransition((_from, to) => {
    if (to === 'MENU' || to === 'CAUGHT' || to === 'ESCAPED' || to === 'IDLE') audio.stopLoop('legendaryMusic');
  });
  const updateVolumes = (event: Event): void => audio.setVolumes((event as CustomEvent).detail);
  container.addEventListener('game-volumes', updateVolumes);
  if (game.states.state === 'MENU') audio.setMenuMusic(true);
  if (E2E) {
    exposeTestHooks(game, manualClock);
    Object.assign((window as unknown as { __fp: object }).__fp, { legendaryMusic: () => audio.isLoopPlaying('legendaryMusic') });
  }
  window.addEventListener(
    'pagehide',
    () => {
      offAudio();
      offLegendaryAudio();
      container.removeEventListener('cinematic-start', startOpeningMusic);
      container.removeEventListener('cinematic-end', finishOpeningMusic);
      offEncounterAudio();
      container.removeEventListener('game-volumes', updateVolumes);
      void audio.dispose();
      game.dispose();
    },
    { once: true },
  );
}, showFatal);
