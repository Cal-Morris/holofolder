// A tiny promise-based key/value store on IndexedDB, for data that must outlive localStorage's ~5 MB quota
// and still be readable offline. Falls back to nothing (null store) where IndexedDB is unavailable.

export interface OfflineKeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  getMany<T = unknown>(keys: string[]): Promise<Array<T | undefined>>
  set(key: string, value: unknown): Promise<void>
  setMany(entries: Array<readonly [string, unknown]>): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

/** Synchronous read/modify/write in one transaction, serialized across tabs. */
export interface AtomicOfflineStore extends OfflineKeyValueStore {
  update(key: string, transform: (current: unknown) => unknown): Promise<void>
  updateMany<T>(keys: string[], transform: (current: Record<string, unknown>) => { writes: Array<readonly [string, unknown]>; result: T }): Promise<T>
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

let browserDatabase: IDBDatabase | null = null

export function createIndexedDbStore(factory: IDBFactory, name = OFFLINE_DB_NAME): AtomicOfflineStore {
  let databasePromise: Promise<IDBDatabase> | null = null
  const database = () => {
    databasePromise ??= openDatabase(factory, name).then((db) => {
      if (name === OFFLINE_DB_NAME) browserDatabase = db
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

  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>[]) => {
    const db = await database()
    const transaction = db.transaction(OFFLINE_DB_STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"))
    })
    let requests: IDBRequest<T>[]
    try {
      // Queue the whole batch before yielding, while the transaction is active.
      requests = action(transaction.objectStore(OFFLINE_DB_STORE))
    } catch (error) {
      transaction.abort()
      await done.catch(() => undefined)
      throw error
    }
    // Observe both failures, and only count writes once the transaction commits.
    const [results] = await Promise.all([Promise.all(requests.map(requestToPromise)), done])
    return results
  }

  return {
    async updateMany<T>(keys: string[], transform: (current: Record<string, unknown>) => { writes: Array<readonly [string, unknown]>; result: T }) {
      keys = [...keys]
      if (!keys.length || new Set(keys).size !== keys.length) throw new Error("Invalid atomic keys")
      const db = await database()
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_DB_STORE, "readwrite")
        let failure: unknown, result: T
        tx.oncomplete = () => resolve(result)
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("IndexedDB transaction aborted"))
        const store = tx.objectStore(OFFLINE_DB_STORE), current: Record<string, unknown> = Object.create(null)
        let remaining = keys.length
        for (const key of keys) {
          const request = store.get(key)
          request.onsuccess = () => {
            current[key] = request.result
            if (--remaining) return
            try {
              const next = transform(current)
              if (next.writes.some(([target]) => !keys.includes(target))) throw new Error("Atomic write outside named keys")
              for (const [target, value] of next.writes) store.put(value, target)
              result = structuredClone(next.result)
            } catch (error) { failure = error; tx.abort() }
          }
        }
      })
    },
    async update(key, transform) {
      const db = await database()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_DB_STORE, "readwrite")
        let failure: unknown
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("IndexedDB transaction aborted"))
        const store = tx.objectStore(OFFLINE_DB_STORE), request = store.get(key)
        request.onsuccess = () => {
          try { store.put(transform(request.result), key) }
          catch (error) { failure = error; tx.abort() }
        }
      })
    },
    async get<T>(key: string) {
      return (await run("readonly", (store) => [store.get(key)]))[0] as T | undefined
    },
    async getMany<T>(keys: string[]) {
      if (keys.length === 0) return []
      return await run("readonly", (store) => keys.map(key => store.get(key))) as Array<T | undefined>
    },
    async set(key, value) {
      await run("readwrite", (store) => [store.put(value, key)])
    },
    async setMany(entries) {
      if (entries.length === 0) return
      await run("readwrite", (store) => entries.map(([key, value]) => store.put(value, key)))
    },
    async delete(key) {
      await run("readwrite", (store) => [store.delete(key)])
    },
    async keys(prefix = "") {
      const all = (await run("readonly", (store) => [store.getAllKeys()]))[0] as IDBValidKey[]
      return all.map(String).filter((key) => key.startsWith(prefix))
    },
  }
}

/** In-memory store with the same contract (tests, and browsers without IndexedDB). */
export function createMemoryStore(initial: Record<string, unknown> = {}): AtomicOfflineStore {
  const records = new Map<string, unknown>(Object.entries(initial))
  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))
  return {
    async updateMany<T>(keys: string[], transform: (current: Record<string, unknown>) => { writes: Array<readonly [string, unknown]>; result: T }) {
      keys = [...keys]
      if (!keys.length || new Set(keys).size !== keys.length) throw new Error("Invalid atomic keys")
      const next = transform(Object.fromEntries(keys.map(key => [key, clone(records.get(key))])))
      if (next.writes.some(([target]) => !keys.includes(target))) throw new Error("Atomic write outside named keys")
      const copies = next.writes.map(([key, value]) => [key, clone(value)] as const), result = clone(next.result)
      for (const [key, value] of copies) records.set(key, value)
      return result
    },
    async update(key, transform) {
      const next = clone(transform(clone(records.get(key))))
      records.set(key, next)
    },
    async get<T>(key: string) {
      return clone(records.get(key)) as T | undefined
    },
    async getMany<T>(keys: string[]) {
      return keys.map(key => clone(records.get(key)) as T | undefined)
    },
    async set(key, value) {
      records.set(key, clone(value))
    },
    async setMany(entries) {
      const copies = entries.map(([key, value]) => [key, clone(value)] as const)
      for (const [key, value] of copies) records.set(key, value)
    },
    async delete(key) {
      records.delete(key)
    },
    async keys(prefix = "") {
      return [...records.keys()].filter((key) => key.startsWith(prefix))
    },
  }
}

let browserStore: AtomicOfflineStore | null | undefined

/** The app's IndexedDB store, or null on the server / where IndexedDB is unavailable. */
export function getOfflineStore(): AtomicOfflineStore | null {
  if (browserStore !== undefined) return browserStore
  browserStore = typeof indexedDB === "undefined" ? null : createIndexedDbStore(indexedDB)
  return browserStore
}

/** Used only by the explicit online startup reset. Credentials are stored separately. */
export async function deleteBrowserOfflineDatabase() {
  browserDatabase?.close()
  browserDatabase = null
  browserStore = undefined
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("offline_database_reset_blocked"))
  })
}
