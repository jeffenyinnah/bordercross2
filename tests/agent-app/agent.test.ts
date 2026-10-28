import { beforeEach, describe, expect, it } from 'vitest'
import { cardPaymentRecordSchema, linesFromText, type CardPaymentRecord, type OfflinePolicyRecord, type PolicyDetails } from '@bordercross/core'
import { SLIP_1, withLine } from '../../packages/core/test/fixtures/slips'
import type { SlipCapture } from '@/lib/agent-app/capture'
import { SLIP_IMAGE_PREFIX, type OutboxItem } from '@/lib/agent-app/store/types'
import { AgentService } from '@/lib/agent-app/agent'
import { NetworkError, ServerError, type AgentApi, type CreditLeaseRow, type NumberLeaseRow, type PolicyRow, type PushResult, type Snapshot } from '@/lib/agent-app/api'
import { MemoryStore } from '@/lib/agent-app/store/memory'
import { hasPin, setPin, verifyPin } from '@/lib/agent-app/pin'

const USER = '00000000-0000-4000-8000-0000000000a1'
const DEVICE = '00000000-0000-4000-8000-0000000000d1'
const INSURER = '00000000-0000-4000-8000-0000000000e1'
const LIGHT = '00000000-0000-4000-8000-0000000000f1'
const RGAR = '00000000-0000-4000-8000-0000000000b1'
const NAMA = '00000000-0000-4000-8000-0000000000b2'
const T0 = Date.parse('2026-10-23T08:00:00Z')

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** In-memory stand-in for the Supabase RPCs, enough to exercise the device logic. */
class FakeApi implements AgentApi {
  online = true
  user: string | null = null
  seq = 0
  leaseCalls: string[] = []
  creditCalls: { amount?: number }[] = []
  issued = new Map<string, PolicyRow>()
  failNextIssueAfterCommit = false
  serverClockAheadMs = 90_000
  allowance = 10000
  wallet = { balance_mzn: 25000 }
  numberLeases: NumberLeaseRow[] = []
  creditLeases: CreditLeaseRow[] = []
  /** merged over the default snapshot */
  snapshotExtra: Partial<Snapshot> = {}

  constructor(private clock: () => number) {}

  private net() {
    if (!this.online) throw new NetworkError('Failed to fetch')
  }

  async signIn(email: string) {
    this.net()
    this.user = email === 'other@t.co' ? '00000000-0000-4000-8000-0000000000a2' : USER
    return { userId: this.user }
  }
  async signOut() { this.user = null }
  sessionUnknown = false
  async sessionUserId() { return this.sessionUnknown ? undefined : this.user }
  async registerDevice() { this.net(); return DEVICE }

  async snapshot(): Promise<Snapshot> {
    this.net()
    return structuredClone({
      server_time: new Date(this.clock() + this.serverClockAheadMs).toISOString(),
      device_id: DEVICE,
      profile: { id: this.user!, full_name: 'Agent', email: 'a@t.co', role: 'agent', insurer_id: INSURER, border_post_id: RGAR, is_active: true },
      insurer: { id: INSURER, name: 'Default', code: 'DEFAULT', payment_methods: ['VIRTUAL_CREDIT'], settings: { offline_credit_allowance: this.allowance, number_block_size: 50 } },
      wallet: this.wallet,
      vehicle_types: [{ id: LIGHT, name: 'Light', is_active: true, insurer_id: null, price_mzn: 1000, price_mzn_annual: 9000 }],
      border_posts: [{ id: RGAR, name: 'Ressano Garcia', code: 'RGAR' }, { id: NAMA, name: 'Namaacha', code: 'NAMA' }],
      exchange_rates: [], terminals: [], merchants: [], slip_profiles: [],
      dedupe: { txn_keys: [], image_hashes: [], card_amounts: [], recibos_by_tid: {} },
      open_review_count: 0,
      number_leases: this.numberLeases,
      credit_leases: this.creditLeases,
      ...this.snapshotExtra,
    })
  }

