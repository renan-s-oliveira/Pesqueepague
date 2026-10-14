import type { GameState } from '../core/stateMachine.ts';
import { QUALITY_LEVELS, type BestCatch, type Quality, type Settings } from '../config/persistence.ts';
import { getSpecies } from '../fish/species.ts';
import type { JournalEntry } from '../gameplay/fishingSession.ts';

export interface UIHandlers {
  readonly onPlay: () => void;
  readonly onResume: () => void;
  readonly onQuitToMenu: () => void;
  readonly onContinue: () => void;
  readonly onSettingsChange: (settings: Settings) => void;
  readonly onResetSettings: () => void;
}

export interface HudSnapshot {
  readonly state: GameState;
  readonly chargePower: number;
  readonly charging: boolean;
  readonly tension: number;
  /** 0..1: quanto da linha já foi recolhida. */
  readonly progress: number;
  readonly catches: number;
  readonly score: number;
}

const QUALITY_LABELS: Readonly<Record<Quality, string>> = { low: 'Baixa', medium: 'Média', high: 'Alta' };

const HINTS: Partial<Record<GameState, string>> = {
  IDLE: 'Segure o botão esquerdo (ou Espaço) para carregar e solte para arremessar.',
  CASTING: 'A isca está no ar…',
  WAITING: 'Espere a boia afundar. Clique para recolher a linha sem peixe.',
  HOOKED: 'Mordeu! Clique agora para fisgar.',
  REELING: 'Segure para recolher. Solte quando a tensão ficar no vermelho.',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function button(text: string, testId: string, onClick: () => void, cls = 'ui-btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

function meter(testId: string, label: string): { root: HTMLElement; fill: HTMLElement } {
  const root = el('div', 'meter');
  root.dataset['testid'] = testId;
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-label', label);
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  const fill = el('div', 'meter-fill');
  root.append(el('span', 'meter-label', label), fill);
  return { root, fill };
}

function setMeter(m: { root: HTMLElement; fill: HTMLElement }, value: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  if (m.root.getAttribute('aria-valuenow') === String(pct)) return;
  m.root.setAttribute('aria-valuenow', String(pct));
  m.fill.style.transform = `scaleX(${pct / 100})`;
}

function formatKg(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(2).replace('.', ',')} kg`;
}

/** Interface em HTML/CSS sobre o canvas. Todos os botões chamam um handler real. */
export class GameUI {
  readonly root = el('div', 'ui-root');
  private readonly loading = el('section', 'screen loading');
  private readonly loadingMeter = meter('loading-bar', 'Carregando');
  private readonly loadingText = el('p', 'loading-text', 'Preparando o lago…');
  private readonly menu = el('section', 'screen menu');
  private readonly menuMain = el('div', 'menu-main');
  private readonly panel = el('div', 'panel');
  private readonly hud = el('div', 'hud');
  private readonly power = meter('power-bar', 'Força do arremesso');
  private readonly tension = meter('tension-bar', 'Tensão da linha');
  private readonly progress = meter('reel-progress', 'Linha recolhida');
  private readonly biteAlert = el('div', 'bite-alert', 'Mordeu! Clique para fisgar');
  private readonly stats = el('div', 'hud-stats');
  private readonly hint = el('p', 'hud-hint');
  private readonly help = el('div', 'help-overlay');
  private readonly result = el('section', 'screen result');
  private readonly pause = el('section', 'screen pause');
  private readonly pausePanel = el('div', 'panel');
  private readonly crosshair = el('div', 'crosshair');
  private settings: Settings;
  private journal: readonly JournalEntry[] = [];
  private best: BestCatch | null = null;
  private lastState: GameState | null = null;
  private lastStats = '';

  constructor(
    container: HTMLElement,
    private readonly h: UIHandlers,
    settings: Settings,
    private readonly credits: string,
  ) {
    this.settings = settings;
    this.root.setAttribute('aria-live', 'off');

    this.loading.append(el('h1', 'title', 'FISHING PARADISE 3D'), this.loadingMeter.root, this.loadingText);

    const title = el('h1', 'title', 'FISHING PARADISE 3D');
    const sub = el('p', 'subtitle', 'Um fim de tarde no pesque e pague');
    const nav = el('nav', 'menu-buttons');
    nav.setAttribute('aria-label', 'Menu principal');
    nav.append(
      button('Jogar', 'menu-play', () => h.onPlay(), 'ui-btn primary'),
      button('Como jogar', 'menu-help', () => this.openPanel(this.panel, this.helpContent(), this.menuMain)),
      button('Configurações', 'menu-settings', () => this.openPanel(this.panel, this.settingsContent(), this.menuMain)),
      button('Diário', 'menu-journal', () => this.openPanel(this.panel, this.journalContent(), this.menuMain)),
      button('Créditos', 'menu-credits', () => this.openPanel(this.panel, this.creditsContent(), this.menuMain)),
    );
    this.menuMain.append(title, sub, nav);
    this.panel.hidden = true;
    this.menu.dataset['testid'] = 'menu';
    this.menu.append(this.menuMain, this.panel);

    this.biteAlert.dataset['testid'] = 'bite-alert';
    this.biteAlert.setAttribute('role', 'alert');
    this.stats.dataset['testid'] = 'hud-stats';
    this.hint.dataset['testid'] = 'hud-hint';
    this.help.dataset['testid'] = 'help-overlay';
    this.help.append(this.helpContent());
    this.help.hidden = true;
    this.crosshair.setAttribute('aria-hidden', 'true');
    this.hud.append(this.crosshair, this.stats, this.power.root, this.tension.root, this.progress.root, this.biteAlert, this.hint, this.help);

    this.result.setAttribute('role', 'dialog');
    this.result.setAttribute('aria-modal', 'true');

    this.pause.dataset['testid'] = 'pause-menu';
    this.pause.setAttribute('role', 'dialog');
    this.pause.setAttribute('aria-modal', 'true');
    this.pause.setAttribute('aria-label', 'Jogo pausado');
    this.pausePanel.hidden = true;
    this.pause.append(this.pauseMain(), this.pausePanel);

    this.root.append(this.loading, this.menu, this.hud, this.result, this.pause);
    container.appendChild(this.root);
    this.show(null);
  }

  setLoading(progress: number, text: string): void {
    setMeter(this.loadingMeter, progress);
    this.loadingText.textContent = text;
  }

  setJournal(journal: readonly JournalEntry[], best: BestCatch | null): void {
    this.journal = journal;
    this.best = best;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    if (!settings.showHints) this.hint.hidden = true;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }

  showOutcome(entry: JournalEntry): void {
    const caught = entry.outcome === 'caught';
    const sp = getSpecies(entry.speciesId);
    this.result.dataset['testid'] = caught ? 'catch-screen' : 'escape-screen';
    this.result.setAttribute('aria-label', caught ? 'Peixe capturado' : 'O peixe escapou');
    const card = el('div', 'panel result-card');
    if (caught) {
      card.append(
        el('h2', '', `Você pegou um ${sp.name}!`),
        el('p', 'result-line', `Peso: ${formatKg(entry.weightKg)}`),
        el('p', 'result-line', `+${entry.points} pontos`),
      );
    } else {
      const why = entry.reason === 'line_snapped' ? 'A linha arrebentou com a tensão alta.' : 'Você não fisgou a tempo.';
      card.append(el('h2', '', 'O peixe escapou'), el('p', 'result-line', `${why} Tente de novo: a próxima mordida pode ser maior.`));
    }
    const actions = el('div', 'actions');
    const cont = button('Pescar de novo', 'result-continue', () => this.h.onContinue(), 'ui-btn primary');
    actions.append(cont, button('Voltar ao menu', 'result-menu', () => this.h.onQuitToMenu()));
    card.append(actions);
    this.result.replaceChildren(card);
    this.result.hidden = false;
    cont.focus();
  }

  update(s: HudSnapshot): void {
    if (s.state !== this.lastState) this.show(s.state);
    if (s.state === 'PAUSED' || s.state === 'MENU' || s.state === 'LOADING' || s.state === 'BOOT') return;
    this.power.root.hidden = !(s.state === 'IDLE' && s.charging);
    setMeter(this.power, s.chargePower);
    this.tension.root.hidden = s.state !== 'REELING';
    this.tension.root.classList.toggle('danger', s.tension > 0.8);
    setMeter(this.tension, s.tension);
    this.progress.root.hidden = s.state !== 'REELING';
    setMeter(this.progress, s.progress);
    this.biteAlert.hidden = s.state !== 'HOOKED';
    const statsText = `Capturas: ${s.catches} · Pontos: ${s.score}`;
    if (statsText !== this.lastStats) {
      this.stats.textContent = statsText;
      this.lastStats = statsText;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private show(state: GameState | null): void {
    this.lastState = state;
    const inGame = state !== null && !['BOOT', 'LOADING', 'MENU'].includes(state);
    this.loading.hidden = !(state === null || state === 'BOOT' || state === 'LOADING');
    this.menu.hidden = state !== 'MENU';
    this.hud.hidden = !inGame || state === 'PAUSED';
    this.pause.hidden = state !== 'PAUSED';
    if (state !== 'CAUGHT' && state !== 'ESCAPED' && state !== 'PAUSED') this.result.hidden = true;
    if (state === 'PAUSED') this.result.hidden = true;
    if (state === 'MENU') {
      this.closePanel(this.panel, this.menuMain);
      this.menu.querySelector<HTMLButtonElement>('[data-testid="menu-play"]')?.focus();
    }
    if (state === 'PAUSED') {
      this.closePanel(this.pausePanel, this.pause.firstElementChild as HTMLElement);
      this.pause.querySelector<HTMLButtonElement>('[data-testid="pause-resume"]')?.focus();
    }
    const hintText = state ? HINTS[state] : undefined;
    this.hint.hidden = !this.settings.showHints || !hintText;
    if (hintText) this.hint.textContent = hintText;
  }

  private pauseMain(): HTMLElement {
    const main = el('div', 'panel pause-main');
    main.append(
      el('h2', '', 'Pausado'),
      button('Continuar', 'pause-resume', () => this.h.onResume(), 'ui-btn primary'),
      button('Como jogar', 'pause-help', () => this.openPanel(this.pausePanel, this.helpContent(), main)),
      button('Configurações', 'pause-settings', () => this.openPanel(this.pausePanel, this.settingsContent(), main)),
      button('Diário', 'pause-journal', () => this.openPanel(this.pausePanel, this.journalContent(), main)),
      button('Voltar ao menu', 'pause-quit', () => this.h.onQuitToMenu()),
    );
    return main;
  }

  private openPanel(panel: HTMLElement, content: HTMLElement, main: HTMLElement): void {
    const back = button('Voltar', 'panel-back', () => this.closePanel(panel, main));
    panel.replaceChildren(content, back);
    main.hidden = true;
    panel.hidden = false;
    back.focus();
  }

  private closePanel(panel: HTMLElement, main: HTMLElement): void {
    panel.hidden = true;
    panel.replaceChildren();
    main.hidden = false;
  }

  private helpContent(): HTMLElement {
    const box = el('div', 'help');
    box.append(el('h2', '', 'Como jogar'));
    const list = el('ul');
    for (const line of [
      'Mova o mouse para olhar em volta (clique no lago para travar o cursor).',
      'Segure o botão esquerdo ou Espaço para carregar a força e solte para arremessar.',
      'Quando a boia afundar e aparecer “Mordeu!”, clique para fisgar.',
      'Segure para recolher a linha; solte quando a tensão ficar no vermelho para ela não arrebentar.',
      'ESC pausa o jogo. H mostra ou esconde esta ajuda.',
    ]) {
      list.append(el('li', '', line));
    }
    box.append(list);
    return box;
  }

  private settingsContent(): HTMLElement {
    const form = el('form', 'settings');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.append(el('h2', '', 'Configurações'));

    const qLabel = el('label', 'field', 'Qualidade gráfica');
    const select = el('select');
    select.dataset['testid'] = 'settings-quality';
    for (const q of QUALITY_LEVELS) {
      const opt = el('option', '', QUALITY_LABELS[q]);
      opt.value = q;
      opt.selected = q === this.settings.quality;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      const q = (QUALITY_LEVELS as readonly string[]).includes(select.value) ? (select.value as Quality) : this.settings.quality;
      this.emitSettings({ ...this.settings, quality: q });
    });
    qLabel.append(select);

    const sLabel = el('label', 'field', 'Sensibilidade do mouse');
    const range = el('input');
    range.type = 'range';
    range.min = '0.1';
    range.max = '3';
    range.step = '0.1';
    range.value = String(this.settings.cameraSensitivity);
    range.dataset['testid'] = 'settings-sensitivity';
    const out = el('output', '', this.settings.cameraSensitivity.toFixed(1));
    range.addEventListener('input', () => {
      const v = Number(range.value);
      if (!Number.isFinite(v) || v < 0.1 || v > 3) return;
      out.textContent = v.toFixed(1);
      this.emitSettings({ ...this.settings, cameraSensitivity: v });
    });
    sLabel.append(range, out);

    const hLabel = el('label', 'field check', 'Mostrar dicas na tela');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = this.settings.showHints;
    check.dataset['testid'] = 'settings-hints';
    check.addEventListener('change', () => this.emitSettings({ ...this.settings, showHints: check.checked }));
    hLabel.prepend(check);

    const reset = button('Restaurar padrões', 'settings-reset', () => {
      this.h.onResetSettings();
      form.replaceWith(this.settingsContent());
    });
    form.append(qLabel, sLabel, hLabel, reset, el('p', 'note', 'As mudanças valem na hora e ficam salvas neste navegador.'));
    return form;
  }

  private emitSettings(next: Settings): void {
    this.settings = next;
    this.h.onSettingsChange(next);
  }

  private journalContent(): HTMLElement {
    const box = el('div', 'journal');
    box.dataset['testid'] = 'journal';
    box.append(el('h2', '', 'Diário de pesca'));
    if (this.best) {
      box.append(el('p', 'note', `Melhor captura: ${getSpecies(this.best.speciesId).name}, ${formatKg(this.best.weightKg)} (${this.best.points} pts)`));
    }
    if (this.journal.length === 0) {
      box.append(el('p', '', 'Nenhum arremesso nesta sessão ainda. Seus peixes aparecem aqui.'));
      return box;
    }
    const list = el('ol');
    for (const e of this.journal) {
      const name = getSpecies(e.speciesId).name;
      list.append(
        el('li', '', e.outcome === 'caught' ? `${name} — ${formatKg(e.weightKg)} — ${e.points} pts` : `${name} escapou`),
      );
    }
    box.append(list);
    return box;
  }

  private creditsContent(): HTMLElement {
    const box = el('div', 'credits');
    box.dataset['testid'] = 'credits';
    box.append(el('h2', '', 'Créditos'));
    const pre = el('pre', 'credits-text', this.credits.trim() || 'Registro de licenças indisponível.');
    pre.tabIndex = 0;
    box.append(pre);
    return box;
  }
}
