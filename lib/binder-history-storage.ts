import { emptyHistory, parseHistoryStore, type HistoryStorage, type HistoryStore } from "./binder-history"

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("binderdex-history", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("history")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
  })
}

/** The read, sequence allocation and write share one cross-tab atomic transaction. */
export function historyStorage(key: string): HistoryStorage {
  return {
    async update(change) {
      const db = await openDatabase()
      return new Promise<HistoryStore>((resolve, reject) => {
        const transaction = db.transaction("history", "readwrite")
        const records = transaction.objectStore("history")
        const request = records.get(key)
        let next: HistoryStore
        request.onsuccess = () => {
          try {
            // Import only this exact account/owner/binder's legacy queue, once.
            let current = parseHistoryStore(request.result ?? null)
            if (!current) {
              try {
                const legacy = parseHistoryStore(localStorage.getItem(key))
                // Old-version tabs may still write localStorage. Their receipt sequence must
                // never collide with this transactional store's future actions.
                if (legacy) current = { ...legacy, clientId: crypto.randomUUID() }
              } catch { /* Storage can be disabled independently. */ }
            }
            current ??= { ...emptyHistory(), clientId: crypto.randomUUID(), sequence: 0, pending: [] }
            next = change(current)
            const encoded = JSON.stringify(next)
            if (encoded !== request.result) records.put(encoded, key)
          } catch { transaction.abort() }
        }
        transaction.oncomplete = () => resolve(next)
        transaction.onabort = () => reject(transaction.error ?? new Error("History could not be saved on this device"))
        transaction.onerror = () => reject(transaction.error)
      })
    },
    async sync(run) {
      // Without cross-tab request ordering, keep the durable queue offline. Never fall back
      // to an in-memory mutex or a localStorage lease (neither is cross-tab atomic).
      if (!navigator.locks) throw new Error("Shared history requires Web Locks")
      return navigator.locks.request(`${key}:sync`, run)
    },
  }
}