  async leaseNumbers(_d: string, code: string) {
    this.net()
    this.leaseCalls.push(code)
    const start = this.seq + 1
    this.seq += 50
    const row = { id: uuid(100 + this.numberLeases.length), border_code: code, year: 2026, start_seq: start, end_seq: this.seq }
    this.numberLeases.push(row)
    return row
  }

  async leaseCredit(_d: string, amount?: number) {
    this.net()
    this.creditCalls.push({ amount })
    const row = { id: uuid(200 + this.creditLeases.length), currency: 'MZN', reserved: amount ?? 0, consumed: 0, status: 'active' }
    this.creditLeases.push(row)
    this.wallet.balance_mzn -= amount ?? 0
    return row
  }

  async issueOnline(_d: string, clientUuid: string, details: PolicyDetails) {
    this.net()
    let row = this.issued.get(clientUuid)
    if (!row) {
      row = { id: uuid(300 + this.issued.size), policy_number: `RGAR-2026-${String(++this.seq).padStart(6, '0')}`, verification_token: 'f'.repeat(32), created_at: new Date(this.clock()).toISOString(), ...details }
      this.issued.set(clientUuid, row)
    }
    if (this.failNextIssueAfterCommit) {
      this.failNextIssueAfterCommit = false
      throw new NetworkError('response lost')
    }
    return row
  }

  pushed: { kind: string; client_uuid: string; image: string | null }[] = []
  /** answers by client_uuid; default: created, consuming offline credit like the server */
  pushAnswers = new Map<string, PushResult | Error>()

  async pushOutbox(_d: string, item: OutboxItem, image: string | null): Promise<PushResult> {
    this.net()
    const answer = this.pushAnswers.get(item.client_uuid)
    if (answer instanceof Error) throw answer
    this.pushed.push({ kind: item.kind, client_uuid: item.client_uuid, image })
    if (answer) return answer
    const r = item.payload as OfflinePolicyRecord
    if (item.kind === 'policy' && r.credit_lease_id) {
      const lease = this.creditLeases.find((l) => l.id === r.credit_lease_id)!
      lease.consumed = Number(lease.consumed) + Number(r.premium_amount)
    }
    return { result: 'created', ...(item.kind === 'policy' && { policy: { ...r, id: uuid(400 + this.pushed.length), created_at: r.device_issued_at } }) }
  }
}

const details = {
  policy_type: 'monthly' as const, vehicle_type_ids: [LIGHT],
  client_name: 'Joao', plate_number: 'ABC 123', vehicle_brand: 'Toyota', vehicle_model: 'Hilux', start_date: '2026-10-23',
}

let now: number
let store: MemoryStore
let api: FakeApi
let agent: AgentService

beforeEach(async () => {
  now = T0
  store = new MemoryStore()
  api = new FakeApi(() => now)
  agent = new AgentService(store, api, { platform: 'android' }, () => now)
})

describe('login and snapshot', () => {
  it('registers the device, measures the server clock and stocks numbers and credit', async () => {
    const { warnings } = await agent.login('a@t.co', 'pw')
    expect(warnings).toEqual([])
    expect(await agent.isSignedIn()).toBe(true)
    const s = await agent.state()
    expect(s.sync.clockOffsetMs).toBe(90_000)
    expect((await agent.now()).getTime()).toBe(T0 + 90_000)
    expect(api.leaseCalls).toEqual(['RGAR'])
    expect(api.creditCalls).toEqual([{ amount: 10000 }])
    expect(agent.offlineCapacity(s, 'RGAR')).toEqual({ numbers: 50, credit: 1_000_000 })
    expect(s.snapshot.wallet?.balance_mzn).toBe(15000)
  })

  it('reserves only what the wallet holds and reports failures as warnings', async () => {
    api.wallet.balance_mzn = 4000
    await agent.login('a@t.co', 'pw')
    expect(api.creditCalls).toEqual([{ amount: 4000 }])

    const failing = new FakeApi(() => now)
    failing.leaseNumbers = async () => { throw new ServerError('two open blocks') }
    const a2 = new AgentService(new MemoryStore(), failing, { platform: 'ios' }, () => now)
    const { warnings } = await a2.login('a@t.co', 'pw')
    expect(warnings[0]).toMatch(/policy numbers for RGAR: two open blocks/)
  })

  it('does not lease again while a block is more than half full', async () => {
    await agent.login('a@t.co', 'pw')
    await agent.refresh()
    expect(api.leaseCalls).toEqual(['RGAR'])
  })

  it('offline use expires after offline_grace_days', async () => {
    await agent.login('a@t.co', 'pw')
    now = T0 + 6 * 86_400_000
    expect(await agent.requiresOnlineLogin()).toBe(false)
    now = T0 + 8 * 86_400_000
    expect(await agent.requiresOnlineLogin()).toBe(true)
    const r = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    expect(r.ok).toBe(false)
  })
})

