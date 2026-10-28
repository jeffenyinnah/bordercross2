import {
  SIMO_REDE_PROFILE,
  availableCredit,
  buildCardPaymentRecord,
  computePremium,
  confirmSlip,
  formatMinor,
  generateVerificationToken,
  issueOfflinePolicy,
  mergeCreditLeases,
  needsNumberRefill,
  parseInsurerSettings,
  parseSlip,
  parseSlipProfile,
  policyDetailsSchema,
  remainingNumbers,
  selectProfile,
  toLocalNumberLease,
  toMinor,
  validateSlip,
  type CardPaymentRecord,
  type ConfirmedSlip,
  type PriceCurrency,
  type DedupeIndex,
  type FieldEdit,
  type InsurerSettings,
  type LocalCreditLease,
  type LocalNumberLease,
  type OcrResult,
  type OfflinePolicyRecord,
  type ParsedSlip,
  type PaymentMethodCode,
  type PolicyDetailsInput,
  type SlipFieldName,
  type SlipProfileConfig,
  type ValidationContext,
  type ValidationResult,
  type Whitelist,
} from '@bordercross/core'
import type { SlipCapture } from './capture'
import { NetworkError, ServerError, type AgentApi, type PolicyRow, type PushResult, type Snapshot } from './api'
import { SLIP_IMAGE_PREFIX, type LocalPolicy, type LocalStore, type OutboxItem, type StoreOp } from './store/types'

const K = {
  device: 'device',
  snapshot: 'snapshot',
  sync: 'sync_meta',
  numberLeases: 'number_leases',
  creditLeases: 'credit_leases',
  lastBorder: 'last_border',
  onlineAuthAt: 'last_online_auth_at',
} as const

export interface DeviceInfo {
  platform: 'android' | 'ios' | 'web'
  model?: string
  appVersion?: string
}

interface StoredDevice {
  deviceId: string
  userId: string
}

export interface SyncMeta {
  /** device clock when the snapshot arrived */
  pulledAt: number
  serverTime: string
  /** add to Date.now() to get server time */
  clockOffsetMs: number
}

export interface AgentState {
  snapshot: Snapshot
  settings: InsurerSettings
  sync: SyncMeta
  numberLeases: LocalNumberLease[]
  creditLeases: LocalCreditLease[]
  pendingCount: number
}

export interface SyncReport {
  /** items the server acknowledged in this run */
  pushed: number
  /** items the server kept for the back office instead of accepting */
  rejected: { client_uuid: string; kind: OutboxItem['kind']; reason: string }[]
  /** still waiting in the outbox */
  remaining: number
  /** why the run stopped early (no connection, signed out, blocked phone...) */
  error: string | null
  /** for the agent: rejections, replaced numbers, lease top-up problems */
  warnings: string[]
}

export type IssueResult =
  | { ok: true; policy: LocalPolicy }
  /** retryable: the online request may or may not have reached the server; retry with the same clientUuid */
  | { ok: false; error: string; retryable?: boolean; clientUuid?: string }

/** A priced card sale waiting for its POS slip. */
export interface CardQuote {
  /** idempotency key of the policy this slip will pay for */
  clientUuid: string
  details: PolicyDetailsInput
  borderPostId: string
  premiumMinor: number
  currency: PriceCurrency
  /** raw device time when the premium was shown; the slip must be close to it */
  createdAt: string
}

/** One photographed slip. Every new photo is a new payment attempt. */
export interface SlipReading {
  paymentUuid: string
  capture: SlipCapture
  ocr: OcrResult
  parsed: ParsedSlip
  profile: SlipProfileConfig
  profileId: string | null
}

/** What the agent changed or ticked on the confirmation screen. */
export interface SlipReview {
  edits: FieldEdit[]
  confirmed: SlipFieldName[]
}

export interface SlipCheck {
  slip: ConfirmedSlip
  result: ValidationResult
}

const DAY = 86_400_000
const HOUR = 3_600_000

