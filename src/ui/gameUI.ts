import type { GameState } from '../core/stateMachine.ts';
import { installWeighingTestHooks } from '../capture/catchDecision.ts';
import { defaultSaveData, QUALITY_LEVELS, type BestCatch, type Quality, type Settings, type Volumes } from '../config/persistence.ts';
import { getSpecies, LURE_IDS, SPECIES, type LureId } from '../fish/species.ts';
import type { JournalEntry } from '../gameplay/fishingSession.ts';
import { evaluateAchievements } from '../progression/achievements.ts';
import { achievementsContent, achievementsUnavailable } from './achievementsView.ts';
import { GalleryView, LURE_LABELS, type GalleryDataSource } from './gallery.ts';

export interface UIHandlers {
  readonly onPlay: () => void;
  readonly onResume: () => void;
  readonly onQuitToMenu: () => void;
  readonly onContinue: () => void;
  readonly onSettingsChange: (settings: Settings) => void;
  /** Sliders de volume (geral, música e efeitos); ausente = a tela esconde nada, só não propaga. */
  readonly onVolumesChange?: (volumes: Volumes) => void;
  readonly onResetSettings: () => void;
  readonly onOpenTrophyRoom: () => void;
}

/** Cenários do menu: só o lago tropical existe; os outros aparecem desabilitados como 'em breve'. */
const SCENARIOS = [
  { id: 'lago-tropical', name: 'Lago Tropical', available: true },
  { id: 'rio-da-serra', name: 'Rio da Serra', available: false },
  { id: 'mar-aberto', name: 'Mar Aberto', available: false },
] as const;

export interface HudSnapshot {
  readonly state: GameState;
  readonly chargePower: number;
  readonly charging: boolean;
  readonly tension: number;
  /** 0..1: quanto da linha já foi recolhida. */
  readonly progress: number;
  /** Direção do arremesso (rad); ausente = centrada. */
  readonly castYaw?: number;
  /** Dados da briga lidos da sessão; sem eles o painel mostra traços. */
  readonly fight?: {
    readonly distanceM: number | null;
    readonly speedMps: number;
    readonly dragN: number;
    readonly stamina: number;
  };
  readonly catches: number;
  readonly score: number;
}

