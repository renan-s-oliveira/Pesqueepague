import { defaultFactory, openDatabase, requestAsPromise, type Migration } from './db.ts';

export const SAVE_DB_NAME = 'pesqueepague';

export const STORE_NAMES = ['catches', 'photos', 'inventory', 'achievements', 'meta'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** Todo valor gravado tem `id` como chave primária (keyPath dos stores). */
export interface StoredValue {
  readonly id: string;
}

/** Armazenamento chave-valor por store; o CatchRepository fala só com esta interface. */
export interface SaveStorage {
  get<T extends StoredValue>(store: StoreName, id: string): Promise<T | undefined>;
  getAll<T extends StoredValue>(store: StoreName): Promise<readonly T[]>;
  put<T extends StoredValue>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, id: string): Promise<void>;
  close(): void;
}

/** Migrações do banco de save. Acrescente no fim; a versão do banco é o tamanho desta lista. */
export const SAVE_DB_MIGRATIONS: readonly Migration[] = [
  // v1: stores da galeria (capturas, fotos, inventário, conquistas e metadados de migração).
  (db) => {
    for (const name of STORE_NAMES) db.createObjectStore(name, { keyPath: 'id' });
  },
];

/** Adapter real: cada operação roda numa transação curta do IndexedDB. */
export class IndexedDbAdapter implements SaveStorage {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string = SAVE_DB_NAME, factory: IDBFactory | null = defaultFactory()): Promise<IndexedDbAdapter> {
    return new IndexedDbAdapter(await openDatabase(name, SAVE_DB_MIGRATIONS, factory));
  }

  private run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return requestAsPromise(op(this.db.transaction(store, mode).objectStore(store)));
  }

  async get<T extends StoredValue>(store: StoreName, id: string): Promise<T | undefined> {
    return (await this.run(store, 'readonly', (s) => s.get(id))) as T | undefined;
  }

  async getAll<T extends StoredValue>(store: StoreName): Promise<readonly T[]> {
    return (await this.run(store, 'readonly', (s) => s.getAll())) as readonly T[];
  }

  async put(store: StoreName, value: StoredValue): Promise<void> {
    await this.run(store, 'readwrite', (s) => s.put(value));
  }

  async delete(store: StoreName, id: string): Promise<void> {
    await this.run(store, 'readwrite', (s) => s.delete(id));
  }

  close(): void {
    this.db.close();
  }
}

/** Adapter em memória para testes: mesma interface, nenhum IndexedDB. */
export class MemoryAdapter implements SaveStorage {
  private readonly stores = new Map<StoreName, Map<string, StoredValue>>();

  private table(store: StoreName): Map<string, StoredValue> {
    let table = this.stores.get(store);
    if (table === undefined) {
      table = new Map();
      this.stores.set(store, table);
    }
    return table;
  }

  async get<T extends StoredValue>(store: StoreName, id: string): Promise<T | undefined> {
    return this.table(store).get(id) as T | undefined;
  }

  async getAll<T extends StoredValue>(store: StoreName): Promise<readonly T[]> {
    return [...this.table(store).values()] as T[];
  }

  async put(store: StoreName, value: StoredValue): Promise<void> {
    this.table(store).set(value.id, value);
  }

  async delete(store: StoreName, id: string): Promise<void> {
    this.table(store).delete(id);
  }

  close(): void {
    this.stores.clear();
  }
}
