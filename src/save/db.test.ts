import { describe, expect, it } from 'vitest';
import { openDatabase, requestAsPromise, type Migration } from './db.ts';

type Handler<E> = ((ev: E) => void) | null;

interface FakeOpenRequest {
  result: IDBDatabase;
  transaction: IDBTransaction | null;
  error: DOMException | null;
  onupgradeneeded: Handler<IDBVersionChangeEvent>;
  onsuccess: Handler<Event>;
  onerror: Handler<Event>;
  onblocked: Handler<Event>;
}

type Outcome = 'success' | 'error' | 'blocked';

/** IDBFactory mínimo: dispara os handlers que db.ts usa, sem IndexedDB real. */
function makeFactory(oldVersion: number, outcome: Outcome): { factory: IDBFactory; openedWith: number[]; db: IDBDatabase; tx: IDBTransaction } {
  const closed: string[] = [];
  const db = { close: () => closed.push('close') } as unknown as IDBDatabase;
  const tx = { mode: 'versionchange' } as unknown as IDBTransaction;
  const openedWith: number[] = [];
  const factory = {
    open(_name: string, version?: number): IDBOpenDBRequest {
      openedWith.push(version ?? 0);
      const request: FakeOpenRequest = {
        result: db,
        transaction: tx,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (outcome === 'blocked') {
          request.onblocked?.(new Event('blocked'));
          return;
        }
        if (oldVersion < (version ?? 0)) {
          request.onupgradeneeded?.({ oldVersion, newVersion: version ?? 0 } as IDBVersionChangeEvent);
        }
        if (outcome === 'error') {
          request.error = new DOMException('quota cheia', 'QuotaExceededError');
          request.onerror?.(new Event('error'));
          return;
        }
        request.onsuccess?.(new Event('success'));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return { factory, openedWith, db, tx };
}

describe('openDatabase', () => {
  it('abre com versão igual ao número de migrações e aplica todas em ordem a partir do zero', async () => {
    const { factory, openedWith, db, tx } = makeFactory(0, 'success');
    const applied: number[] = [];
    const migrations: Migration[] = [0, 1, 2].map((i) => (gotDb, gotTx) => {
      expect(gotDb).toBe(db);
      expect(gotTx).toBe(tx);
      applied.push(i);
    });
    const opened = await openDatabase('teste', migrations, factory);
    expect(opened).toBe(db);
    expect(openedWith).toEqual([3]);
    expect(applied).toEqual([0, 1, 2]);
  });

  it('num banco já na v1 aplica só as migrações que faltam', async () => {
    const { factory } = makeFactory(1, 'success');
    const applied: number[] = [];
    const migrations: Migration[] = [0, 1, 2].map((i) => () => applied.push(i));
    await openDatabase('teste', migrations, factory);
    expect(applied).toEqual([1, 2]);
  });

  it('rejeita quando o banco está bloqueado por outra aba', async () => {
    const { factory } = makeFactory(0, 'blocked');
    await expect(openDatabase('teste', [() => {}], factory)).rejects.toThrow(/bloqueado/);
  });

  it('rejeita com o erro do banco quando a abertura falha', async () => {
    const { factory } = makeFactory(0, 'error');
    await expect(openDatabase('teste', [() => {}], factory)).rejects.toThrow(/quota cheia/);
  });

  it('rejeita sem IndexedDB no ambiente e sem nenhuma migração', async () => {
    await expect(openDatabase('teste', [() => {}], null)).rejects.toThrow(/indisponível/);
    const { factory } = makeFactory(0, 'success');
    await expect(openDatabase('teste', [], factory)).rejects.toThrow(/ao menos uma migração/);
  });
});

describe('requestAsPromise', () => {
  interface FakeRequest {
    result: string;
    error: DOMException | null;
    onsuccess: Handler<Event>;
    onerror: Handler<Event>;
  }

  it('resolve com o result no sucesso e rejeita com o erro na falha', async () => {
    const ok: FakeRequest = { result: 'valor', error: null, onsuccess: null, onerror: null };
    const okPromise = requestAsPromise(ok as unknown as IDBRequest<string>);
    ok.onsuccess?.(new Event('success'));
    await expect(okPromise).resolves.toBe('valor');

    const bad: FakeRequest = { result: '', error: new DOMException('leitura falhou'), onsuccess: null, onerror: null };
    const badPromise = requestAsPromise(bad as unknown as IDBRequest<string>);
    bad.onerror?.(new Event('error'));
    await expect(badPromise).rejects.toThrow(/leitura falhou/);
  });
});
