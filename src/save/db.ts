/**
 * Wrapper fino sobre IndexedDB, sem dependência nova.
 * A versão do banco é o número de migrações registradas; onupgradeneeded aplica,
 * em ordem, só as que faltam (de oldVersion até a última). Acrescente migrações
 * no fim da lista; nunca reordene nem remova uma já publicada.
 */
export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** indexedDB do navegador, ou null quando bloqueado ou inexistente. */
export function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

/** Converte um IDBRequest em promessa. Nunca engole o erro: rejeita com o motivo do banco. */
export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('operação de IndexedDB falhou'));
  });
}

/**
 * Abre (ou cria) o banco aplicando as migrações pendentes em ordem.
 * Rejeita quando o IndexedDB não existe, está bloqueado por outra aba ou a abertura falha:
 * quem chama decide seguir sem salvar, com aviso ao jogador.
 */
export function openDatabase(
  name: string,
  migrations: readonly Migration[],
  factory: IDBFactory | null = defaultFactory(),
): Promise<IDBDatabase> {
  if (migrations.length === 0) {
    return Promise.reject(new Error('openDatabase exige ao menos uma migração: a v1 cria os stores'));
  }
  if (factory === null) {
    return Promise.reject(new Error('IndexedDB indisponível neste ambiente'));
  }
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, migrations.length);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (tx === null) return;
      for (const migrate of migrations.slice(event.oldVersion)) migrate(db, tx);
    };
    request.onblocked = () => fail(new Error(`banco "${name}" bloqueado por outra aba; feche-a e recarregue o jogo`));
    request.onerror = () => fail(request.error ?? new Error(`falha ao abrir o banco "${name}"`));
    request.onsuccess = () => {
      if (settled) {
        // Já rejeitamos (ex.: blocked) e o banco abriu depois: fecha para não segurar a conexão.
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
}
