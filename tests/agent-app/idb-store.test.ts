import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdbStore } from '@/lib/agent-app/store/idb'
import type { LocalPolicy, OutboxItem } from '@/lib/agent-app/store/types'

let n = 0
let store: IdbStore

const item = (client_uuid: string): OutboxItem =>
  ({ client_uuid, kind: 'policy', payload: { client_uuid }, created_at: '2026-10-23T08:00:00Z', attempts: 0, last_error: null })
const policy = (client_uuid: string, created_at: string): LocalPolicy =>
  ({ client_uuid, policy_number: `RGAR-2026-${client_uuid}`, data: {}, issued_offline: true, created_at })

beforeEach(async () => {
  store = await IdbStore.open(`test-${++n}`)
})

describe('IdbStore', () => {
  it('commits kv, outbox and policy together and keeps outbox order', async () => {
    await store.commit([
      { type: 'set', key: 'leases', value: [1, 2] },
      { type: 'outbox', item: item('a') },
      { type: 'outbox', item: item('b') },
      { type: 'policy', policy: policy('a', '2026-10-23T08:00:00Z') },
    ])
    expect(await store.get('leases')).toEqual([1, 2])
    expect((await store.listOutbox()).map((o) => [o.seq, o.client_uuid])).toEqual([[1, 'a'], [2, 'b']])
    expect(await store.listPolicies()).toHaveLength(1)
  })

  it('a failing operation rolls back the whole commit', async () => {
    await store.commit([{ type: 'outbox', item: item('a') }])
    await expect(store.commit([
      { type: 'set', key: 'leases', value: 'spent' },
      { type: 'outbox', item: item('a') },
    ])).rejects.toThrow()
    expect(await store.get('leases')).toBeNull()
    expect(await store.listOutbox()).toHaveLength(1)
  })

  it('lists policies newest first, up to the limit', async () => {
    await store.commit([
      { type: 'policy', policy: policy('old', '2026-10-21T08:00:00Z') },
      { type: 'policy', policy: policy('new', '2026-10-23T08:00:00Z') },
      { type: 'policy', policy: policy('mid', '2026-10-22T08:00:00Z') },
    ])
    expect((await store.listPolicies(2)).map((p) => p.client_uuid)).toEqual(['new', 'mid'])
  })

  it('clear keeps only keys with the given prefix', async () => {
    await store.commit([
      { type: 'set', key: 'auth:session', value: 's' },
      { type: 'set', key: 'snapshot', value: {} },
      { type: 'outbox', item: item('a') },
    ])
    await store.clear('auth:')
    expect(await store.get('auth:session')).toBe('s')
    expect(await store.get('snapshot')).toBeNull()
    expect(await store.listOutbox()).toEqual([])
  })
})
