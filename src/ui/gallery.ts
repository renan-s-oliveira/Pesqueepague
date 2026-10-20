import { getSpecies, RARITIES, SPECIES, type LureId, type Rarity, type SpeciesId } from '../fish/species.ts';
import type { CatchRecord } from '../progression/types.ts';
import { LAKES, getLake, speciesLake } from '../world/lakes.ts';

const VISIBLE_SPECIES = SPECIES.filter((s) => !s.secret);

/** Fonte de dados da galeria: o catchRepository por trás de uma interface pequena. */
export interface GalleryDataSource {
  listCatches(): Promise<readonly CatchRecord[]>;
  getPhoto(id: string): Promise<Blob | undefined>;
}

export const GALLERY_SORTS = ['date_desc', 'date_asc', 'weight_desc', 'weight_asc'] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

const SORT_LABELS: Readonly<Record<GallerySort, string>> = {
  date_desc: 'Mais recentes primeiro',
  date_asc: 'Mais antigas primeiro',
  weight_desc: 'Mais pesados primeiro',
  weight_asc: 'Mais leves primeiro',
};

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  legendary: 'Lendário',
};

export const LURE_LABELS: Readonly<Record<LureId, string>> = {
  worm: 'Minhoca',
  dough: 'Massa',
  corn: 'Milho',
  pellet: 'Ração (pellet)',
  spinner: 'Spinner',
  popper: 'Popper',
  jig: 'Jig',
};

/** Rótulos dos ambientes conhecidos; id desconhecido aparece como veio. */
const LOCATION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(LAKES.map((lake) => [lake.locationId, lake.name]));

export interface GalleryFilter {
  readonly speciesId: SpeciesId | '';
  readonly rarity: Rarity | '';
  readonly locationId: string;
  readonly search: string;
}

