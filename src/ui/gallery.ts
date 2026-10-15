import { getSpecies, RARITIES, SPECIES, type LureId, type Rarity, type SpeciesId } from '../fish/species.ts';
import type { CatchRecord } from '../progression/types.ts';

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
const LOCATION_LABELS: Readonly<Record<string, string>> = {
  'lago-principal': 'Lago Tropical',
};

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
  svg.innerHTML =
    `<rect width="120" height="90" fill="#0b2430"/>` +
    `<ellipse cx="58" cy="45" rx="34" ry="${14 + Math.round(sp.visual.proportions.bodyDepth * 20)}" fill="${sp.visual.palette.flank}"/>` +
    `<ellipse cx="58" cy="38" rx="34" ry="8" fill="${sp.visual.palette.dorsal}" opacity="0.8"/>` +
    `<polygon points="92,45 112,30 112,60" fill="${sp.visual.palette.fin}"/>` +
    `<circle cx="34" cy="41" r="2.5" fill="#101418"/>`;
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
  private readonly searchInput: HTMLInputElement;
  private readonly objectUrls: string[] = [];
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
    this.root.append(el('h2', '', 'Galeria'));

    const controls = el('div', 'gallery-controls');
    const species = labeledSelect(
      'Espécie',
      'gallery-filter-species',
      [{ value: '', text: 'Todas' }, ...SPECIES.map((s) => ({ value: s.id, text: s.name }))],
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

    const trophyBtn = el('button', 'ui-btn', 'Sala de troféus');
    trophyBtn.type = 'button';
    trophyBtn.dataset['testid'] = 'gallery-trophy-room';
    trophyBtn.addEventListener('click', onOpenTrophyRoom);

    this.root.append(controls, this.status, this.list, trophyBtn);
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
    const visible = sortCatches(filterCatches(this.records, this.filter), this.sort);
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

  private card(record: CatchRecord): HTMLElement {
    const sp = getSpecies(record.speciesId);
    const li = el('li', 'gallery-card');
    li.dataset['testid'] = 'gallery-card';
    if (record.photoId !== undefined && this.data !== null) {
      const img = el('img', 'gallery-thumb');
      img.alt = `Foto da captura: ${sp.name}, ${formatKg(record.weightKg)}`;
      img.loading = 'lazy';
      const placeholder = speciesThumb(record.speciesId);
      li.append(placeholder);
      void this.data.getPhoto(record.photoId).then((blob) => {
        if (this.disposed || blob === undefined) return;
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        img.src = url;
        placeholder.replaceWith(img);
      });
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
    return li;
  }

  dispose(): void {
    this.disposed = true;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.length = 0;
    this.root.remove();
  }
}
