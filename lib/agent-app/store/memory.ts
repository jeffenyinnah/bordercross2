import type { LocalPolicy, LocalStore, OutboxItem, StoreOp } from './types'

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))

export class MemoryStore implements LocalStore {
  private kv = new Map<string, unknown>()
  private outbox: OutboxItem[] = []
  private policies = new Map<string, LocalPolicy>()
  private seq = 0

  async get<T>(key: string): Promise<T | null> {
    return this.kv.has(key) ? clone(this.kv.get(key) as T) : null
  }

  async set(key: string, value: unknown) {
    this.kv.set(key, clone(value))
  }

  async remove(key: string) {
    this.kv.delete(key)
  }

  async commit(ops: StoreOp[]) {
    // validate first so a failing op leaves nothing behind
    for (const op of ops) {
      if (op.type === 'outbox' && this.outbox.some((o) => o.client_uuid === op.item.client_uuid)) {
        throw new Error(`Outbox already contains ${op.item.client_uuid}`)
      }
    }
    for (const op of ops) {
      if (op.type === 'set') this.kv.set(op.key, clone(op.value))
      else if (op.type === 'remove') this.kv.delete(op.key)
      else if (op.type === 'outbox') this.outbox.push({ ...clone(op.item), seq: ++this.seq })
      else if (op.type === 'outbox_remove') this.outbox = this.outbox.filter((o) => o.client_uuid !== op.client_uuid)
      else if (op.type === 'outbox_error') {
        this.outbox = this.outbox.map((o) => o.client_uuid === op.client_uuid
          ? { ...o, attempts: o.attempts + 1, last_error: op.error } : o)
      }
      else this.policies.set(op.policy.client_uuid, clone(op.policy))
    }
  }

  async listOutbox() {
    return clone(this.outbox)
  }

  async listPolicies(limit = 50) {
    return clone([...this.policies.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit))
  }

  async getPolicy(clientUuid: string) {
    return clone(this.policies.get(clientUuid) ?? null)
  }

  async clear(keepPrefix?: string) {
    for (const key of [...this.kv.keys()]) {
      if (!keepPrefix || !key.startsWith(keepPrefix)) this.kv.delete(key)
    }
    this.outbox = []
    this.policies.clear()
  }
}
