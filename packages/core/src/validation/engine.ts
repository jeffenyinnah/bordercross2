import { formatMinor, parseDecimal, type Currency, type Minor } from '../money'
import type { InsurerSettings } from '../settings'
import type { ConfirmedSlip } from '../slip/confirm'
import type { SlipFieldName } from '../slip/parser'
import { keywordMatch, normalizeLine } from '../slip/text'
import { matchId } from './fuzzy'

// ---------------------------------------------------------------------------
// Context types — everything the engine needs, supplied by the device (from its
// cached snapshot) or by the server (from the full dataset) during sync.
// ---------------------------------------------------------------------------

export interface WhitelistTerminal {
  id: string
  tid: string
  mid: string
  insurer_id: string
  assigned_agent_id: string | null
  border_post_id: string | null
  is_active: boolean
  last_recibo?: number | null
}

export interface WhitelistMerchant {
  id: string
  mid: string
  insurer_id: string
  is_active: boolean
}

export interface Whitelist {
  terminals: WhitelistTerminal[]
  merchants: WhitelistMerchant[]
  /** when this copy was fetched from the server */
  updatedAt: string
}

export interface CardAmountEntry {
  pan_last4: string
  amount: string
  currency: string
  txn_at: string
}

export interface DedupeIndex {
  /** txnKey() of every payment already used */
  txnKeys: Iterable<string>
  imageHashes: Iterable<string>
  /** recent (masked) card + amount uses, for the same-card flag */
  cardAmounts: CardAmountEntry[]
  /** RECIBO numbers already seen per TID */
  recibosByTid: Record<string, number[]>
}