describe('offline issuance', () => {
  beforeEach(async () => {
    await agent.login('a@t.co', 'pw')
    api.online = false
  })

  it('uses a leased number and the reserve, and queues the record atomically', async () => {
    const r = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    if (!r.ok) throw new Error(r.error)
    expect(r.policy.policy_number).toBe('RGAR-2026-000001')
    expect(r.policy.issued_offline).toBe(true)

    const outbox = await store.listOutbox()
    expect(outbox).toHaveLength(1)
    const rec = outbox[0].payload as OfflinePolicyRecord
    expect(rec.client_uuid).toBe(r.policy.client_uuid)
    expect(rec.device_issued_at).toBe(new Date(T0 + 90_000).toISOString())
    expect(rec.border).toBe('Ressano Garcia')

    const s = await agent.state()
    expect(agent.offlineCapacity(s, 'RGAR')).toEqual({ numbers: 49, credit: 900_000 })
    expect(s.pendingCount).toBe(1)

    const second = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    expect(second.ok && second.policy.policy_number).toBe('RGAR-2026-000002')
  })

  it('stops when the reserve is spent and changes nothing', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })).ok).toBe(true)
    }
    const r = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    expect(r.ok).toBe(false)
    expect(await store.listOutbox()).toHaveLength(10)
    expect(agent.offlineCapacity(await agent.state(), 'RGAR').numbers).toBe(40)
  })

  it('cannot sell offline at a border without a leased block', async () => {
    const r = await agent.issue({ details, borderPostId: NAMA, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/No offline policy numbers left for NAMA/)
  })

  it('keeps unsynced spending when a new snapshot arrives', async () => {
    await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    api.online = true
    await agent.refresh()
    const s = await agent.state()
    expect(agent.offlineCapacity(s, 'RGAR')).toEqual({ numbers: 49, credit: 900_000 })
  })

  it('stocks the last border used after selling there', async () => {
    api.online = true
    await agent.issue({ details, borderPostId: NAMA, paymentMethod: 'VIRTUAL_CREDIT', online: true })
    await agent.refresh()
    expect(api.leaseCalls).toEqual(['RGAR', 'NAMA'])
  })
})

describe('online issuance', () => {
  beforeEach(async () => {
    await agent.login('a@t.co', 'pw')
  })

  it('issues on the server and keeps the policy for reprint', async () => {
    const r = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.policy.issued_offline).toBe(false)
    expect(await store.listOutbox()).toHaveLength(0)
    expect((await agent.listPolicies()).map((p) => p.policy_number)).toEqual([r.policy.policy_number])
  })

  it('a lost response is retried with the same client uuid: one sale, not two', async () => {
    api.failNextIssueAfterCommit = true
    const first = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: true })
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.retryable).toBe(true)
    const retry = await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: true, clientUuid: first.clientUuid })
    expect(retry.ok).toBe(true)
    expect(api.issued.size).toBe(1)
  })
})

