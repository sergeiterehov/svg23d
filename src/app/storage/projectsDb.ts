import type { ProjectFile } from '@core/model/project';

/**
 * Project library in the browser (ADR-0031). Each record is a complete project file plus the
 * identity the library needs: a guid (names may repeat, ids must not) and the edit date used to
 * sort the list. IndexedDB is used instead of localStorage because the SVG source and the settings
 * of a real project do not fit into the ~5 MB string quota.
 */

export interface ProjectRecord extends ProjectFile {
  /** Library identity. Never reused, never derived from the name. */
  id: string;
  /** Display name shown in the header; editable. */
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type ProjectSummary = Pick<ProjectRecord, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

const DB_NAME = 'svg23d';
const DB_VERSION = 1;
const STORE = 'projects';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB недоступна'));
  });
  return database;
}

function request<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const pending = run(transaction.objectStore(STORE));
        pending.onsuccess = () => resolve(pending.result as T);
        pending.onerror = () => reject(pending.error ?? new Error('Ошибка IndexedDB'));
      }),
  );
}

/** Every stored project, most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await request<ProjectRecord[]>('readonly', (store) => store.getAll());
  return records
    .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): Promise<ProjectRecord | null> {
  return request<ProjectRecord | undefined>('readonly', (store) => store.get(id)).then(
    (record) => record ?? null,
  );
}

export function putProject(record: ProjectRecord): Promise<void> {
  return request<void>('readwrite', (store) => store.put(record));
}

export function deleteProject(id: string): Promise<void> {
  return request<void>('readwrite', (store) => store.delete(id));
}