/**
 * Everything the agent app does, independent of the UI. All state lives in
 * the local store so the app works the same after a restart without network.
 */
export class AgentService {
  constructor(
    private store: LocalStore,
    private api: AgentApi,
    private device: DeviceInfo,
    private clock: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /** Sign in and activate (tests and scripts; the app signs in on the web /login page). */
  async login(email: string, password: string): Promise<{ warnings: string[] }> {
    await this.api.signIn(email, password)
    return this.activate()
  }

  /**
   * Online, with the signed-in session: register this install and pull
   * everything needed offline. Also renews the offline grace period.
   */
  async activate(): Promise<{ warnings: string[] }> {
    const userId = await this.api.sessionUserId()
    if (userId === undefined) throw new NetworkError('No connection. Activating this phone needs internet.')
    if (userId === null) throw new ServerError('Not signed in')
    const stored = await this.store.get<StoredDevice>(K.device)

    if (stored && stored.userId !== userId) {
      if ((await this.store.listOutbox()).length > 0) {
        throw new ServerError('This phone still holds unsynced sales of another agent. That agent must sign in and sync them first.')
      }
      await this.store.clear()
    }

    const deviceId = await this.api.registerDevice({
      platform: this.device.platform,
      model: this.device.model,
      appVersion: this.device.appVersion,
      deviceId: stored?.userId === userId ? stored.deviceId : undefined,
    })
    await this.store.commit([
      { type: 'set', key: K.device, value: { deviceId, userId } satisfies StoredDevice },
      { type: 'set', key: K.onlineAuthAt, value: this.clock() },
    ])
    return this.refresh()
  }

  /** End the web session but keep this phone's data (another agent is about to sign in). */
  async signOut() {
    await this.api.signOut()
  }

  async logout() {
    if ((await this.store.listOutbox()).length > 0) {
      throw new Error('There are unsynced sales on this device. Sync before logging out.')
    }
    await this.api.signOut()
    await this.store.clear()
  }

  /**
   * Where the app should start. Works offline: a session whose token can't be
   * refreshed without network still counts for the agent this phone belongs to.
   */
  async bootState(): Promise<'needs-login' | 'needs-activation' | 'expired' | 'ready'> {
    const [device, snapshot, userId] = await Promise.all([
      this.store.get<StoredDevice>(K.device), this.store.get(K.snapshot), this.api.sessionUserId(),
    ])
    if (userId === null) return 'needs-login'
    const mine = !!device && !!snapshot && (userId === undefined || userId === device.userId)
    if (!mine) return userId === undefined ? 'needs-login' : 'needs-activation'
    return (await this.requiresOnlineLogin()) ? 'expired' : 'ready'
  }

  /** Signed in on this device (session, device and snapshot present). Works offline. */
  async isSignedIn(): Promise<boolean> {
    const s = await this.bootState()
    return s === 'ready' || s === 'expired'
  }

  /** Offline use is limited to offline_grace_days after the last online login. */
  async requiresOnlineLogin(): Promise<boolean> {
    const [at, snapshot] = await Promise.all([
      this.store.get<number>(K.onlineAuthAt), this.store.get<Snapshot>(K.snapshot),
    ])
    if (!at || !snapshot) return true
    const days = parseInsurerSettings(snapshot.insurer.settings).offline_grace_days
    return this.clock() - at > days * DAY
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  private running: Promise<SyncReport> | null = null

  /**
   * Push the outbox in order, then pull a fresh snapshot. An item leaves the
   * outbox only once the server has it; the run stops at the first item that
   * can't be delivered, so a card payment never arrives before its policy.
   * Concurrent calls share one run.
   */
  sync(): Promise<SyncReport> {
    this.running ??= this.runSync().finally(() => { this.running = null })
    return this.running
  }

  private async runSync(): Promise<SyncReport> {
    const { deviceId } = await this.requireDevice()
    const outbox = (await this.store.listOutbox()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    const report: SyncReport = { pushed: 0, rejected: [], remaining: 0, error: null, warnings: [] }

    for (const item of outbox) {
      const imageKey = SLIP_IMAGE_PREFIX + item.client_uuid
      const image = item.kind === 'card_payment' ? await this.store.get<string>(imageKey) : null
      let result: PushResult
      try {
        result = await this.api.pushOutbox(deviceId, item, image)
      } catch (e) {
        report.error = e instanceof NetworkError
          ? 'No connection. Sales stay on this phone and sync later.'
          : (e as Error).message
        if (!(e instanceof NetworkError)) {
          await this.store.commit([{ type: 'outbox_error', client_uuid: item.client_uuid, error: (e as Error).message }])
        }
        break
      }

      const ops: StoreOp[] = [{ type: 'outbox_remove', client_uuid: item.client_uuid }]
      if (item.kind === 'card_payment') ops.push({ type: 'remove', key: imageKey })
      if (result.result === 'rejected') {
        report.rejected.push({ client_uuid: item.client_uuid, kind: item.kind, reason: result.reason })
        const label = item.kind === 'policy' ? `Policy ${(item.payload as OfflinePolicyRecord).policy_number}` : 'A card payment'
        report.warnings.push(`${label} was not accepted: ${result.reason}. Your office has the details.`)
      } else if (item.kind === 'policy') {
        const local = await this.store.getPolicy(item.client_uuid)
        if (local) {
          const server = result.policy
          if (server && server.policy_number !== local.policy_number) {
            // the sale had reached the server online before; its number stands
            report.warnings.push(`Policy ${local.policy_number} is registered as ${server.policy_number}. Reprint the certificate.`)
            ops.push({ type: 'policy', policy: { ...fromServerRow(item.client_uuid, server), created_at: local.created_at } })
          } else {
            ops.push({ type: 'policy', policy: { ...local, synced: true } })
          }
        }
      }
      await this.store.commit(ops)
      report.pushed++
    }

    // pull prices, whitelists and leases again (the server consumed numbers and credit)
    if (!report.error || report.pushed > 0) {
      try {
        report.warnings.push(...(await this.refresh()).warnings)
      } catch (e) {
        report.error ??= (e as Error).message
      }
    }
    report.remaining = (await this.store.listOutbox()).length
    return report
  }

  // -------------------------------------------------------------------------
  // Snapshot + leases
  // -------------------------------------------------------------------------

  /** Pull the snapshot, then top up number blocks and the offline credit reserve. */
  async refresh(): Promise<{ warnings: string[] }> {
    const { deviceId } = await this.requireDevice()
    const t0 = this.clock()
    const snapshot = await this.api.snapshot(deviceId)
    const t1 = this.clock()
    const sync: SyncMeta = {
      pulledAt: t1,
      serverTime: snapshot.server_time,
      clockOffsetMs: Math.round(Date.parse(snapshot.server_time) - (t0 + t1) / 2),
    }

    const known = (await this.store.get<LocalNumberLease[]>(K.numberLeases)) ?? []
    let numberLeases = snapshot.number_leases.map((row) =>
      toLocalNumberLease(row, known.find((k) => k.id === row.id)))
    let creditRows = snapshot.credit_leases

    // top-ups are best effort: the agent can still sell online if they fail
    const warnings: string[] = []
    const settings = parseInsurerSettings(snapshot.insurer.settings)
    const year = new Date(t1 + sync.clockOffsetMs).getUTCFullYear()

    for (const code of await this.bordersToStock(snapshot)) {
      if (!needsNumberRefill(numberLeases, code, year, settings.number_block_size)) continue
      try {
        numberLeases = [...numberLeases, toLocalNumberLease(await this.api.leaseNumbers(deviceId, code))]
      } catch (e) {
        warnings.push(`Could not reserve policy numbers for ${code}: ${(e as Error).message}`)
      }
    }

    const allowance = settings.offline_credit_allowance
    const amount = Math.min(allowance, Number(snapshot.wallet?.balance_mzn ?? 0))
    if (allowance > 0 && amount > 0 && creditRows.length === 0) {
      try {
        creditRows = [await this.api.leaseCredit(deviceId, amount)]
        if (snapshot.wallet) snapshot.wallet.balance_mzn = Number(snapshot.wallet.balance_mzn) - amount
      } catch (e) {
        warnings.push(`Could not reserve offline credit: ${(e as Error).message}`)
      }
    }

    const creditLeases = mergeCreditLeases(creditRows, await this.pendingCreditByLease())
    await this.store.commit([
      { type: 'set', key: K.snapshot, value: snapshot },
      { type: 'set', key: K.sync, value: sync },
      { type: 'set', key: K.numberLeases, value: numberLeases },
      { type: 'set', key: K.creditLeases, value: creditLeases },
    ])
    return { warnings }
  }

  async state(): Promise<AgentState> {
    const [snapshot, sync, numberLeases, creditLeases, outbox] = await Promise.all([
      this.store.get<Snapshot>(K.snapshot),
      this.store.get<SyncMeta>(K.sync),
      this.store.get<LocalNumberLease[]>(K.numberLeases),
      this.store.get<LocalCreditLease[]>(K.creditLeases),
      this.store.listOutbox(),
    ])
    if (!snapshot || !sync) throw new Error('Not signed in')
    return {
      snapshot,
      settings: parseInsurerSettings(snapshot.insurer.settings),
      sync,
      numberLeases: numberLeases ?? [],
      creditLeases: creditLeases ?? [],
      pendingCount: outbox.length,
    }
  }

  /** Device time corrected by the offset measured at the last snapshot. */
  async now(): Promise<Date> {
    const sync = await this.store.get<SyncMeta>(K.sync)
    return new Date(this.clock() + (sync?.clockOffsetMs ?? 0))
  }

  /** Snapshot older than whitelist_stale_hours: prices and whitelists may be outdated. */
  isStale(state: AgentState): boolean {
    return this.clock() - state.sync.pulledAt > state.settings.whitelist_stale_hours * HOUR
  }

  offlineCapacity(state: AgentState, borderCode: string) {
    const year = new Date(this.clock() + state.sync.clockOffsetMs).getUTCFullYear()
    return {
      numbers: remainingNumbers(state.numberLeases, borderCode, year),
      /** MZN, minor units */
      credit: availableCredit(state.creditLeases),
    }
  }

  // -------------------------------------------------------------------------
  // Issuance
  // -------------------------------------------------------------------------

  /**
   * Online: the server prices, numbers and debits (idempotent by clientUuid).
   * Offline: number from a leased block, credit from the reserve, queued in the outbox.
   */
  async issue(input: {
    details: PolicyDetailsInput
    borderPostId: string
    paymentMethod: PaymentMethodCode
    online: boolean
    /** pass back after a retryable failure so a retry cannot create a second sale */
    clientUuid?: string
  }): Promise<IssueResult> {
    if (input.paymentMethod === 'POS_CARD_SLIP') {
      return { ok: false, error: 'Card payments are issued through the slip capture flow' }
    }
    const clientUuid = input.clientUuid ?? crypto.randomUUID()
    const state = await this.state()
    const { deviceId } = await this.requireDevice()
    const border = state.snapshot.border_posts.find((b) => b.id === input.borderPostId)
    if (!border) return { ok: false, error: 'Select a border post' }
    const details = { ...input.details, border: border.name }

    if (input.online) {
      const parsed = policyDetailsSchema.safeParse(details)
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
      try {
        const row = await this.api.issueOnline(deviceId, clientUuid, parsed.data)
        const policy = fromServerRow(clientUuid, row)
        await this.store.commit([
          { type: 'policy', policy },
          { type: 'set', key: K.lastBorder, value: border.code },
        ])
        return { ok: true, policy }
      } catch (e) {
        if (e instanceof NetworkError) {
          return { ok: false, retryable: true, clientUuid, error: 'Connection lost while issuing. Retry, or issue offline.' }
        }
        return { ok: false, error: (e as Error).message }
      }
    }

    if (await this.requiresOnlineLogin()) {
      return { ok: false, error: `Offline use expired after ${state.settings.offline_grace_days} days. Connect and log in again.` }
    }

    const result = issueOfflinePolicy(details, {
      vehicleTypes: state.snapshot.vehicle_types,
      priceVersion: state.sync.serverTime,
      numberLeases: state.numberLeases,
      creditLeases: state.creditLeases,
      allowedMethods: state.snapshot.insurer.payment_methods,
    }, {
      clientUuid,
      deviceId,
      agentId: state.snapshot.profile.id,
      insurerId: state.snapshot.profile.insurer_id,
      border: { code: border.code, name: border.name },
      paymentMethod: input.paymentMethod,
      verificationToken: generateVerificationToken(),
      now: new Date(this.clock() + state.sync.clockOffsetMs),
    })
    if (!result.ok) return result

    const policy = fromOfflineRecord(result.record)
    const ops: StoreOp[] = [
      { type: 'set', key: K.numberLeases, value: result.numberLeases },
      { type: 'set', key: K.creditLeases, value: result.creditLeases },
      { type: 'set', key: K.lastBorder, value: border.code },
      {
        type: 'outbox',
        item: { client_uuid: clientUuid, kind: 'policy', payload: result.record, created_at: result.record.device_issued_at, attempts: 0, last_error: null },
      },
      { type: 'policy', policy },
    ]
    await this.store.commit(ops)
    return { ok: true, policy }
  }

  // -------------------------------------------------------------------------
  // Card payment (POS slip)
  //
  // quoteCard -> agent charges the POS -> captureSlip + readSlip -> agent reviews
  // -> checkSlip -> issueCard (or declineCard). A card sale always takes its number
  // from a leased block and is queued in the outbox, online or not, so the same
  // device-side validation is the one the server re-runs at sync.
  // -------------------------------------------------------------------------

  /** Price the sale before the agent charges the card. Nothing is stored. */
  async quoteCard(input: { details: PolicyDetailsInput; borderPostId: string }):
    Promise<{ ok: true; quote: CardQuote } | { ok: false; error: string }> {
    const state = await this.state()
    if (!state.snapshot.insurer.payment_methods.includes('POS_CARD_SLIP')) {
      return { ok: false, error: 'Card payment is not enabled for your insurer' }
    }
    if (await this.requiresOnlineLogin()) {
      return { ok: false, error: `Offline use expired after ${state.settings.offline_grace_days} days. Connect and log in again.` }
    }
    const border = state.snapshot.border_posts.find((b) => b.id === input.borderPostId)
    if (!border) return { ok: false, error: 'Select a border post' }
    const details = { ...input.details, border: border.name }
    const parsed = policyDetailsSchema.safeParse(details)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

    const premium = computePremium({
      vehicleTypes: state.snapshot.vehicle_types,
      selectedIds: parsed.data.vehicle_type_ids,
      policyType: parsed.data.policy_type,
      insurerId: state.snapshot.profile.insurer_id,
    })
    if (!premium.ok) return { ok: false, error: premium.error }
    // fail before the customer pays, not after
    if (this.offlineCapacity(state, border.code).numbers < 1) {
      return { ok: false, error: `No policy numbers left for ${border.code}. Connect to the internet to get more.` }
    }
    return {
      ok: true,
      quote: {
        clientUuid: crypto.randomUUID(),
        details,
        borderPostId: border.id,
        premiumMinor: premium.premiumMinor,
        currency: premium.currency,
        createdAt: new Date(this.clock()).toISOString(),
      },
    }
  }

  /** Parse the OCR text of a new photo with the best-fitting slip profile. */
  async readSlip(capture: SlipCapture, ocr: OcrResult): Promise<SlipReading> {
    const { snapshot } = await this.state()
    const profiles: { id: string | null; config: SlipProfileConfig }[] = []
    for (const row of snapshot.slip_profiles as { id: string; config: unknown }[]) {
      try {
        profiles.push({ id: row.id, config: parseSlipProfile(row.config) })
      } catch {
        // a malformed profile row must not stop the others
      }
    }
    if (profiles.length === 0) profiles.push({ id: null, config: SIMO_REDE_PROFILE })
    // always parse with the closest layout; a poor fit shows up as missing fields
    const best = selectProfile(ocr, profiles.map((p) => p.config), 0) ?? profiles[0].config
    const profile = profiles.find((p) => p.config === best)!
    return {
      paymentUuid: crypto.randomUUID(),
      capture,
      ocr,
      parsed: parseSlip(ocr, profile.config),
      profile: profile.config,
      profileId: profile.id,
    }
  }

  /** Validate the reviewed slip against the quoted premium and everything known on the device. */
  async checkSlip(quote: CardQuote, reading: SlipReading, review: SlipReview): Promise<SlipCheck> {
    const state = await this.state()
    const outbox = await this.store.listOutbox()
    const slip = confirmSlip(reading.parsed, reading.profile, {
      edits: review.edits,
      confirmed: review.confirmed,
      at: new Date(this.clock() + state.sync.clockOffsetMs).toISOString(),
    })
    const ctx: ValidationContext = {
      expected: { amountMinor: quote.premiumMinor, currency: quote.currency },
      agent: {
        id: state.snapshot.profile.id,
        insurerId: state.snapshot.profile.insurer_id,
        borderPostId: quote.borderPostId,
      },
      policyCreatedAt: quote.createdAt,
      now: new Date(this.clock()).toISOString(),
      clockOffsetMs: state.sync.clockOffsetMs,
      whitelist: {
        terminals: state.snapshot.terminals as Whitelist['terminals'],
        merchants: state.snapshot.merchants as Whitelist['merchants'],
        updatedAt: state.snapshot.server_time,
      },
      dedupe: localDedupe(state.snapshot, outbox, reading.paymentUuid),
      capture: {
        inApp: reading.capture.inApp,
        capturedAt: reading.capture.capturedAt,
        imageSha256: reading.capture.sha256,
        gps: reading.capture.gps,
      },
      exposure: openExposure(state.snapshot, outbox),
    }
    return { slip, result: validateSlip(slip, ctx, state.settings) }
  }

  /** Issue the policy paid by an accepted slip; the policy, payment and photo are saved together. */
  async issueCard(quote: CardQuote, reading: SlipReading, review: SlipReview): Promise<IssueResult> {
    const { slip, result } = await this.checkSlip(quote, reading, review)
    if (!result.canIssue) {
      return {
        ok: false,
        error: result.blockedReason === 'EXPOSURE_CAP'
          ? 'Too many card sales are waiting for sync or review. Connect to sync before issuing more.'
          : result.blockedReason === 'CONFIRM_FIELDS'
            ? 'Check the highlighted slip fields first.'
            : 'This slip cannot be accepted.',
      }
    }
    if (await this.requiresOnlineLogin()) {
      return { ok: false, error: 'Offline use expired. Connect and log in again.' }
    }

    const state = await this.state()
    const { deviceId } = await this.requireDevice()
    const border = state.snapshot.border_posts.find((b) => b.id === quote.borderPostId)
    if (!border) return { ok: false, error: 'Select a border post' }
    const now = new Date(this.clock() + state.sync.clockOffsetMs)

    const issued = issueOfflinePolicy(quote.details, {
      vehicleTypes: state.snapshot.vehicle_types,
      priceVersion: state.sync.serverTime,
      numberLeases: state.numberLeases,
      creditLeases: state.creditLeases,
      allowedMethods: state.snapshot.insurer.payment_methods,
    }, {
      clientUuid: quote.clientUuid,
      deviceId,
      agentId: state.snapshot.profile.id,
      insurerId: state.snapshot.profile.insurer_id,
      border: { code: border.code, name: border.name },
      paymentMethod: 'POS_CARD_SLIP',
      verificationToken: generateVerificationToken(),
      now,
    })
    if (!issued.ok) return issued
    // prices refreshed between the quote and now: the slip was for the old amount
    if (issued.record.premium_amount !== formatMinor(quote.premiumMinor)) {
      return { ok: false, error: 'Prices changed since this sale was started. Start the sale again.' }
    }

    const payment = this.cardRecord(state, deviceId, quote, reading, slip, result, now)
    const policy = fromOfflineRecord(issued.record, { tier: result.tier, flags: result.flags })
    await this.store.commit([
      { type: 'set', key: K.numberLeases, value: issued.numberLeases },
      { type: 'set', key: K.lastBorder, value: border.code },
      { type: 'set', key: SLIP_IMAGE_PREFIX + reading.paymentUuid, value: reading.capture.base64 },
      {
        type: 'outbox',
        item: { client_uuid: quote.clientUuid, kind: 'policy', payload: issued.record, created_at: issued.record.device_issued_at, attempts: 0, last_error: null },
      },
      {
        type: 'outbox',
        item: { client_uuid: reading.paymentUuid, kind: 'card_payment', payload: payment, created_at: payment.device_created_at, attempts: 0, last_error: null },
      },
      { type: 'policy', policy },
    ])
    return { ok: true, policy }
  }

  /**
   * Keep a declined attempt (with its photo) for fraud review. Safe to call
   * more than once for the same photo.
   */
  async declineCard(quote: CardQuote, reading: SlipReading, review: SlipReview): Promise<void> {
    const outbox = await this.store.listOutbox()
    if (outbox.some((o) => o.client_uuid === reading.paymentUuid)) return
    const { slip, result } = await this.checkSlip(quote, reading, review)
    if (result.tier !== 'HARD_DECLINE') return
    const state = await this.state()
    const { deviceId } = await this.requireDevice()
    const now = new Date(this.clock() + state.sync.clockOffsetMs)
    const payment = this.cardRecord(state, deviceId, quote, reading, slip, result, now)
    await this.store.commit([
      { type: 'set', key: SLIP_IMAGE_PREFIX + reading.paymentUuid, value: reading.capture.base64 },
      {
        type: 'outbox',
        item: { client_uuid: reading.paymentUuid, kind: 'card_payment', payload: payment, created_at: payment.device_created_at, attempts: 0, last_error: null },
      },
    ])
  }

  private cardRecord(
    state: AgentState, deviceId: string, quote: CardQuote, reading: SlipReading,
    slip: ConfirmedSlip, result: ValidationResult, now: Date,
  ): CardPaymentRecord {
    return buildCardPaymentRecord({
      clientUuid: reading.paymentUuid,
      policyClientUuid: quote.clientUuid,
      deviceId,
      agentId: state.snapshot.profile.id,
      insurerId: state.snapshot.profile.insurer_id,
      borderPostId: quote.borderPostId,
      expected: { amount: formatMinor(quote.premiumMinor), currency: quote.currency },
      ocr: reading.ocr,
      slip,
      result,
      profile: { id: reading.profileId, version: reading.profile.version },
      capture: {
        inApp: reading.capture.inApp,
        capturedAt: reading.capture.capturedAt,
        imageSha256: reading.capture.sha256,
        gps: reading.capture.gps,
      },
      policyCreatedAt: quote.createdAt,
      createdAt: now.toISOString(),
      clockOffsetMs: state.sync.clockOffsetMs,
    })
  }

  listPolicies(limit?: number) {
    return this.store.listPolicies(limit)
  }

  // -------------------------------------------------------------------------

  private async requireDevice(): Promise<StoredDevice> {
    const d = await this.store.get<StoredDevice>(K.device)
    if (!d) throw new Error('Device not registered. Log in while online.')
    return d
  }

  /** The agent's assigned border post, plus the last one they sold at. */
  private async bordersToStock(snapshot: Snapshot): Promise<string[]> {
    const assigned = snapshot.border_posts.find((b) => b.id === snapshot.profile.border_post_id)?.code
    const last = await this.store.get<string>(K.lastBorder)
    return [...new Set([assigned, last].filter((c): c is string => !!c))]
  }

  /** Offline credit sales queued but not yet acknowledged, per lease. */
  private async pendingCreditByLease(): Promise<Record<string, number>> {
    const pending: Record<string, number> = {}
    for (const item of await this.store.listOutbox()) {
      const r = item.payload as OfflinePolicyRecord
      if (item.kind === 'policy' && r.credit_lease_id) {
        pending[r.credit_lease_id] = (pending[r.credit_lease_id] ?? 0) + toMinor(r.premium_amount)
      }
    }
    return pending
  }
}

function fromServerRow(clientUuid: string, row: PolicyRow): LocalPolicy {
  return {
    client_uuid: clientUuid,
    policy_number: row.policy_number,
    data: row,
    issued_offline: false,
    created_at: row.created_at,
    synced: true,
  }
}

/** Card payments still in the outbox that paid for a policy (declined attempts excluded). */
function liveCardPayments(outbox: OutboxItem[], exceptUuid?: string): CardPaymentRecord[] {
  return outbox
    .filter((o) => o.kind === 'card_payment' && o.client_uuid !== exceptUuid)
    .map((o) => o.payload as CardPaymentRecord)
    .filter((p) => p.status !== 'DECLINED')
}

/**
 * Duplicate data from the last snapshot plus slips used on this device since,
 * so the same slip can't pay twice while offline.
 */
function localDedupe(snapshot: Snapshot, outbox: OutboxItem[], exceptUuid: string): DedupeIndex {
  const local = liveCardPayments(outbox, exceptUuid)
  const recibosByTid: Record<string, number[]> = {}
  for (const [tid, list] of Object.entries(snapshot.dedupe.recibos_by_tid)) recibosByTid[tid] = [...list]
  for (const p of local) {
    const tid = p.txn_key?.split('|')[0] ?? p.fields.tid
    const recibo = p.fields.recibo_no ? Number(p.fields.recibo_no) : NaN
    if (tid && Number.isInteger(recibo)) (recibosByTid[tid] ??= []).push(recibo)
  }
  return {
    txnKeys: [...snapshot.dedupe.txn_keys, ...local.flatMap((p) => (p.txn_key ? [p.txn_key] : []))],
    imageHashes: [...snapshot.dedupe.image_hashes, ...local.map((p) => p.image_sha256)],
    cardAmounts: [
      ...(snapshot.dedupe.card_amounts as DedupeIndex['cardAmounts']),
      ...local.flatMap((p) => (p.fields.pan_last4 && p.fields.amount && p.fields.currency && p.fields.txn_at
        ? [{ pan_last4: p.fields.pan_last4, amount: p.fields.amount, currency: p.fields.currency, txn_at: p.fields.txn_at }]
        : [])),
    ],
    recibosByTid,
  }
}

/** Card sales not yet confirmed by the server: unsynced on this device plus open review items. */
function openExposure(snapshot: Snapshot, outbox: OutboxItem[]): ValidationContext['exposure'] {
  const local = liveCardPayments(outbox)
  const openValueMinor = local.reduce((n, p) => n + toMinor(p.expected_amount), 0)
  return { openCount: local.length + snapshot.open_review_count, openValueMinor }
}

function fromOfflineRecord(
  r: OfflinePolicyRecord, cardPayment?: { tier: ValidationResult['tier']; flags: string[] },
): LocalPolicy {
  return {
    client_uuid: r.client_uuid,
    policy_number: r.policy_number,
    data: { ...r, created_at: r.device_issued_at, ...(cardPayment && { card_payment: cardPayment }) },
    issued_offline: true,
    created_at: r.device_issued_at,
  }
}