describe('switching agents', () => {
  it('refuses while another agent has unsynced sales, wipes data otherwise', async () => {
    await agent.login('a@t.co', 'pw')
    api.online = false
    await agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    api.online = true
    await expect(agent.login('other@t.co', 'pw')).rejects.toThrow(/unsynced sales/)
    await expect(agent.logout()).rejects.toThrow(/unsynced/)
  })

  it("a different agent on a clean device starts fresh: the previous agent's PIN is gone", async () => {
    await agent.login('a@t.co', 'pw')
    await store.set('pin', 'pin-of-first-agent')
    await agent.login('other@t.co', 'pw')
    expect(await store.get('pin')).toBeNull()
    expect(await agent.bootState()).toBe('ready')
  })

  it('offline with an unreadable session, the stored device still opens behind its PIN', async () => {
    await agent.login('a@t.co', 'pw')
    api.sessionUnknown = true
    expect(await agent.bootState()).toBe('ready')
  })

  it('a signed-in agent with no device data on this phone must activate it', async () => {
    await agent.login('a@t.co', 'pw')
    await store.clear()
    expect(await agent.bootState()).toBe('needs-activation')
    await agent.signOut()
    expect(await agent.bootState()).toBe('needs-login')
  })
})

// ---------------------------------------------------------------------------
// Card payment: sample slip 1 (3000.00 MZN, TID 00236255, 11/10/2026 13:39:54 Maputo)
// ---------------------------------------------------------------------------

