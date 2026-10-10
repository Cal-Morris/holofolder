// A tiny promise-based key/value store on IndexedDB, for data that must outlive localStorage's ~5 MB quota
// and still be readable offline. Falls back to nothing (null store) where IndexedDB is unavailable.

export interface OfflineKeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export const OFFLINE_DB_NAME = "binderdex-offline"
export const OFFLINE_DB_VERSION = 1
export const OFFLINE_DB_STORE = "records"

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OFFLINE_DB_STORE)) {
        request.result.createObjectStore(OFFLINE_DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("IndexedDB open blocked"))
  })
}

export function createIndexedDbStore(factory: IDBFactory, name = OFFLINE_DB_NAME): OfflineKeyValueStore {
  let databasePromise: Promise<IDBDatabase> | null = null
  const database = () => {
    databasePromise ??= openDatabase(factory, name).then((db) => {
      // Another tab upgrading the schema: let it, and reopen on next use.
      db.onversionchange = () => {
        db.close()
        databasePromise = null
      }
      return db
    })
    databasePromise.catch(() => {
      databasePromise = null
    })
    return databasePromise
  }

  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await database()
    const transaction = db.transaction(OFFLINE_DB_STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"))
    })
    const result = await requestToPromise(action(transaction.objectStore(OFFLINE_DB_STORE)))
    // Writes only count once the transaction has committed.
    await done
    return result
  }

  return {
    async get<T>(key: string) {
      return (await run("readonly", (store) => store.get(key))) as T | undefined
    },
    async set(key, value) {
      await run("readwrite", (store) => store.put(value, key))
    },
    async delete(key) {
      await run("readwrite", (store) => store.delete(key))
    },
    async keys(prefix = "") {
      const all = (await run("readonly", (store) => store.getAllKeys())) as IDBValidKey[]
      return all.map(String).filter((key) => key.startsWith(prefix))
    },
  }
}

/** In-memory store with the same contract (tests, and browsers without IndexedDB). */
export function createMemoryStore(initial: Record<string, unknown> = {}): OfflineKeyValueStore {
  const records = new Map<string, unknown>(Object.entries(initial))
  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))
  return {
    async get<T>(key: string) {
      return clone(records.get(key)) as T | undefined
    },
    async set(key, value) {
      records.set(key, clone(value))
    },
    async delete(key) {
      records.delete(key)
    },
    async keys(prefix = "") {
      return [...records.keys()].filter((key) => key.startsWith(prefix))
    },
  }
}

let browserStore: OfflineKeyValueStore | null | undefined

/** The app's IndexedDB store, or null on the server / where IndexedDB is unavailable. */
export function getOfflineStore(): OfflineKeyValueStore | null {
  if (browserStore !== undefined) return browserStore
  browserStore = typeof indexedDB === "undefined" ? null : createIndexedDbStore(indexedDB)
  return browserStore
}
