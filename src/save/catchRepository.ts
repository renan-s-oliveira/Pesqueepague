import type { SaveData, Stats } from '../config/persistence.ts';
import { getSpecies, individualRarity, lengthForWeightCm, type Rarity, type SpeciesId } from '../fish/species.ts';
import type { CatchRecord } from '../progression/types.ts';
import type { SaveStorage, StoredValue } from './storage.ts';

/** Local padrão do MVP: o lago único da cena atual. */
export const DEFAULT_LOCATION_ID = 'lago-principal';
/** Id fixo da captura criada a partir do bestCatch do localStorage: a migração é idempotente. */
export const LEGACY_BEST_CATCH_ID = 'legado-melhor-captura';
const LEGACY_MIGRATION_ID = 'migracao-save-local';

export interface PhotoRecord extends StoredValue {
  readonly blob: Blob;
}

export interface InventoryItem extends StoredValue {
  readonly quantity: number;
}

export interface Achievement extends StoredValue {
  readonly unlockedAt: number;
}

/** Marca da migração única do pesqueepague.save, com o retrato das estatísticas na época. */
export interface LegacyMigrationMeta extends StoredValue {
  readonly migratedAt: number;
  readonly stats: Stats;
}

/** Filtros combináveis; campo ausente não filtra. Pesos em kg e datas em epoch ms, inclusivos. */
export interface CatchQuery {
  readonly speciesId?: SpeciesId;
  readonly rarity?: Rarity;
  readonly locationId?: string;
  readonly minWeightKg?: number;
  readonly maxWeightKg?: number;
  readonly from?: number;
  readonly to?: number;
}

export interface LegacyMigrationResult {
  readonly migrated: boolean;
  readonly record: CatchRecord | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** CRUD de capturas, fotos (Blob), inventário e conquistas sobre um SaveStorage. */
export class CatchRepository {
  constructor(private readonly storage: SaveStorage) {}

  // Capturas -----------------------------------------------------------------

  async put(record: CatchRecord): Promise<void> {
    await this.storage.put('catches', record);
  }

  async get(id: string): Promise<CatchRecord | undefined> {
    return this.storage.get<CatchRecord>('catches', id);
  }

  /** Todas as capturas, da mais recente para a mais antiga. */
  async list(): Promise<readonly CatchRecord[]> {
    const all = await this.storage.getAll<CatchRecord>('catches');
    return [...all].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Remove a captura e, junto, a foto dela quando existir. */
  async remove(id: string): Promise<void> {
    const record = await this.get(id);
    if (record?.photoId !== undefined) await this.storage.delete('photos', record.photoId);
    await this.storage.delete('catches', id);
  }

  async query(filter: CatchQuery): Promise<readonly CatchRecord[]> {
    const all = await this.list();
    return all.filter(
      (c) =>
        (filter.speciesId === undefined || c.speciesId === filter.speciesId) &&
        (filter.rarity === undefined || c.rarity === filter.rarity) &&
        (filter.locationId === undefined || c.locationId === filter.locationId) &&
        (filter.minWeightKg === undefined || c.weightKg >= filter.minWeightKg) &&
        (filter.maxWeightKg === undefined || c.weightKg <= filter.maxWeightKg) &&
        (filter.from === undefined || c.timestamp >= filter.from) &&
        (filter.to === undefined || c.timestamp <= filter.to),
    );
  }

  // Fotos ---------------------------------------------------------------------

  async putPhoto(id: string, blob: Blob): Promise<void> {
    await this.storage.put('photos', { id, blob } satisfies PhotoRecord);
  }

  async getPhoto(id: string): Promise<Blob | undefined> {
    return (await this.storage.get<PhotoRecord>('photos', id))?.blob;
  }

  // Inventário ----------------------------------------------------------------

  /** Define a quantidade do item; zero remove a entrada. */
  async setItemQuantity(id: string, quantity: number): Promise<void> {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RangeError(`quantidade inválida para "${id}": ${String(quantity)} (use inteiro >= 0)`);
    }
    if (quantity === 0) await this.storage.delete('inventory', id);
    else await this.storage.put('inventory', { id, quantity } satisfies InventoryItem);
  }

  async getItemQuantity(id: string): Promise<number> {
    return (await this.storage.get<InventoryItem>('inventory', id))?.quantity ?? 0;
  }

  async listInventory(): Promise<readonly InventoryItem[]> {
    return this.storage.getAll<InventoryItem>('inventory');
  }

  // Conquistas ----------------------------------------------------------------

  /** Desbloqueia a conquista; chamadas repetidas mantêm o primeiro horário. */
  async unlock(id: string, unlockedAt: number): Promise<void> {
    const existing = await this.storage.get<Achievement>('achievements', id);
    if (existing !== undefined) return;
    await this.storage.put('achievements', { id, unlockedAt } satisfies Achievement);
  }

  async isUnlocked(id: string): Promise<boolean> {
    return (await this.storage.get<Achievement>('achievements', id)) !== undefined;
  }

  async listAchievements(): Promise<readonly Achievement[]> {
    return this.storage.getAll<Achievement>('achievements');
  }

  // Migração única do localStorage ---------------------------------------------

  /**
   * Copia o bestCatch e o stats do pesqueepague.save (localStorage) para o IndexedDB uma única vez.
   * A marca em `meta` impede repetição; as configurações continuam no localStorage.
   */
  async migrateLegacySave(save: SaveData, now: number = Date.now()): Promise<LegacyMigrationResult> {
    const done = await this.storage.get<LegacyMigrationMeta>('meta', LEGACY_MIGRATION_ID);
    if (done !== undefined) return { migrated: false, record: null };
    let record: CatchRecord | null = null;
    if (save.bestCatch !== null) {
      const species = getSpecies(save.bestCatch.speciesId);
      record = {
        id: LEGACY_BEST_CATCH_ID,
        speciesId: save.bestCatch.speciesId,
        weightKg: save.bestCatch.weightKg,
        lengthCm: round1(lengthForWeightCm(species, save.bestCatch.weightKg)),
        timestamp: now,
        locationId: DEFAULT_LOCATION_ID,
        lureId: save.settings.lureId,
        rarity: individualRarity(species, save.bestCatch.weightKg),
        disposition: 'kept',
        isPersonalRecord: true,
      };
      await this.put(record);
    }
    await this.storage.put('meta', { id: LEGACY_MIGRATION_ID, migratedAt: now, stats: save.stats } satisfies LegacyMigrationMeta);
    return { migrated: true, record };
  }

  close(): void {
    this.storage.close();
  }
}