describe('card slip payment', () => {
  const HEAVY = '00000000-0000-4000-8000-0000000000f2'
  const SLIP_AT = Date.parse('2026-10-11T11:39:54Z')
  const cardDetails = { ...details, vehicle_type_ids: [HEAVY], start_date: '2026-10-11' }
  const noReview = { edits: [], confirmed: [] }
  let photo = 0

  const capture = (): SlipCapture => ({
    base64: btoa(`photo-${++photo}`),
    sha256: String(photo).padStart(64, '0'),
    capturedAt: new Date(now).toISOString(),
    inApp: true,
    gps: { lat: -25.44, lng: 31.98, accuracyM: 10 },
  })

  async function quote() {
    const q = await agent.quoteCard({ details: cardDetails, borderPostId: RGAR })
    if (!q.ok) throw new Error(q.error)
    return q.quote
  }

  async function photograph(text = SLIP_1) {
    now = SLIP_AT + 60_000
    return agent.readSlip(capture(), linesFromText(text))
  }

  beforeEach(async () => {
    // the agent quotes 2 minutes before the customer pays (server clock 90s ahead)
    now = SLIP_AT - 120_000
    api.snapshotExtra = {
      insurer: { id: INSURER, name: 'Default', code: 'DEFAULT', payment_methods: ['VIRTUAL_CREDIT', 'POS_CARD_SLIP'], settings: { number_block_size: 50 } },
      vehicle_types: [{ id: HEAVY, name: 'Heavy', is_active: true, insurer_id: null, price_mzn: 3000, price_mzn_annual: null }],
      terminals: [{ id: 't1', tid: '00236255', mid: '000000000130941', insurer_id: INSURER, assigned_agent_id: USER, border_post_id: RGAR, is_active: true, last_recibo: 711 }],
      merchants: [{ id: 'm1', mid: '000000000130941', insurer_id: INSURER, is_active: true }],
    }
    await agent.login('a@t.co', 'pw')
    api.online = false
  })

  it('verifies the slip and issues offline, queueing policy, payment and photo together', async () => {
    const q = await quote()
    const reading = await photograph()
    const { result } = await agent.checkSlip(q, reading, noReview)
    expect(result.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([])
    expect(result.tier).toBe('AUTO_PASS')

    const r = await agent.issueCard(q, reading, noReview)
    if (!r.ok) throw new Error(r.error)
    expect(r.policy.policy_number).toBe('RGAR-2026-000001')
    expect(r.policy.data.card_payment).toEqual({ tier: 'AUTO_PASS', flags: [] })

    const outbox = await store.listOutbox()
    expect(outbox.map((o) => o.kind)).toEqual(['policy', 'card_payment'])
    expect((outbox[0].payload as OfflinePolicyRecord).payment_method).toBe('POS_CARD_SLIP')
    expect((outbox[0].payload as OfflinePolicyRecord).credit_lease_id).toBeNull()
    const payment = cardPaymentRecordSchema.parse(outbox[1].payload)
    expect(payment).toMatchObject({
      policy_client_uuid: q.clientUuid, status: 'PENDING_RECONCILIATION', expected_amount: '3000.00',
      matched_terminal_id: 't1',
    })
    expect(await store.get(SLIP_IMAGE_PREFIX + reading.paymentUuid)).toBe(reading.capture.base64)

    // card sales never touch the credit reserve
    expect(agent.offlineCapacity(await agent.state(), 'RGAR')).toEqual({ numbers: 49, credit: 0 })

    // sync: the policy goes first, then the payment with its photo, which then leaves the phone
    api.online = true
    expect(await agent.sync()).toMatchObject({ pushed: 2, remaining: 0 })
    expect(api.pushed).toEqual([
      { kind: 'policy', client_uuid: q.clientUuid, image: null },
      { kind: 'card_payment', client_uuid: reading.paymentUuid, image: reading.capture.base64 },
    ])
    expect(await store.get(SLIP_IMAGE_PREFIX + reading.paymentUuid)).toBeNull()
  })

  it('the same slip cannot pay a second policy, even before syncing', async () => {
    const q1 = await quote()
    expect((await agent.issueCard(q1, await photograph(), noReview)).ok).toBe(true)

    now = SLIP_AT - 60_000
    const q2 = await quote()
    const reading = await photograph()
    const { result } = await agent.checkSlip(q2, reading, noReview)
    expect(result.tier).toBe('HARD_DECLINE')
    expect(result.checks.find((c) => c.id === 'DUPLICATE_TXN')?.pass).toBe(false)
    expect((await agent.issueCard(q2, reading, noReview)).ok).toBe(false)
  })

  it('a wrong amount is declined with the diff, and the attempt is kept for review once', async () => {
    const q = await quote()
    const reading = await photograph(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE:      300.00 MZN'))
    const { result } = await agent.checkSlip(q, reading, noReview)
    expect(result.tier).toBe('HARD_DECLINE')
    expect(result.amountMismatch).toEqual({ expected: '3000.00 MZN', actual: '300.00 MZN' })

    await agent.declineCard(q, reading, noReview)
    await agent.declineCard(q, reading, noReview)
    const outbox = await store.listOutbox()
    expect(outbox).toHaveLength(1)
    expect(outbox[0].payload as CardPaymentRecord).toMatchObject({ status: 'DECLINED', tier: 'HARD_DECLINE', policy_client_uuid: null })
    expect(agent.offlineCapacity(await agent.state(), 'RGAR').numbers).toBe(50)
  })

  it('an agent correction is accepted but flagged for review', async () => {
    const q = await quote()
    // OCR dropped a digit of the AUTH CODE; the agent types it from the paper slip
    const reading = await photograph(withLine(SLIP_1, 'AUTH CODE: 727255', 'AUTH CODE: 72725'))
    const before = await agent.checkSlip(q, reading, noReview)
    expect(before.result.needsConfirmation).toContain('auth_code')
    expect(before.result.canIssue).toBe(false)

    const review = { edits: [{ field: 'auth_code' as const, value: '727255' }], confirmed: [] }
    const r = await agent.issueCard(q, reading, review)
    if (!r.ok) throw new Error(r.error)
    const payment = (await store.listOutbox())[1].payload as CardPaymentRecord
    expect(payment.status).toBe('NEEDS_REVIEW')
    expect(payment.flags).toContain('AGENT_EDITED:auth_code')
    expect(payment.edits).toEqual([expect.objectContaining({ field: 'auth_code', ocr_value: '72725', edited_value: '727255' })])
  })

  it('refuses card sales when the insurer has not enabled them', async () => {
    api.snapshotExtra.insurer!.payment_methods = ['VIRTUAL_CREDIT']
    api.online = true
    await agent.refresh()
    expect((await agent.quoteCard({ details: cardDetails, borderPostId: RGAR })).ok).toBe(false)
    const direct = await agent.issue({ details: cardDetails, borderPostId: RGAR, paymentMethod: 'POS_CARD_SLIP', online: false })
    expect(direct.ok).toBe(false)
  })
})

describe('PIN', () => {
  it('rejects weak PINs, verifies, and locks after 5 wrong attempts', async () => {
    await expect(setPin(store, '1111')).rejects.toThrow()
    await expect(setPin(store, '1234')).rejects.toThrow()
    await setPin(store, '4071')
    expect(await hasPin(store)).toBe(true)
    expect(await verifyPin(store, '4071')).toEqual({ ok: true, attemptsLeft: 5 })
    for (let i = 4; i >= 0; i--) expect(await verifyPin(store, '0000')).toEqual({ ok: false, attemptsLeft: i })
    expect((await verifyPin(store, '4071')).ok).toBe(false)
  })
})

describe('sync', () => {
  const sell = () => agent.issue({ details, borderPostId: RGAR, paymentMethod: 'VIRTUAL_CREDIT', online: false })

  beforeEach(async () => {
    await agent.login('a@t.co', 'pw')
  })

  it("pushes the outbox in order, marks the sales synced and pulls the server's credit use", async () => {
    api.online = false
    const a = await sell()
    const b = await sell()
    if (!a.ok || !b.ok) throw new Error('sale failed')
    api.online = true

    const report = await agent.sync()
    expect(report).toMatchObject({ pushed: 2, remaining: 0, error: null, rejected: [] })
    expect(api.pushed.map((p) => p.client_uuid)).toEqual([a.policy.client_uuid, b.policy.client_uuid])
    expect((await store.getPolicy(a.policy.client_uuid))?.synced).toBe(true)

    // the server now counts the 2 sales as consumed; nothing is pending locally
    const s = await agent.state()
    expect(s.pendingCount).toBe(0)
    expect(s.creditLeases[0]).toMatchObject({ serverConsumedMinor: 200_000, localConsumedMinor: 0 })
    expect(agent.offlineCapacity(s, 'RGAR').credit).toBe(800_000)
  })

  it('offline: keeps everything and says so', async () => {
    api.online = false
    await sell()
    const report = await agent.sync()
    expect(report.pushed).toBe(0)
    expect(report.remaining).toBe(1)
    expect(report.error).toMatch(/No connection/)
  })

  it('stops at an item the server refuses, so later items keep their order', async () => {
    api.online = false
    const a = await sell()
    const b = await sell()
    const c = await sell()
    if (!a.ok || !b.ok || !c.ok) throw new Error('sale failed')
    api.online = true
    api.pushAnswers.set(b.policy.client_uuid, new ServerError('Device is not registered to this agent or has been revoked', '403'))

    const report = await agent.sync()
    expect(report).toMatchObject({ pushed: 1, remaining: 2 })
    expect(report.error).toMatch(/revoked/)
    const outbox = await store.listOutbox()
    expect(outbox.map((o) => o.client_uuid)).toEqual([b.policy.client_uuid, c.policy.client_uuid])
    expect(outbox[0]).toMatchObject({ attempts: 1, last_error: expect.stringMatching(/revoked/) })
  })

  it('a rejected sale leaves the phone with a warning; the office keeps it', async () => {
    api.online = false
    const a = await sell()
    if (!a.ok) throw new Error('sale failed')
    api.online = true
    api.pushAnswers.set(a.policy.client_uuid, { result: 'rejected', reason: 'Policy number is not from a block leased to this device' })

    const report = await agent.sync()
    expect(report.remaining).toBe(0)
    expect(report.rejected).toHaveLength(1)
    expect(report.warnings[0]).toMatch(/RGAR-2026-000001 was not accepted: Policy number/)
  })

  it("a sale that reached the server online first keeps the server's number", async () => {
    api.online = false
    const a = await sell()
    if (!a.ok) throw new Error('sale failed')
    api.online = true
    api.pushAnswers.set(a.policy.client_uuid, {
      result: 'existing',
      policy: { id: uuid(999), policy_number: 'RGAR-2026-000777', verification_token: 'e'.repeat(32), created_at: new Date(now).toISOString() },
    })

    const report = await agent.sync()
    expect(report.warnings[0]).toMatch(/registered as RGAR-2026-000777/)
    expect((await store.getPolicy(a.policy.client_uuid))?.policy_number).toBe('RGAR-2026-000777')
  })

  it('runs once when called twice at the same time', async () => {
    api.online = false
    await sell()
    api.online = true
    const [r1, r2] = await Promise.all([agent.sync(), agent.sync()])
    expect(r1).toBe(r2)
    expect(api.pushed).toHaveLength(1)
  })
})