function formatKg(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(2).replace('.', ',')} kg`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Texto onde a busca procura: espécie, nome científico, raridade, isca e ambiente. */
function haystack(record: CatchRecord): string {
  const sp = getSpecies(record.speciesId);
  return [sp.name, sp.scientificName, RARITY_LABELS[record.rarity], LURE_LABELS[record.lureId], LOCATION_LABELS[record.locationId] ?? record.locationId]
    .join(' ')
    .toLowerCase();
}

/** Filtro puro (espécie, raridade, ambiente e busca livre), para a view e para testes. */
export function filterCatches(records: readonly CatchRecord[], f: GalleryFilter): CatchRecord[] {
  const term = f.search.trim().toLowerCase();
  return records.filter(
    (r) =>
      (f.speciesId === '' || r.speciesId === f.speciesId) &&
      (f.rarity === '' || r.rarity === f.rarity) &&
      (f.locationId === '' || r.locationId === f.locationId) &&
      (term === '' || haystack(r).includes(term)),
  );
}

/** Ordenação pura por peso ou data; empate decide pelo id para ser estável. */
export function sortCatches(records: readonly CatchRecord[], sort: GallerySort): CatchRecord[] {
  const byId = (a: CatchRecord, b: CatchRecord): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cmp: Record<GallerySort, (a: CatchRecord, b: CatchRecord) => number> = {
    date_desc: (a, b) => b.timestamp - a.timestamp || byId(a, b),
    date_asc: (a, b) => a.timestamp - b.timestamp || byId(a, b),
    weight_desc: (a, b) => b.weightKg - a.weightKg || byId(a, b),
    weight_asc: (a, b) => a.weightKg - b.weightKg || byId(a, b),
  };
  return [...records].sort(cmp[sort]);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function labeledSelect(label: string, testId: string, options: readonly { value: string; text: string }[], onChange: (value: string) => void): { field: HTMLElement; select: HTMLSelectElement } {
  const field = el('label', 'field', label);
  const select = el('select');
  select.dataset['testid'] = testId;
  for (const o of options) {
    const opt = el('option', '', o.text);
    opt.value = o.value;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  field.append(select);
  return { field, select };
}

/** Miniatura procedural da espécie (SVG com a paleta real), para captura sem foto. */
function speciesThumb(speciesId: SpeciesId): HTMLElement {
  const sp = getSpecies(speciesId);
  const box = el('div', 'gallery-thumb gallery-thumb-fallback');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `Silhueta de ${sp.name} (sem foto)`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 90');
  svg.setAttribute('aria-hidden', 'true');
  const palette = sp.visual.palette;
  const depth = 12 + Math.round(sp.visual.proportions.bodyDepth * 18);
  const bars = sp.id === 'lambari'
    ? '<circle cx="42" cy="43" r="3"/><circle cx="89" cy="45" r="3"/>'
    : [46, 58, 70, 82].map((x) => `<path d="M${x},${45 - depth + 5}q-5,${depth} 0,${depth * 2 - 10}" fill="none" stroke="${sp.visual.spots.color}" stroke-width="3" opacity=".65"/>`).join('');
  svg.innerHTML =
    '<rect width="120" height="90" fill="#0b2430"/><path d="M0 67Q30 60 60 67T120 67M0 73Q30 66 60 73T120 73" fill="none" stroke="#8eb8a5" stroke-opacity=".1"/>' +
    `<path d="M86 44L110 28L105 45L111 61L86 48Z" fill="${palette.fin}"/>` +
    `<path d="M42 ${45 - depth + 4}L50 ${45 - depth - 9}L60 ${45 - depth - 5}L72 ${45 - depth - 7}L82 ${45 - depth + 7}Z" fill="${palette.fin}" opacity=".85"/>` +
    `<ellipse cx="58" cy="45" rx="34" ry="${depth}" fill="${palette.flank}"/>` +
    `<path d="M25 43Q55 ${45 - depth * 1.9} 91 44Q60 ${45 - depth * .8} 25 43" fill="${palette.dorsal}" opacity=".75"/>` +
    `<path d="M28 50Q58 ${45 + depth * 1.5} 88 48Q61 ${45 + depth * .8} 28 50" fill="${palette.belly}" opacity=".6"/>` +
    `<g fill="${sp.visual.spots.color}">${bars}</g>` +
    `<path d="M49 48L64 62L62 48M43 34Q51 45 43 56" fill="${palette.fin}" stroke="${palette.dorsal}" stroke-width=".8" opacity=".75"/>` +
    '<circle cx="34" cy="41" r="3.1" fill="#d8c58c"/><circle cx="34" cy="41" r="1.8" fill="#101418"/><circle cx="33.4" cy="40.4" r=".5" fill="white"/><path d="M24 46L30 46" stroke="#102a28" stroke-width="1"/>';
  box.append(svg);
  return box;
}

/**
 * Galeria do museu digital: cards com foto (quando tirada) ou miniatura da espécie,
 * filtros por espécie, raridade e ambiente, ordenação por peso e data, e busca livre.
 * Estados cobertos: carregando, vazio, filtro sem resultado, erro e galeria indisponível.
 */
export class GalleryView {
  readonly root = el('div', 'gallery');
  private readonly status = el('p', 'gallery-status');
  private readonly list = el('ul', 'gallery-cards');
  private readonly summary = el('div', 'collection-summary');
  private readonly atlas = el('div', 'species-atlas');
  private readonly detail = el('dialog', 'capture-detail');
  private recordsOnly = false;
  private renderVersion = 0;
  private readonly searchInput: HTMLInputElement;
  private readonly objectUrls: string[] = [];
  private readonly detailUrls: string[] = [];
  private records: readonly CatchRecord[] = [];
  private filter: GalleryFilter = { speciesId: '', rarity: '', locationId: '', search: '' };
  private sort: GallerySort = 'date_desc';
  private loaded = false;
  private disposed = false;

  constructor(
    private readonly data: GalleryDataSource | null,
    onOpenTrophyRoom: () => void,
  ) {
    this.root.dataset['testid'] = 'gallery';
    this.root.append(el('p', 'menu-eyebrow', 'MEMÓRIAS DO LAGO'), el('h2', '', 'Galeria'),
      el('p', 'collection-intro', 'Cada arremesso tem uma história. Abra uma captura para reviver a sua.'));
    this.detail.setAttribute('aria-label', 'Ficha da captura');
    this.detail.dataset['testid'] = 'gallery-detail';
    this.detail.addEventListener('close', () => {
      if (this.detail.open) return;
      this.releaseDetailPhotos();
      this.detail.replaceChildren();
    });
    this.detail.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopPropagation();
    });

    const controls = el('div', 'gallery-controls');
    const species = labeledSelect(
      'Espécie',
      'gallery-filter-species',
      [{ value: '', text: 'Todas' }, ...VISIBLE_SPECIES.map((s) => ({ value: s.id, text: s.name }))],
      (v) => this.setFilter({ ...this.filter, speciesId: v as SpeciesId | '' }),
    );
    const rarity = labeledSelect(
      'Raridade',
      'gallery-filter-rarity',
      [{ value: '', text: 'Todas' }, ...RARITIES.map((r) => ({ value: r, text: RARITY_LABELS[r] }))],
      (v) => this.setFilter({ ...this.filter, rarity: v as Rarity | '' }),
    );
    const env = labeledSelect(
      'Ambiente',
      'gallery-filter-env',
      [
        { value: '', text: 'Todos' },
        ...Object.entries(LOCATION_LABELS).map(([value, text]) => ({ value, text })),
      ],
      (v) => this.setFilter({ ...this.filter, locationId: v }),
    );
    const sort = labeledSelect(
      'Ordenar por',
      'gallery-sort',
      GALLERY_SORTS.map((s) => ({ value: s, text: SORT_LABELS[s] })),
      (v) => {
        this.sort = (GALLERY_SORTS as readonly string[]).includes(v) ? (v as GallerySort) : 'date_desc';
        this.render();
      },
    );
    const searchField = el('label', 'field', 'Buscar');
    this.searchInput = el('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Espécie, isca, raridade…';
    this.searchInput.dataset['testid'] = 'gallery-search';
    this.searchInput.addEventListener('input', () => this.setFilter({ ...this.filter, search: this.searchInput.value }));
    searchField.append(this.searchInput);
    controls.append(species.field, rarity.field, env.field, sort.field, searchField);

    this.status.dataset['testid'] = 'gallery-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.list.setAttribute('aria-label', 'Capturas registradas');

    const trophyBtn = el('button', 'ui-btn compact', 'Sala de troféus ↗');
    trophyBtn.type = 'button';
    trophyBtn.dataset['testid'] = 'gallery-trophy-room';
    trophyBtn.addEventListener('click', onOpenTrophyRoom);

    const quick = el('div', 'collection-actions');
    const records = el('button', 'ui-btn compact', 'Só recordes');
    records.type = 'button';
    records.dataset['testid'] = 'gallery-records-only';
    records.setAttribute('aria-pressed', 'false');
    records.addEventListener('click', () => {
      this.recordsOnly = !this.recordsOnly;
      records.setAttribute('aria-pressed', String(this.recordsOnly));
      this.render();
    });
    const reset = el('button', 'ui-btn compact', 'Limpar filtros');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      this.filter = { speciesId: '', rarity: '', locationId: '', search: '' };
      this.searchInput.value = '';
      for (const select of [species.select, rarity.select, env.select]) select.value = '';
      this.recordsOnly = false;
      records.setAttribute('aria-pressed', 'false');
      this.render();
    });
    quick.append(records, reset, trophyBtn);
    const atlas = el('details', 'atlas-disclosure');
    atlas.append(el('summary', '', 'Atlas do lago · descubra suas espécies'), this.atlas);
    this.root.append(this.summary, atlas, controls, quick, this.status, this.list, this.detail);
  }

  private setFilter(next: GalleryFilter): void {
    this.filter = next;
    this.render();
  }

  /** Carrega as capturas do repositório e desenha; chamar de novo recarrega. */
  async refresh(): Promise<void> {
    if (this.data === null) {
      this.status.textContent = 'Galeria indisponível neste navegador: o armazenamento local está bloqueado. As capturas seguem valendo na sessão.';
      return;
    }
    this.status.textContent = 'Carregando capturas…';
    try {
      this.records = await this.data.listCatches();
      this.loaded = true;
      if (!this.disposed) this.render();
    } catch (error) {
      this.status.textContent = 'Não foi possível carregar a galeria. Feche e abra de novo para tentar outra vez.';
      console.warn(`galeria não carregou: ${String(error)}`);
    }
  }

  private render(): void {
    if (!this.loaded) return;
    this.renderVersion++;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.length = 0;
    const visible = sortCatches(filterCatches(this.records, this.filter).filter((r) => !this.recordsOnly || r.isPersonalRecord), this.sort);
    const speciesCount = new Set(this.records.map((r) => r.speciesId)).size;
    const catalog = SPECIES.filter((s) => !s.secret || this.records.some((r) => r.speciesId === s.id));
    const speciesSelect = this.root.querySelector<HTMLSelectElement>('[data-testid="gallery-filter-species"]');
    for (const species of catalog.filter((s) => s.secret)) {
      if (speciesSelect && ![...speciesSelect.options].some((o) => o.value === species.id)) {
        const option = el('option', '', species.name); option.value = species.id; speciesSelect.append(option);
      }
    }
    const best = Math.max(0, ...this.records.map((r) => r.weightKg));
    this.summary.replaceChildren();
    for (const [value, label] of [[String(this.records.length), 'capturas'], [`${speciesCount}/${catalog.length}`, 'espécies descobertas'], [formatKg(best), 'maior captura'], [String(this.records.filter((r) => r.disposition === 'released').length), 'de volta ao lago']]) {
      const stat = el('div', 'collection-stat');
      stat.append(el('strong', '', value), el('span', '', label));
      this.summary.append(stat);
    }
    this.atlas.replaceChildren();
    for (const sp of catalog) {
      const catches = this.records.filter((r) => r.speciesId === sp.id);
      const tile = el('button', `atlas-species ${catches.length ? 'discovered' : 'undiscovered'}`);
      tile.type = 'button';
      tile.append(speciesThumb(sp.id), el('strong', '', sp.name), el('span', '', getLake(speciesLake(sp.id)).name), el('span', '', catches.length ? `${catches.length} capturas · ${formatKg(Math.max(...catches.map((r) => r.weightKg)))}` : 'Ainda por descobrir'));
      tile.addEventListener('click', () => this.openSpecies(sp.id));
      this.atlas.append(tile);
    }
    this.list.replaceChildren();
    if (this.records.length === 0) {
      const empty = el('li', 'gallery-empty', 'Nenhuma captura ainda. Pesque seu primeiro peixe e ele aparece aqui, com foto e ficha.');
      empty.dataset['testid'] = 'gallery-empty';
      this.list.append(empty);
      this.status.textContent = 'Galeria vazia';
      return;
    }
    if (visible.length === 0) {
      const none = el('li', 'gallery-empty', 'Nenhuma captura combina com esses filtros. Limpe a busca ou escolha outra espécie.');
      none.dataset['testid'] = 'gallery-empty';
      this.list.append(none);
      this.status.textContent = `0 de ${this.records.length} capturas`;
      return;
    }
    this.status.textContent = visible.length === 1 ? '1 captura' : `${visible.length} capturas`;
    for (const record of visible) this.list.append(this.card(record));
  }

  private card(record: CatchRecord, interactive = true): HTMLElement {
    const sp = getSpecies(record.speciesId);
    const li = el(interactive ? 'li' : 'div', 'gallery-card');
    li.dataset['testid'] = 'gallery-card';
    li.dataset['rarity'] = record.rarity;
    if (record.photoId !== undefined && this.data !== null) {
      const img = el('img', 'gallery-thumb');
      img.alt = `Foto da captura: ${sp.name}, ${formatKg(record.weightKg)}`;
      img.loading = 'lazy';
      const placeholder = speciesThumb(record.speciesId);
      li.append(placeholder);
      const version = this.renderVersion;
      void this.data.getPhoto(record.photoId).then((blob) => {
        if (this.disposed || version !== this.renderVersion || blob === undefined || !placeholder.isConnected) return;
        const url = URL.createObjectURL(blob);
        (interactive ? this.objectUrls : this.detailUrls).push(url);
        img.src = url;
        placeholder.replaceWith(img);
      }).catch(() => { /* A miniatura da espécie continua disponível se a foto falhar. */ });
    } else {
      li.append(speciesThumb(record.speciesId));
    }
    const header = el('div', 'gallery-card-header');
    header.append(el('h3', 'gallery-card-name', sp.name), el('span', `catch-rarity rarity-${record.rarity}`, RARITY_LABELS[record.rarity]));
    li.append(header);
    if (record.isPersonalRecord) li.append(el('span', 'catch-record-badge', 'Recorde pessoal'));
    const rows = el('dl', 'catch-rows');
    for (const [label, value] of [
      ['Peso', formatKg(record.weightKg)],
      ['Comprimento', `${record.lengthCm.toFixed(1).replace('.', ',')} cm`],
      ['Data', formatDate(record.timestamp)],
      ['Isca', LURE_LABELS[record.lureId]],
      ['Ambiente', LOCATION_LABELS[record.locationId] ?? record.locationId],
      ['Destino', record.disposition === 'released' ? 'Solto' : 'Guardado'],
    ] as const) {
      rows.append(el('dt', '', label), el('dd', '', value));
    }
    li.append(rows);
    if (interactive) {
      const inspect = el('button', 'ui-btn compact inspect-catch', 'Abrir captura ↗');
      inspect.type = 'button';
      inspect.setAttribute('aria-label', `Abrir captura de ${sp.name}, ${formatKg(record.weightKg)}`);
      inspect.addEventListener('click', () => this.openDetail(record));
      li.append(inspect);
    }
    return li;
  }

  private openDetail(record: CatchRecord): void {
    this.detail.setAttribute('aria-label', 'Ficha da captura');
    const visible = sortCatches(filterCatches(this.records, this.filter).filter((r) => !this.recordsOnly || r.isPersonalRecord), this.sort);
    let index = Math.max(0, visible.findIndex((r) => r.id === record.id));
    const render = (): void => {
      this.releaseDetailPhotos();
      const current = visible[index];
      if (!current) return;
      const header = el('div', 'detail-toolbar');
      const close = el('button', 'ui-btn compact', 'Fechar ×');
      close.type = 'button';
      close.addEventListener('click', () => this.detail.close());
      header.append(el('span', 'menu-eyebrow', `ÁLBUM / ${index + 1} DE ${visible.length}`), close);
      const card = this.card(current, false);
      card.removeAttribute('data-testid');
      const best = Math.max(...this.records.filter((r) => r.speciesId === current.speciesId).map((r) => r.weightKg));
      const comparison = el('p', 'detail-comparison', `${Math.round(current.weightKg / best * 100)}% do seu recorde nesta espécie · Recorde: ${formatKg(best)}`);
      const nav = el('div', 'detail-toolbar');
      for (const [label, offset] of [['← Anterior', -1], ['Próxima →', 1]] as const) {
        const button = el('button', 'ui-btn compact', label);
        button.type = 'button';
        button.disabled = index + offset < 0 || index + offset >= visible.length;
        button.addEventListener('click', () => { index += offset; render(); });
        nav.append(button);
      }
      this.detail.replaceChildren(header, card, comparison, nav);
    };
    render();
    this.detail.showModal();
  }

  private openSpecies(id: SpeciesId): void {
    this.releaseDetailPhotos();
    const sp = getSpecies(id);
    const head = el('div', 'detail-toolbar');
    const close = el('button', 'ui-btn compact', 'Fechar ×');
    close.type = 'button';
    close.addEventListener('click', () => this.detail.close());
    head.append(el('span', 'menu-eyebrow', 'ATLAS DO LAGO'), close);
    const facts = el('div', 'species-facts');
    facts.append(el('h2', '', sp.name), el('p', 'catch-scientific', sp.scientificName), el('p', 'menu-eyebrow', `EXCLUSIVO: ${getLake(speciesLake(id)).name}`), el('p', '', sp.habitat),
      el('p', '', `Profundidade: ${sp.depthRangeM.min}–${sp.depthRangeM.max} m · Água: ${sp.preferredTempC.min}–${sp.preferredTempC.max} °C`),
      el('h3', '', 'Prepare sua próxima pescaria'), el('p', '', `Iscas favoritas: ${sp.preferredLures.map((l) => LURE_LABELS[l]).join(', ')}.`));
    for (const curiosity of sp.curiosities) facts.append(el('p', 'note', curiosity));
    const browse = el('button', 'ui-btn compact', 'Ver capturas desta espécie →');
    browse.type = 'button';
    browse.addEventListener('click', () => {
      const select = this.root.querySelector<HTMLSelectElement>('[data-testid="gallery-filter-species"]');
      if (select) select.value = id;
      this.setFilter({ ...this.filter, speciesId: id });
      this.detail.close();
    });
    this.detail.setAttribute('aria-label', `Atlas: ${sp.name}`);
    this.detail.replaceChildren(head, speciesThumb(id), facts, browse);
    this.detail.showModal();
  }

  dispose(): void {
    this.disposed = true;
    this.detail.close();
    this.releaseDetailPhotos();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.length = 0;
    this.root.remove();
  }

  private releaseDetailPhotos(): void {
    for (const url of this.detailUrls) URL.revokeObjectURL(url);
    this.detailUrls.length = 0;
  }
}
