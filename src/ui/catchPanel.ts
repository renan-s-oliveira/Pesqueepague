import { getSpecies, type LureId, type Rarity } from '../fish/species.ts';
import type { CaughtFish } from '../gameplay/fishingSession.ts';
import { LAKES } from '../world/lakes.ts';

export const LURE_LABELS: Readonly<Record<LureId, string>> = {
  worm: 'Minhoca',
  dough: 'Massa',
  corn: 'Milho',
  pellet: 'Ração',
  spinner: 'Spinner',
  popper: 'Popper',
  jig: 'Jig',
};

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  legendary: 'Lendário',
};

const LOCATION_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LAKES.map((lake) => [lake.locationId, lake.name])),
  'lago-principal': 'Lago principal',
};

export function formatWeightKg(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(2).replace('.', ',')} kg`;
}

export function formatLengthCm(cm: number): string {
  return `${cm.toFixed(1).replace('.', ',')} cm`;
}

/** Hora fracionária (0–24) como HH:MM. */
export function formatHour(hour: number): string {
  const total = Math.round((((hour % 24) + 24) % 24) * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/**
 * Painel da captura: nome popular e científico, peso, comprimento, raridade, local, hora, isca,
 * recorde pessoal e maior exemplar da espécie. Os dois últimos chegam depois (consulta à galeria):
 * até lá mostram um traço, nunca um espaço vazio.
 */
export class CatchPanel {
  readonly root = el('div', 'panel capture-panel');
  private readonly personalBest = el('dd', 'catch-value', '—');
  private readonly biggest = el('dd', 'catch-value', '—');

  constructor(fish: CaughtFish, locationId: string, isPersonalRecord: boolean) {
    const species = getSpecies(fish.individual.speciesId);
    this.root.dataset['testid'] = 'catch-panel';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', `Ficha da captura: ${species.name}`);

    const header = el('div', 'catch-header');
    header.append(
      el('h2', 'catch-name', species.name),
      el('p', 'catch-scientific', species.scientificName),
      el('span', `catch-rarity rarity-${fish.individual.rarity}`, RARITY_LABELS[fish.individual.rarity]),
    );
    if (isPersonalRecord) header.append(el('span', 'catch-record-badge', 'Novo recorde pessoal!'));

    const rows = el('dl', 'catch-rows');
    const row = (label: string, value: string, testId: string): HTMLElement => {
      const dd = el('dd', 'catch-value', value);
      dd.dataset['testid'] = testId;
      rows.append(el('dt', '', label), dd);
      return dd;
    };
    row('Peso', formatWeightKg(fish.individual.weightKg), 'catch-weight');
    row('Comprimento', formatLengthCm(fish.individual.lengthCm), 'catch-length');
    row('Raridade', RARITY_LABELS[fish.individual.rarity], 'catch-rarity');
    row(
      'Local',
      `${LOCATION_LABELS[locationId] ?? locationId}, a ${Math.round(fish.location.distanceM)} m do píer`,
      'catch-location',
    );
    row('Hora', formatHour(fish.hour), 'catch-hour');
    row('Isca', LURE_LABELS[fish.lureId], 'catch-lure');
    this.personalBest.dataset['testid'] = 'catch-personal-best';
    rows.append(el('dt', '', 'Recorde pessoal'), this.personalBest);
    this.biggest.dataset['testid'] = 'catch-biggest';
    rows.append(el('dt', '', 'Maior exemplar'), this.biggest);

    this.root.append(header, rows);
  }

  /** Preenche recorde pessoal e maior exemplar quando a consulta à galeria termina. */
  setRecords(personalBestKg: number | null, biggestForSpeciesKg: number | null): void {
    this.personalBest.textContent = personalBestKg === null ? 'Primeira captura!' : formatWeightKg(personalBestKg);
    this.biggest.textContent = biggestForSpeciesKg === null ? '—' : formatWeightKg(biggestForSpeciesKg);
  }
}