const QUALITY_LABELS: Readonly<Record<Quality, string>> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  ultra: 'Ultra',
  auto: 'Auto (ajusta pelo desempenho)',
};

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
  private readonly direction = meter('direction-bar', 'Direção do arremesso');
  private readonly fight = el('div', 'fight-panel');
  private readonly fightValues = new Map<string, HTMLElement>();
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
  private volumes: Volumes;
  private gallery: GalleryView | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private journal: readonly JournalEntry[] = [];
  private best: BestCatch | null = null;
  private lastState: GameState | null = null;
  private lastStats = '';

  constructor(
    container: HTMLElement,
    private readonly h: UIHandlers,
    settings: Settings,
    private readonly credits: string,
    private readonly galleryData: GalleryDataSource | null = null,
    volumes: Volumes = defaultSaveData().volumes,
  ) {
    this.settings = settings;
    this.volumes = volumes;
    this.root.setAttribute('aria-live', 'off');

    this.loading.append(el('h1', 'title', 'FISHING PARADISE 3D'), this.loadingMeter.root, this.loadingText);

    const title = el('h1', 'title', 'FISHING PARADISE 3D');
    const sub = el('p', 'subtitle', 'Um fim de tarde no pesque e pague');
    const nav = el('nav', 'menu-buttons');
    nav.setAttribute('aria-label', 'Menu principal');
    this.continueBtn = button('Continuar', 'menu-continue', () => h.onPlay());
    this.continueBtn.title = 'Volta ao lago com seu progresso salvo.';
    nav.append(
      this.continueBtn,
      button('Nova pescaria', 'menu-play', () => h.onPlay(), 'ui-btn primary'),
      button('Selecionar cenário', 'menu-scenario', () => this.openPanel(this.panel, this.scenarioContent(), this.menuMain)),
      button('Equipamentos', 'menu-equipment', () => this.openPanel(this.panel, this.equipmentContent(), this.menuMain)),
      button('Galeria', 'menu-gallery', () => this.openGallery()),
      button('Conquistas', 'menu-achievements', () => this.openAchievements()),
      button('Configurações', 'menu-settings', () => this.openPanel(this.panel, this.settingsContent(), this.menuMain)),
      button('Como jogar', 'menu-help', () => this.openPanel(this.panel, this.helpContent(), this.menuMain)),
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
    this.fight.dataset['testid'] = 'fight-panel';
    this.fight.setAttribute('role', 'group');
    this.fight.setAttribute('aria-label', 'Briga com o peixe');
    const rows = el('dl', 'fight-rows');
    for (const [key, label] of [
      ['distance', 'Distância'],
      ['speed', 'Velocidade'],
      ['drag', 'Drag'],
      ['stamina', 'Fôlego do peixe'],
    ] as const) {
      const value = el('dd', 'fight-value', '—');
      value.dataset['testid'] = `fight-${key}`;
      this.fightValues.set(key, value);
      rows.append(el('dt', '', label), value);
    }
    this.fight.append(rows);
    this.fight.hidden = true;
    this.direction.root.hidden = true;
    this.hud.append(
      this.crosshair,
      this.stats,
      this.power.root,
      this.direction.root,
      this.tension.root,
      this.progress.root,
      this.fight,
      this.biteAlert,
      this.hint,
      this.help,
    );

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
    // Só no build e2e: gancho __fp.openWeighing leva o teste direto à pesagem, sem pescar.
    if (import.meta.env.MODE === 'e2e') installWeighingTestHooks(container);
  }

  setLoading(progress: number, text: string): void {
    setMeter(this.loadingMeter, progress);
    this.loadingText.textContent = text;
  }

  setJournal(journal: readonly JournalEntry[], best: BestCatch | null): void {
    this.journal = journal;
    this.best = best;
    this.updateContinue();
  }

  /** 'Continuar' só habilita quando existe progresso (sessão ou save) para retomar. */
  private updateContinue(): void {
    if (!this.continueBtn) return;
    const hasProgress = this.journal.length > 0 || this.best !== null;
    this.continueBtn.disabled = !hasProgress;
    this.continueBtn.title = hasProgress
      ? 'Volta ao lago com seu progresso salvo.'
      : 'Nenhuma pescaria para continuar ainda. Comece por «Nova pescaria».';
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
    const charging = s.state === 'IDLE' && s.charging;
    this.power.root.hidden = !charging;
    setMeter(this.power, s.chargePower);
    this.direction.root.hidden = !charging;
    setMeter(this.direction, 0.5 + Math.max(-1, Math.min(1, (s.castYaw ?? 0) / Math.PI)) / 2);
    this.tension.root.hidden = s.state !== 'REELING';
    this.tension.root.classList.toggle('danger', s.tension > 0.8);
    setMeter(this.tension, s.tension);
    this.progress.root.hidden = s.state !== 'REELING';
    setMeter(this.progress, s.progress);
    this.fight.hidden = s.state !== 'REELING';
    if (s.state === 'REELING') this.updateFight(s.fight);
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

  private setFightValue(key: string, text: string): void {
    const node = this.fightValues.get(key);
    if (node && node.textContent !== text) node.textContent = text;
  }

  private updateFight(f: HudSnapshot['fight']): void {
    this.setFightValue('distance', f && f.distanceM !== null ? `${f.distanceM.toFixed(1).replace('.', ',')} m` : '—');
    this.setFightValue('speed', f ? `${f.speedMps.toFixed(1).replace('.', ',')} m/s` : '—');
    this.setFightValue('drag', f ? `${Math.round(f.dragN)} N` : '—');
    this.setFightValue('stamina', f ? `${Math.round(f.stamina * 100)}%` : '—');
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
      this.updateContinue();
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
    this.gallery?.dispose();
    this.gallery = null;
    panel.classList.remove('wide');
    panel.hidden = true;
    panel.replaceChildren();
    main.hidden = false;
  }

  private openGallery(): void {
    this.gallery?.dispose();
    this.gallery = new GalleryView(this.galleryData, () => this.h.onOpenTrophyRoom());
    this.openPanel(this.panel, this.gallery.root, this.menuMain);
    this.panel.classList.add('wide');
    void this.gallery.refresh();
  }

  private openAchievements(): void {
    const box = el('div', 'achievements-box');
    box.append(el('p', 'note', 'Carregando conquistas…'));
    this.openPanel(this.panel, box, this.menuMain);
    if (this.galleryData === null) {
      box.replaceChildren(achievementsUnavailable('Conquistas indisponíveis neste navegador: o armazenamento local está bloqueado.'));
      return;
    }
    void this.galleryData
      .listCatches()
      .then((records) => box.replaceChildren(achievementsContent(evaluateAchievements(records))))
      .catch((error: unknown) => {
        console.warn(`conquistas não carregaram: ${String(error)}`);
        box.replaceChildren(achievementsUnavailable('Não foi possível carregar as conquistas. Feche e abra de novo para tentar outra vez.'));
      });
  }

  /** Seleção de cenário: o lago tropical é o atual; os próximos aparecem desabilitados, sem promessa falsa de clique. */
  private scenarioContent(): HTMLElement {
    const box = el('div', 'scenarios');
    box.dataset['testid'] = 'scenario-list';
    box.append(el('h2', '', 'Selecionar cenário'));
    for (const sc of SCENARIOS) {
      if (sc.available) {
        const b = button(`${sc.name} — cenário atual`, `scenario-${sc.id}`, () => this.closePanel(this.panel, this.menuMain));
        b.setAttribute('aria-pressed', 'true');
        b.classList.add('active');
        box.append(b);
      } else {
        const b = el('button', 'ui-btn', `${sc.name} — em breve`);
        b.type = 'button';
        b.disabled = true;
        b.dataset['testid'] = `scenario-${sc.id}`;
        box.append(b);
      }
    }
    box.append(el('p', 'note', 'Novos cenários chegam em atualizações futuras; seu progresso vale em todos.'));
    return box;
  }

  /** Equipamentos: a isca escolhida vai para settings.lureId e muda o interesse de cada espécie. */
  private equipmentContent(): HTMLElement {
    const form = el('form', 'settings equipment');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.append(el('h2', '', 'Equipamentos'));
    const label = el('label', 'field', 'Isca');
    const select = el('select');
    select.dataset['testid'] = 'equipment-lure';
    for (const id of LURE_IDS) {
      const opt = el('option', '', LURE_LABELS[id]);
      opt.value = id;
      opt.selected = id === this.settings.lureId;
      select.append(opt);
    }
    const prefNote = el('p', 'note');
    prefNote.dataset['testid'] = 'equipment-preference';
    const updateNote = (id: LureId): void => {
      const fans = SPECIES.filter((s) => s.preferredLures.includes(id)).map((s) => s.name);
      prefNote.textContent = fans.length > 0 ? `Preferida por: ${fans.join(', ')}.` : 'Nenhuma espécie deste lago prefere essa isca.';
    };
    updateNote(this.settings.lureId);
    select.addEventListener('change', () => {
      const id = (LURE_IDS as readonly string[]).includes(select.value) ? (select.value as LureId) : this.settings.lureId;
      updateNote(id);
      this.emitSettings({ ...this.settings, lureId: id });
    });
    label.append(select);
    form.append(label, prefNote, el('p', 'note', 'A escolha vale na próxima mordida e fica salva neste navegador.'));
    return form;
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
      'ESC pausa o jogo. H mostra ou esconde esta ajuda. F3 mostra o painel de diagnóstico.',
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

    const audioTitle = el('h3', '', 'Áudio');
    const master = this.volumeField('Volume geral', 'master');
    const music = this.volumeField('Volume da música', 'music');
    const sfxVol = this.volumeField('Volume dos efeitos', 'sfx');

    const reset = button('Restaurar padrões', 'settings-reset', () => {
      this.h.onResetSettings();
      form.replaceWith(this.settingsContent());
    });
    form.append(qLabel, sLabel, hLabel, audioTitle, master, music, sfxVol, reset, el('p', 'note', 'As mudanças valem na hora e ficam salvas neste navegador.'));
    return form;
  }

  /** Slider 0..1 de um dos volumes; avisa o jogo na hora pelo onVolumesChange. */
  private volumeField(label: string, key: keyof Volumes): HTMLElement {
    const field = el('label', 'field', label);
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.max = '1';
    range.step = '0.05';
    range.value = String(this.volumes[key]);
    range.dataset['testid'] = `settings-volume-${key}`;
    const out = el('output', '', `${Math.round(this.volumes[key] * 100)}%`);
    range.addEventListener('input', () => {
      const v = Number(range.value);
      if (!Number.isFinite(v) || v < 0 || v > 1) return;
      out.textContent = `${Math.round(v * 100)}%`;
      this.volumes = { ...this.volumes, [key]: v };
      this.h.onVolumesChange?.(this.volumes);
    });
    field.append(range, out);
    return field;
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
