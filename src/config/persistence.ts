import { computePoints, getSpecies, isSpeciesId, LURE_IDS, type LureId, type SpeciesId } from '../fish/species.ts';
import { isLakeId, type LakeId } from '../world/lakes.ts';

/**
 * Persistência local com schema versionado. Nada de dado pessoal: só preferências e números de jogo.
 * v1 (legado): { version: 1, volume, bestSpecies?, bestWeightKg?, totalCatches? }.
 * v2 (atual): SaveData abaixo. A qualidade aceita 'ultra' e 'auto' desde a entrada dos presets novos; como só
 * a faixa de valores cresceu (expandir sem contrair), o save v2 antigo continua válido sem migração.
 * settings.lureId entrou depois pelo mesmo princípio: save antigo sem o campo ganha o padrão, sem perda de dados.
 */
export const SAVE_KEY = 'pesqueepague.save';
export const SAVE_VERSION = 2;
const MAX_SAVE_CHARS = 64 * 1024;

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra', 'auto'] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

export interface Settings {
  readonly lakeId?: LakeId;
  readonly quality: Quality;
  readonly showHints: boolean;
  readonly cameraSensitivity: number;
  /** Isca escolhida pelo jogador; usada pela sessão de pesca. */
  readonly lureId: LureId;
}

function isLureId(value: unknown): value is LureId {
  return typeof value === 'string' && (LURE_IDS as readonly string[]).includes(value);
}

export interface Volumes {
  readonly master: number;
  readonly music: number;
  readonly sfx: number;
}

export interface BestCatch {
  readonly speciesId: SpeciesId;
  readonly weightKg: number;
  readonly points: number;
}

export interface Stats {
  readonly catches: number;
  readonly escapes: number;
  readonly totalPoints: number;
  readonly totalWeightKg: number;
}

export interface SaveData {
  readonly version: typeof SAVE_VERSION;
  readonly settings: Settings;
  readonly volumes: Volumes;
  readonly bestCatch: BestCatch | null;
  readonly stats: Stats;
}

export type LoadStatus = 'ok' | 'empty' | 'migrated' | 'invalid' | 'unavailable';

export interface LoadResult {
  readonly data: SaveData;
  readonly status: LoadStatus;
  /** O que foi descartado ou trocado pelo padrão, para log/diagnóstico. */
  readonly issues: readonly string[];
}

/** Subconjunto de Storage usado aqui; permite injetar um armazenamento em memória nos testes. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultSaveData(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { quality: 'medium', showHints: true, cameraSensitivity: 1, lureId: 'worm' },
    volumes: { master: 0.8, music: 0.6, sfx: 0.8 },
    bestCatch: null,
    stats: { catches: 0, escapes: 0, totalPoints: 0, totalWeightKg: 0 },
  };
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Reader {
  readonly issues: string[] = [];

  section(raw: Raw, key: string): Raw {
    const value = raw[key];
    if (isRecord(value)) return value;
    if (value !== undefined) this.issues.push(`${key} não é objeto`);
    return {};
  }

  number(raw: Raw, key: string, path: string, min: number, max: number, fallback: number, integer = false): number {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      this.issues.push(`${path} inválido`);
      return fallback;
    }
    return value;
  }

  boolean(raw: Raw, key: string, path: string, fallback: boolean): boolean {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      this.issues.push(`${path} inválido`);
      return fallback;
    }
    return value;
  }

  bestCatch(value: unknown): BestCatch | null {
    if (value === null || value === undefined) return null;
    if (
      isRecord(value) &&
      isSpeciesId(value['speciesId']) &&
      typeof value['weightKg'] === 'number' &&
      Number.isFinite(value['weightKg']) &&
      value['weightKg'] > 0 &&
      value['weightKg'] <= 100 &&
      typeof value['points'] === 'number' &&
      Number.isInteger(value['points']) &&
      value['points'] >= 0
    ) {
      return { speciesId: value['speciesId'], weightKg: value['weightKg'], points: value['points'] };
    }
    this.issues.push('bestCatch inválido');
    return null;
  }
}

const MAX_COUNT = 1e9;

function parseV2(raw: Raw): LoadResult {
  const d = defaultSaveData();
  const r = new Reader();
  const s = r.section(raw, 'settings');
  const v = r.section(raw, 'volumes');
  const st = r.section(raw, 'stats');
  const quality = s['quality'];
  let parsedQuality: Quality = d.settings.quality;
  if (typeof quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(quality)) {
    parsedQuality = quality as Quality;
  } else if (quality !== undefined) {
    r.issues.push('settings.quality inválido');
  }
  const lure = s['lureId'];
  let parsedLure: LureId = d.settings.lureId;
  if (isLureId(lure)) {
    parsedLure = lure;
  } else if (lure !== undefined) {
    r.issues.push('settings.lureId inválido');
  }
  const data: SaveData = {
    version: SAVE_VERSION,
    settings: {
      ...(isLakeId(s['lakeId']) ? { lakeId: s['lakeId'] } : {}),
      quality: parsedQuality,
      showHints: r.boolean(s, 'showHints', 'settings.showHints', d.settings.showHints),
      cameraSensitivity: r.number(s, 'cameraSensitivity', 'settings.cameraSensitivity', 0.1, 3, d.settings.cameraSensitivity),
      lureId: parsedLure,
    },
    volumes: {
      master: r.number(v, 'master', 'volumes.master', 0, 1, d.volumes.master),
      music: r.number(v, 'music', 'volumes.music', 0, 1, d.volumes.music),
      sfx: r.number(v, 'sfx', 'volumes.sfx', 0, 1, d.volumes.sfx),
    },
    bestCatch: r.bestCatch(raw['bestCatch']),
    stats: {
      catches: r.number(st, 'catches', 'stats.catches', 0, MAX_COUNT, 0, true),
      escapes: r.number(st, 'escapes', 'stats.escapes', 0, MAX_COUNT, 0, true),
      totalPoints: r.number(st, 'totalPoints', 'stats.totalPoints', 0, Number.MAX_SAFE_INTEGER, 0, true),
      totalWeightKg: r.number(st, 'totalWeightKg', 'stats.totalWeightKg', 0, 1e9, 0),
    },
  };
  return { data, status: r.issues.length === 0 ? 'ok' : 'invalid', issues: r.issues };
}

function migrateV1(raw: Raw): LoadResult {
  const d = defaultSaveData();
  const r = new Reader();
  const master = r.number(raw, 'volume', 'volume', 0, 1, d.volumes.master);
  const catches = r.number(raw, 'totalCatches', 'totalCatches', 0, MAX_COUNT, 0, true);
  let bestCatch: BestCatch | null = null;
  const species = raw['bestSpecies'];
  const weight = r.number(raw, 'bestWeightKg', 'bestWeightKg', Number.MIN_VALUE, 100, 0);
  if (isSpeciesId(species) && weight > 0) {
    bestCatch = { speciesId: species, weightKg: weight, points: computePoints(getSpecies(species), weight) };
  } else if (species !== undefined) {
    r.issues.push('bestSpecies inválido');
  }
  return {
    data: { ...d, volumes: { ...d.volumes, master }, bestCatch, stats: { ...d.stats, catches } },
    status: 'migrated',
    issues: r.issues,
  };
}

/** Valida e migra dados já desserializados. Nunca lança: o que não presta vira padrão. */
export function parseSaveData(raw: unknown): LoadResult {
  if (!isRecord(raw)) return { data: defaultSaveData(), status: 'invalid', issues: ['raiz do save não é objeto'] };
  const version = raw['version'];
  if (version === SAVE_VERSION) return parseV2(raw);
  if (version === 1) return migrateV1(raw);
  return { data: defaultSaveData(), status: 'invalid', issues: [`versão de save não suportada: ${String(version)}`] };
}

