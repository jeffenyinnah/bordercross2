import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LocalPolicy, LocalStore, OutboxItem, StoreOp } from './types'

interface Schema extends DBSchema {
  kv: { key: string; value: unknown }
  outbox: { key: number; value: OutboxItem; indexes: { client_uuid: string } }
  policies: { key: string; value: LocalPolicy; indexes: { created_at: string } }
}

const STORES = ['kv', 'outbox', 'policies'] as const

/**
 * IndexedDB store for the PWA. Every commit is one IndexedDB transaction, so a
 * sale either takes its number, queues its record and saves its policy, or does
 * none of it. Data sits in Chrome's app sandbox on an encrypted Android device;
 * call requestPersistence() so the browser never evicts unsynced sales.
 */
export class IdbStore implements LocalStore {
  private constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = 'bordercross'): Promise<IdbStore> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('kv')
        db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
          .createIndex('client_uuid', 'client_uuid', { unique: true })
        db.createObjectStore('policies', { keyPath: 'client_uuid' })
          .createIndex('created_at', 'created_at')
      },
    })
    return new IdbStore(db)
  }

  async get<T>(key: string): Promise<T | null> {
    return ((await this.db.get('kv', key)) as T | undefined) ?? null
  }

  async set(key: string, value: unknown) {
    await this.commit([{ type: 'set', key, value }])
  }

  async remove(key: string) {
    await this.commit([{ type: 'remove', key }])
  }

  async commit(ops: StoreOp[]) {
    const tx = this.db.transaction(STORES, 'readwrite')
    const requests: Promise<unknown>[] = ops.map((op) => {
      switch (op.type) {
        case 'set': return tx.objectStore('kv').put(op.value, op.key)
        case 'remove': return tx.objectStore('kv').delete(op.key)
        case 'outbox': {
          // the store assigns seq; a duplicate client_uuid aborts the whole transaction
          const { seq: _seq, ...item } = op.item
          return tx.objectStore('outbox').add(item as OutboxItem)
        }
        case 'outbox_remove': {
          const outbox = tx.objectStore('outbox')
          return outbox.index('client_uuid').getKey(op.client_uuid)
            .then((key) => (key === undefined ? undefined : outbox.delete(key)))
        }
        case 'outbox_error': {
          const outbox = tx.objectStore('outbox')
          return outbox.index('client_uuid').get(op.client_uuid).then((item) => item && outbox.put({
            ...item, attempts: item.attempts + 1, last_error: op.error,
          }))
        }
        case 'policy': return tx.objectStore('policies').put(op.policy)
      }
    })
    await Promise.all([...requests, tx.done])
  }

  async listOutbox(): Promise<OutboxItem[]> {
    return this.db.getAll('outbox')
  }

  async listPolicies(limit = 50): Promise<LocalPolicy[]> {
    const out: LocalPolicy[] = []
    let cursor = await this.db.transaction('policies').store.index('created_at').openCursor(null, 'prev')
    while (cursor && out.length < limit) {
      out.push(cursor.value)
      cursor = await cursor.continue()
    }
    return out
  }

  async getPolicy(clientUuid: string): Promise<LocalPolicy | null> {
    return (await this.db.get('policies', clientUuid)) ?? null
  }

  async clear(keepPrefix?: string) {
    const tx = this.db.transaction(STORES, 'readwrite')
    const kv = tx.objectStore('kv')
    const doomed = (await kv.getAllKeys()).filter((k) => !keepPrefix || !k.startsWith(keepPrefix))
    await Promise.all([
      ...doomed.map((k) => kv.delete(k)),
      tx.objectStore('outbox').clear(),
      tx.objectStore('policies').clear(),
      tx.done,
    ])
  }
}

/**
 * Ask Chrome not to evict this app's storage under disk pressure. Installed
 * PWAs on Android are normally granted it; returns whether storage is persistent.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  return (await navigator.storage.persisted()) || navigator.storage.persist()
}