export interface ValidationContext {
  /** premium computed by the system — never taken from the slip */
  expected: { amountMinor: Minor; currency: Currency }
  agent: { id: string; insurerId: string; borderPostId: string | null }
  /** device time when the premium was calculated and shown to the agent */
  policyCreatedAt: string
  /** device time now */
  now: string
  /** server time minus device time, measured at the last sync; null = never measured */
  clockOffsetMs: number | null
  whitelist: Whitelist
  dedupe: DedupeIndex
  capture: {
    /** photo taken with the in-app camera (gallery imports are impossible by design) */
    inApp: boolean
    capturedAt: string
    imageSha256: string
    gps: { lat: number; lng: number; accuracyM: number | null } | null
  }
  /** flagged or unsynced card-slip policies currently open for this agent */
  /** open = flagged or not yet synced; value in MZN */
  exposure: { openCount: number; openValueMinor: Minor }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type Severity = 'HARD' | 'FLAG'
export type Tier = 'AUTO_PASS' | 'ISSUE_WITH_FLAG' | 'HARD_DECLINE'

export interface Check {
  /** stable code; the UI translates it (messages below are English defaults) */
  id: string
  pass: boolean
  severity: Severity
  fields: SlipFieldName[]
  expected?: string | null
  actual?: string | null
  message: string
}

export interface ValidationResult {
  tier: Tier
  /** a certificate may be issued now */
  canIssue: boolean
  /** why a non-declined slip still can't be issued */
  blockedReason: null | 'CONFIRM_FIELDS' | 'EXPOSURE_CAP'
  /** required fields the agent must read and confirm/correct first */
  needsConfirmation: SlipFieldName[]
  checks: Check[]
  /** codes of failed FLAG checks — stored on the payment, drive the review queue */
  flags: string[]
  /** for the wrong-amount screen: what the slip said vs what was expected */
  amountMismatch: { expected: string; actual: string } | null
  /** whitelist entries the slip resolved to (after fuzzy snapping) */
  resolved: {
    terminalId: string | null
    tid: string | null
    merchantId: string | null
    mid: string | null
    txnKey: string | null
  }
}

export const REQUIRED_FIELDS: SlipFieldName[] = [
  'amount', 'currency', 'approval_status', 'rc', 'txn_type', 'tid', 'mid', 'rrn', 'auth_code', 'txn_at',
]

/** Canonical duplicate key: TID + RRN + AUTH CODE + transaction instant (UTC). */
export function txnKey(p: { tid: string; rrn: string; auth_code: string; txn_at: string }): string {
  return `${p.tid}|${p.rrn}|${p.auth_code}|${new Date(p.txn_at).toISOString()}`
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const MIN = 60_000

/**
 * Validate a confirmed slip against the policy being issued.
 * Pure: identical inputs give identical results on the device and on the server.
 */
export function validateSlip(
  slip: ConfirmedSlip, ctx: ValidationContext, settings: InsurerSettings
): ValidationResult {
  const v = slip.values
  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)
  const edited = new Set(slip.edits.map((e) => e.field))
  const confirmed = new Set(slip.confirmed)

  // Fields that can't be trusted yet. Checks that depend on them are skipped, so an
  // OCR misread never produces a decline the agent can't understand.
  const needsConfirmation = REQUIRED_FIELDS.filter((f) =>
    v[f] === null
    || !slip.valid[f]
    || (!edited.has(f) && !confirmed.has(f) && slip.confidence[f] < settings.ocr_conf_min))
  const ready = (...fs: SlipFieldName[]) => fs.every((f) => !needsConfirmation.includes(f))

  // ---- Amount -------------------------------------------------------------
  let amountMismatch: ValidationResult['amountMismatch'] = null
  if (ready('amount', 'currency')) {
    const actualMinor = parseDecimal(v.amount!)
    const expected = `${formatMinor(ctx.expected.amountMinor)} ${ctx.expected.currency}`
    const actual = `${actualMinor === null ? v.amount : formatMinor(actualMinor)} ${v.currency}`
    const pass = actualMinor === ctx.expected.amountMinor && v.currency === ctx.expected.currency
    if (!pass) amountMismatch = { expected, actual }
    add({
      id: 'AMOUNT_MATCH', pass, severity: 'HARD', fields: ['amount', 'currency'], expected, actual,
      message: pass
        ? 'Amount matches the premium'
        : `The slip shows ${actual} but the premium is ${expected}. Run a new card payment for ${expected} and capture the new slip.`,
    })
  }

  // ---- Approval -------------------------------------------------------------
  if (ready('approval_status')) {
    const pass = settings.approved_statuses.map(normalizeLine).includes(normalizeLine(v.approval_status!))
    add({
      id: 'APPROVAL_STATUS', pass, severity: 'HARD', fields: ['approval_status'],
      expected: settings.approved_statuses.join(' / '), actual: v.approval_status,
      message: pass ? 'Payment approved' : `The payment was not approved (${v.approval_status}).`,
    })
  }
  if (ready('rc')) {
    const pass = settings.success_response_codes.includes(v.rc!)
    add({
      id: 'RESPONSE_CODE', pass, severity: 'HARD', fields: ['rc'],
      expected: settings.success_response_codes.join(' / '), actual: v.rc,
      message: pass ? 'Response code is success' : `The bank response code ${v.rc} is not a success code.`,
    })
  }
  if (ready('txn_type')) {
    const pass = settings.accepted_txn_types.map(normalizeLine).includes(normalizeLine(v.txn_type!))
    add({
      id: 'TXN_TYPE', pass, severity: 'HARD', fields: ['txn_type'],
      expected: settings.accepted_txn_types.join(' / '), actual: v.txn_type,
      message: pass ? 'Transaction is a purchase' : `${v.txn_type} slips are not accepted, only purchases.`,
    })
  }

  // ---- Terminal (TID) ---------------------------------------------------------
  let terminal: WhitelistTerminal | null = null
  if (ready('tid')) {
    const m = matchId(v.tid!, ctx.whitelist.terminals.map((t) => t.tid), settings.fuzzy_max_distance)
    if (m.kind === 'none') {
      add({
        id: 'TERMINAL_KNOWN', pass: false, severity: 'HARD', fields: ['tid'], actual: v.tid,
        message: `Terminal ${v.tid} is not registered. Only registered POS terminals can be used.`,
      })
    } else if (m.kind === 'ambiguous') {
      add({
        id: 'TERMINAL_KNOWN', pass: false, severity: 'HARD', fields: ['tid'], actual: v.tid,
        expected: m.options.join(' / '),
        message: `Terminal ${v.tid} could be ${m.options.join(' or ')}. Check the TID on the slip and capture it again.`,
      })
    } else {
      terminal = ctx.whitelist.terminals.find((t) => t.tid === m.value)!
      add({ id: 'TERMINAL_KNOWN', pass: true, severity: 'HARD', fields: ['tid'], actual: v.tid, message: 'Terminal is registered' })
      if (m.kind === 'snapped') {
        add({
          id: 'TID_SNAPPED', pass: false, severity: 'FLAG', fields: ['tid'], expected: m.value, actual: v.tid,
          message: `TID read as ${v.tid}; matched to registered terminal ${m.value}. Confirm it matches the slip.`,
        })
      }
      const assigned = terminal.is_active
        && terminal.insurer_id === ctx.agent.insurerId
        && (terminal.assigned_agent_id === ctx.agent.id
          || (terminal.assigned_agent_id === null
            && terminal.border_post_id !== null
            && terminal.border_post_id === ctx.agent.borderPostId))
      add({
        id: 'TERMINAL_ASSIGNED', pass: assigned, severity: 'HARD', fields: ['tid'], actual: terminal.tid,
        message: assigned
          ? 'Terminal is assigned to this agent / border post'
          : `Terminal ${terminal.tid} is not assigned to you or your border post${terminal.is_active ? '' : ' (terminal is inactive)'}.`,
      })
    }
  }

  // ---- Merchant (MID) ---------------------------------------------------------
  let merchant: WhitelistMerchant | null = null
  if (ready('mid')) {
    const m = matchId(v.mid!, ctx.whitelist.merchants.map((x) => x.mid), settings.fuzzy_max_distance)
    if (m.kind === 'none' || m.kind === 'ambiguous') {
      add({
        id: 'MERCHANT_KNOWN', pass: false, severity: 'HARD', fields: ['mid'], actual: v.mid,
        expected: m.kind === 'ambiguous' ? m.options.join(' / ') : null,
        message: m.kind === 'none'
          ? `Merchant ID ${v.mid} is not registered for card payments.`
          : `Merchant ID ${v.mid} is ambiguous. Check the MID on the slip and capture it again.`,
      })
    } else {
      merchant = ctx.whitelist.merchants.find((x) => x.mid === m.value)!
      add({ id: 'MERCHANT_KNOWN', pass: true, severity: 'HARD', fields: ['mid'], actual: v.mid, message: 'Merchant is registered' })
      if (m.kind === 'snapped') {
        add({
          id: 'MID_SNAPPED', pass: false, severity: 'FLAG', fields: ['mid'], expected: m.value, actual: v.mid,
          message: `MID read as ${v.mid}; matched to registered merchant ${m.value}. Confirm it matches the slip.`,
        })
      }
      const ok = merchant.is_active && merchant.insurer_id === ctx.agent.insurerId
      add({
        id: 'MERCHANT_INSURER', pass: ok, severity: 'HARD', fields: ['mid'], actual: merchant.mid,
        message: ok ? 'Merchant belongs to this insurer' : `Merchant ${merchant.mid} does not belong to your insurer.`,
      })
    }
  }
  if (terminal && merchant) {
    const pass = terminal.mid === merchant.mid
    add({
      id: 'TERMINAL_MERCHANT', pass, severity: 'HARD', fields: ['tid', 'mid'],
      expected: terminal.mid, actual: merchant.mid,
      message: pass ? 'Terminal and merchant match' : `Terminal ${terminal.tid} is registered to merchant ${terminal.mid}, not ${merchant.mid}.`,
    })
  }

  // ---- Time window ------------------------------------------------------------
  const offset = ctx.clockOffsetMs ?? 0
  const nowServer = Date.parse(ctx.now) + offset
  if (ctx.clockOffsetMs === null) {
    add({
      id: 'CLOCK_UNVERIFIED', pass: false, severity: 'FLAG', fields: [],
      message: 'Device clock has not been checked against the server yet; time checks need review.',
    })
  } else if (Math.abs(ctx.clockOffsetMs) > settings.clock_drift_tolerance_sec * 1000) {
    add({
      id: 'CLOCK_DRIFT', pass: false, severity: 'FLAG', fields: [],
      actual: `${Math.round(ctx.clockOffsetMs / 1000)}s`,
      message: 'The device clock differs from the server clock. Times were corrected; please fix the device clock.',
    })
  }
  if (ready('txn_at')) {
    const txnAt = Date.parse(v.txn_at!)
    const createdServer = Date.parse(ctx.policyCreatedAt) + offset
    // Without a measured clock offset a timing failure can't be proven: flag instead of decline
    const timeSeverity: Severity = ctx.clockOffsetMs === null ? 'FLAG' : 'HARD'
    const future = txnAt > nowServer + settings.clock_skew_tolerance_sec * 1000
    add({
      id: 'TIME_NOT_FUTURE', pass: !future, severity: timeSeverity, fields: ['txn_at'], actual: v.txn_at,
      message: future ? 'The slip date/time is in the future.' : 'Slip time is not in the future',
    })
    const diffMin = Math.abs(txnAt - createdServer) / MIN
    const inWindow = diffMin <= settings.slip_time_window_min
    add({
      id: 'TIME_WINDOW', pass: inWindow, severity: timeSeverity, fields: ['txn_at'],
      expected: `within ${settings.slip_time_window_min} min of policy creation`,
      actual: `${Math.round(diffMin)} min`,
      message: inWindow
        ? 'Slip time is within the allowed window'
        : `The slip is ${Math.round(diffMin)} minutes away from when this policy was created (max ${settings.slip_time_window_min}). Only a payment made for this policy can be used.`,
    })
  }

  // ---- Duplicates ----------------------------------------------------------------
  const tidForKey = terminal?.tid ?? v.tid
  const key = ready('tid', 'rrn', 'auth_code', 'txn_at') && tidForKey
    ? txnKey({ tid: tidForKey, rrn: v.rrn!, auth_code: v.auth_code!, txn_at: v.txn_at! })
    : null
  if (key) {
    const dup = new Set(ctx.dedupe.txnKeys).has(key)
    add({
      id: 'DUPLICATE_TXN', pass: !dup, severity: 'HARD', fields: ['tid', 'rrn', 'auth_code', 'txn_at'],
      message: dup ? 'This card payment has already been used for another policy.' : 'Payment not used before',
    })
  }
  const dupImage = new Set(ctx.dedupe.imageHashes).has(ctx.capture.imageSha256)
  add({
    id: 'DUPLICATE_IMAGE', pass: !dupImage, severity: 'HARD', fields: [],
    message: dupImage ? 'This photo has already been used for another payment.' : 'Photo not used before',
  })

  if (v.pan_last4 && ready('amount', 'currency', 'txn_at')) {
    const txnAt = Date.parse(v.txn_at!)
    const amountMinor = parseDecimal(v.amount!)
    const near = ctx.dedupe.cardAmounts.some((e) =>
      e.pan_last4 === v.pan_last4
      && parseDecimal(e.amount) === amountMinor
      && e.currency === v.currency
      && Math.abs(Date.parse(e.txn_at) - txnAt) <= settings.same_pan_amount_window_min * MIN)
    if (near) {
      add({
        id: 'SAME_CARD_AMOUNT', pass: false, severity: 'FLAG', fields: ['pan_last4', 'amount'],
        message: `Card ending ${v.pan_last4} paid the same amount within ${settings.same_pan_amount_window_min} minutes.`,
      })
    }
  }

  // ---- RECIBO sequence per terminal (flag only: unknown how declined attempts count) ----
  const recibo = v.recibo_no ? Number(v.recibo_no) : null
  if (terminal && recibo !== null && Number.isInteger(recibo)) {
    const seen = [...(ctx.dedupe.recibosByTid[terminal.tid] ?? [])]
    if (terminal.last_recibo != null) seen.push(terminal.last_recibo)
    if (seen.includes(recibo)) {
      add({
        id: 'RECIBO_REPEAT', pass: false, severity: 'FLAG', fields: ['recibo_no'], actual: String(recibo),
        message: `Receipt #${recibo} was already seen on terminal ${terminal.tid}.`,
      })
    } else if (seen.length) {
      const max = Math.max(...seen)
      if (recibo > max + 1) {
        add({
          id: 'RECIBO_GAP', pass: false, severity: 'FLAG', fields: ['recibo_no'],
          expected: String(max + 1), actual: String(recibo),
          message: `Receipt numbers ${max + 1}–${recibo - 1} on terminal ${terminal.tid} were not seen.`,
        })
      } else if (recibo < max) {
        add({
          id: 'RECIBO_OUT_OF_ORDER', pass: false, severity: 'FLAG', fields: ['recibo_no'],
          expected: `> ${max}`, actual: String(recibo),
          message: `Receipt #${recibo} is older than the last receipt seen (#${max}) on terminal ${terminal.tid}.`,
        })
      }
    }
  }

  // ---- Copy wording (configurable; skipped until the bank confirms the text) ------
  if (settings.expected_copy_wording.length > 0) {
    const copy = v.copy_type ? normalizeLine(v.copy_type) : null
    const pass = copy !== null && settings.expected_copy_wording.some((w) => keywordMatch(copy, normalizeLine(w)) > 0)
    add({
      id: 'COPY_WORDING', pass, severity: settings.copy_wording_severity, fields: ['copy_type'],
      expected: settings.expected_copy_wording.join(' / '), actual: v.copy_type,
      message: pass ? 'Correct slip copy' : `Expected the ${settings.expected_copy_wording.join(' / ')} slip, found ${v.copy_type ?? 'no copy wording'}.`,
    })
  }

  // ---- Capture metadata -------------------------------------------------------------
  if (!ctx.capture.inApp) {
    add({
      id: 'CAPTURE_IN_APP', pass: false, severity: 'HARD', fields: [],
      message: 'The slip photo must be taken with the in-app camera.',
    })
  }
  const captureAgeSec = (Date.parse(ctx.now) - Date.parse(ctx.capture.capturedAt)) / 1000
  if (captureAgeSec > settings.capture_max_age_sec || captureAgeSec < -settings.clock_skew_tolerance_sec) {
    add({
      id: 'CAPTURE_TIME', pass: false, severity: 'FLAG', fields: [], actual: `${Math.round(captureAgeSec)}s`,
      message: 'The photo was not taken just now.',
    })
  }
  if (settings.require_gps && !ctx.capture.gps) {
    add({ id: 'NO_GPS', pass: false, severity: 'FLAG', fields: [], message: 'No GPS location was recorded.' })
  }

  // ---- OCR confidence and agent edits on required fields ------------------------------
  for (const f of REQUIRED_FIELDS) {
    if (needsConfirmation.includes(f)) continue
    if (edited.has(f)) {
      const e = slip.edits.find((x) => x.field === f)!
      add({
        id: `AGENT_EDITED:${f}`, pass: false, severity: 'FLAG', fields: [f],
        expected: e.ocr_value, actual: e.edited_value,
        message: `${f} was corrected by the agent.`,
      })
    } else if (slip.confidence[f] < settings.ocr_conf_auto) {
      add({
        id: `LOW_CONFIDENCE:${f}`, pass: false, severity: 'FLAG', fields: [f], actual: v[f],
        message: `${f} was hard to read${confirmed.has(f) ? ' (confirmed by the agent)' : ''}.`,
      })
    }
  }
  if (slip.warnings.includes('UNMASKED_PAN_SEEN')) {
    add({ id: 'UNMASKED_PAN_SEEN', pass: false, severity: 'FLAG', fields: ['pan_last4'], message: 'A full card number was visible on the slip.' })
  }

  // ---- Whitelist freshness -------------------------------------------------------------
  const staleHours = (nowServer - Date.parse(ctx.whitelist.updatedAt)) / 3_600_000
  if (staleHours > settings.whitelist_stale_hours) {
    add({
      id: 'WHITELIST_STALE', pass: false, severity: 'FLAG', fields: [],
      actual: `${Math.round(staleHours)}h`,
      message: `Terminal list was last updated ${Math.round(staleHours)} hours ago. Connect to sync.`,
    })
  }

  // ---- Outcome --------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass)
  const flags = failed.filter((c) => c.severity === 'FLAG').map((c) => c.id)
  const resolved = {
    terminalId: terminal?.id ?? null,
    tid: terminal?.tid ?? null,
    merchantId: merchant?.id ?? null,
    mid: merchant?.mid ?? null,
    txnKey: key,
  }
  const base = { checks, flags, amountMismatch, resolved, needsConfirmation }

  if (failed.some((c) => c.severity === 'HARD')) {
    return { ...base, tier: 'HARD_DECLINE', canIssue: false, blockedReason: null }
  }
  const tier: Tier = flags.length ? 'ISSUE_WITH_FLAG' : 'AUTO_PASS'
  if (needsConfirmation.length) {
    return { ...base, tier, canIssue: false, blockedReason: 'CONFIRM_FIELDS' }
  }
  if (tier === 'ISSUE_WITH_FLAG') {
    const capValueMinor = Math.round(settings.exposure_cap_value * 100)
    const overCount = ctx.exposure.openCount + 1 > settings.exposure_cap_count
    const overValue = ctx.exposure.openValueMinor + ctx.expected.amountMinor > capValueMinor
    if (overCount || overValue) {
      return { ...base, tier, canIssue: false, blockedReason: 'EXPOSURE_CAP' }
    }
  }
  return { ...base, tier, canIssue: true, blockedReason: null }
}