export function loadSave(store: KeyValueStore | null, key: string = SAVE_KEY): LoadResult {
  if (!store) return { data: defaultSaveData(), status: 'unavailable', issues: ['armazenamento local indisponível'] };
  let text: string | null;
  try {
    text = store.getItem(key);
  } catch (error) {
    return { data: defaultSaveData(), status: 'unavailable', issues: [`falha ao ler o save: ${String(error)}`] };
  }
  if (text === null) return { data: defaultSaveData(), status: 'empty', issues: [] };
  if (text.length > MAX_SAVE_CHARS) {
    return { data: defaultSaveData(), status: 'invalid', issues: ['save maior que o limite permitido'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { data: defaultSaveData(), status: 'invalid', issues: ['save não é JSON válido'] };
  }
  return parseSaveData(parsed);
}

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function writeSave(store: KeyValueStore | null, data: SaveData, key: string = SAVE_KEY): SaveResult {
  if (!store) return { ok: false, error: 'armazenamento local indisponível' };
  const checked = parseSaveData(data);
  if (checked.status !== 'ok') return { ok: false, error: `save recusado: ${checked.issues.join('; ')}` };
  try {
    store.setItem(key, JSON.stringify(checked.data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `falha ao gravar o save: ${String(error)}` };
  }
}

/** localStorage do navegador, ou null quando bloqueado ou inexistente. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface OutcomeRecord {
  readonly outcome: 'caught' | 'escaped';
  readonly speciesId: SpeciesId;
  readonly weightKg: number;
  readonly points: number;
}

/** Atualiza estatísticas e melhor captura (pelo peso) com o resultado de um arremesso. */
export function recordOutcome(data: SaveData, record: OutcomeRecord): SaveData {
  if (record.outcome === 'escaped') {
    return { ...data, stats: { ...data.stats, escapes: data.stats.escapes + 1 } };
  }
  const better = data.bestCatch === null || record.weightKg > data.bestCatch.weightKg;
  return {
    ...data,
    bestCatch: better
      ? { speciesId: record.speciesId, weightKg: record.weightKg, points: record.points }
      : data.bestCatch,
    stats: {
      ...data.stats,
      catches: data.stats.catches + 1,
      totalPoints: data.stats.totalPoints + record.points,
      totalWeightKg: Math.round((data.stats.totalWeightKg + record.weightKg) * 1000) / 1000,
    },
  };
}
