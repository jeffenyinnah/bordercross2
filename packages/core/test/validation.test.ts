import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INSURER_SETTINGS, SIMO_REDE_PROFILE, confirmSlip, linesFromText, matchId,
  normalizeFieldInput, parseInsurerSettings, parseSlip, txnKey, validateSlip,
  type ConfirmedSlip, type FieldEdit, type InsurerSettings, type SlipFieldName,
  type ValidationContext, type ValidationResult,
} from '../src'
import { SLIP_1, SLIP_2, withLine } from './fixtures/slips'

// ---------------------------------------------------------------------------
// Scenario builder: sample slip 1 at a correctly assigned terminal passes cleanly.
// Each test changes one thing.
// ---------------------------------------------------------------------------

const AT = '2026-10-11T13:41:00+02:00'

function confirm(
  text: string,
  opts: { conf?: number; edits?: FieldEdit[]; confirmed?: SlipFieldName[] } = {}
): ConfirmedSlip {
  const parsed = parseSlip(linesFromText(text, opts.conf), SIMO_REDE_PROFILE)
  return confirmSlip(parsed, SIMO_REDE_PROFILE, { edits: opts.edits, confirmed: opts.confirmed, at: AT })
}

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    expected: { amountMinor: 300000, currency: 'MZN' },
    agent: { id: 'agent-1', insurerId: 'ins-a', borderPostId: 'bp-rgar' },
    policyCreatedAt: '2026-10-11T13:36:00+02:00',
    now: AT,
    clockOffsetMs: 0,
    whitelist: {
      terminals: [
        { id: 't1', tid: '00236255', mid: '000000000130941', insurer_id: 'ins-a', assigned_agent_id: 'agent-1', border_post_id: 'bp-rgar', is_active: true, last_recibo: 711 },
        { id: 't2', tid: '00256885', mid: '000000000146159', insurer_id: 'ins-a', assigned_agent_id: 'agent-2', border_post_id: 'bp-nama', is_active: true, last_recibo: null },
      ],
      merchants: [
        { id: 'm1', mid: '000000000130941', insurer_id: 'ins-a', is_active: true },
        { id: 'm2', mid: '000000000146159', insurer_id: 'ins-a', is_active: true },
        { id: 'm3', mid: '000000000999999', insurer_id: 'ins-b', is_active: true },
      ],
      updatedAt: '2026-10-11T12:00:00+02:00',
    },
    dedupe: { txnKeys: [], imageHashes: [], cardAmounts: [], recibosByTid: {} },
    capture: {
      inApp: true,
      capturedAt: '2026-10-11T13:40:30+02:00',
      imageSha256: 'a'.repeat(64),
      gps: { lat: -25.44, lng: 31.98, accuracyM: 12 },
    },
    exposure: { openCount: 0, openValueMinor: 0 },
    ...over,
  }
}

const settings = (over: Partial<InsurerSettings> = {}) => ({ ...DEFAULT_INSURER_SETTINGS, ...over })
const run = (slip = confirm(SLIP_1), c = ctx(), s = settings()) => validateSlip(slip, c, s)
const failed = (r: ValidationResult) => r.checks.filter((c) => !c.pass).map((c) => `${c.severity}:${c.id}`)

// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('sample slip 1 at its assigned terminal is AUTO_PASS', () => {
    const r = run()
    expect(failed(r)).toEqual([])
    expect(r).toMatchObject({ tier: 'AUTO_PASS', canIssue: true, blockedReason: null, flags: [], needsConfirmation: [] })
    expect(r.resolved).toEqual({
      terminalId: 't1', tid: '00236255', merchantId: 'm1', mid: '000000000130941',
      txnKey: '00236255|628451143467|727255|2026-10-11T11:39:54.000Z',
    })
  })

  it('is deterministic', () => {
    expect(run()).toEqual(run())
  })
})

describe('amount (HARD)', () => {
  it('declines a mistyped POS amount and shows slip vs expected', () => {
    const r = run(confirm(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE: 300.00 MZN')))
    expect(r.tier).toBe('HARD_DECLINE')
    expect(r.canIssue).toBe(false)
    expect(r.amountMismatch).toEqual({ expected: '3000.00 MZN', actual: '300.00 MZN' })
    expect(r.checks.find((c) => c.id === 'AMOUNT_MATCH')!.message).toMatch(/new card payment/)
  })

  it('declines the right number in the wrong currency', () => {
    const r = run(confirm(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE: 3000.00 ZAR')))
    expect(failed(r)).toContain('HARD:AMOUNT_MATCH')
    expect(r.amountMismatch).toEqual({ expected: '3000.00 MZN', actual: '3000.00 ZAR' })
  })
})

describe('approval, response code, transaction type (HARD)', () => {
  it('declines RECUSADA', () => {
    expect(failed(run(confirm(withLine(SLIP_1, 'APROVADA', 'RECUSADA'))))).toContain('HARD:APPROVAL_STATUS')
  })

  it('requires RC 000 even when APROVADA is printed', () => {
    const r = run(confirm(withLine(SLIP_1, 'RRN:628451143467    RC: 000', 'RRN:628451143467    RC: 051')))
    expect(r.tier).toBe('HARD_DECLINE')
    expect(failed(r)).toEqual(['HARD:RESPONSE_CODE'])
  })

  it.each(['DEVOLUCAO', 'ANULACAO', 'ESTORNO'])('declines %s', (type) => {
    expect(failed(run(confirm(withLine(SLIP_1, 'COMPRA', type))))).toContain('HARD:TXN_TYPE')
  })
})

describe('terminal and merchant whitelist', () => {
  const tidLine = 'TID: 00236255   BATCH:518'

  it('declines an unregistered terminal', () => {
    const r = run(confirm(withLine(SLIP_1, tidLine, 'TID: 99999999   BATCH:518')))
    expect(failed(r)).toContain('HARD:TERMINAL_KNOWN')
  })

  it('snaps a one-digit OCR error to the registered TID and flags it', () => {
    const r = run(confirm(withLine(SLIP_1, tidLine, 'TID: 00236256   BATCH:518')))
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
    expect(r.canIssue).toBe(true)
    expect(r.flags).toContain('TID_SNAPPED')
    expect(r.resolved.tid).toBe('00236255')
    expect(r.checks.find((c) => c.id === 'TID_SNAPPED')).toMatchObject({ expected: '00236255', actual: '00236256' })
  })

  it('declines when the read is equally close to two terminals', () => {
    const c = ctx()
    c.whitelist.terminals.push({ ...c.whitelist.terminals[0], id: 't3', tid: '00236257' })
    const r = run(confirm(withLine(SLIP_1, tidLine, 'TID: 00236256   BATCH:518')), c)
    expect(failed(r)).toContain('HARD:TERMINAL_KNOWN')
    expect(r.checks.find((c) => c.id === 'TERMINAL_KNOWN')!.expected).toBe('00236255 / 00236257')
  })

  it("declines another agent's terminal", () => {
    const r = run(confirm(SLIP_2), ctx({ expected: { amountMinor: 3000, currency: 'MZN' }, policyCreatedAt: '2026-10-09T09:33:00+02:00', now: '2026-10-09T09:37:00+02:00', capture: { ...ctx().capture, capturedAt: '2026-10-09T09:36:30+02:00' } }))
    expect(failed(r)).toEqual(['HARD:TERMINAL_ASSIGNED'])
  })

  it('accepts a terminal assigned to the border post rather than a person', () => {
    const c = ctx()
    c.whitelist.terminals[0] = { ...c.whitelist.terminals[0], assigned_agent_id: null }
    expect(run(undefined, c).tier).toBe('AUTO_PASS')
    c.agent = { ...c.agent, borderPostId: 'bp-other' }
    expect(failed(run(undefined, c))).toContain('HARD:TERMINAL_ASSIGNED')
  })

  it('declines an inactive or other-insurer terminal', () => {
    const c = ctx()
    c.whitelist.terminals[0] = { ...c.whitelist.terminals[0], is_active: false }
    expect(failed(run(undefined, c))).toContain('HARD:TERMINAL_ASSIGNED')
    const c2 = ctx()
    c2.whitelist.terminals[0] = { ...c2.whitelist.terminals[0], insurer_id: 'ins-b' }
    expect(failed(run(undefined, c2))).toContain('HARD:TERMINAL_ASSIGNED')
  })

  it("declines another insurer's merchant ID", () => {
    const r = run(confirm(withLine(SLIP_1, 'MID: 000000000130941', 'MID: 000000000999999')))
    expect(failed(r)).toEqual(expect.arrayContaining(['HARD:MERCHANT_INSURER', 'HARD:TERMINAL_MERCHANT']))
  })

  it('declines a terminal used with a different merchant ID', () => {
    const r = run(confirm(withLine(SLIP_1, 'MID: 000000000130941', 'MID: 000000000146159')))
    expect(failed(r)).toEqual(['HARD:TERMINAL_MERCHANT'])
  })

  it('snaps a one-digit MID error and flags it', () => {
    const r = run(confirm(withLine(SLIP_1, 'MID: 000000000130941', 'MID: 000000000130947')))
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
    expect(r.flags).toContain('MID_SNAPPED')
    expect(r.resolved.mid).toBe('000000000130941')
  })
})

describe('time window', () => {
  it('declines a slip from long before the policy was created', () => {
    const r = run(undefined, ctx({ policyCreatedAt: '2026-10-11T14:00:00+02:00', now: '2026-10-11T14:05:00+02:00', capture: { ...ctx().capture, capturedAt: '2026-10-11T14:04:30+02:00' } }))
    expect(failed(r)).toContain('HARD:TIME_WINDOW')
    expect(r.checks.find((c) => c.id === 'TIME_WINDOW')!.actual).toBe('20 min')
  })

  it('declines a slip dated in the future', () => {
    const r = run(undefined, ctx({ policyCreatedAt: '2026-10-11T13:33:00+02:00', now: '2026-10-11T13:35:00+02:00', capture: { ...ctx().capture, capturedAt: '2026-10-11T13:34:50+02:00' } }))
    expect(failed(r)).toContain('HARD:TIME_NOT_FUTURE')
  })

  it('respects a configured window', () => {
    const r = run(undefined, ctx(), settings({ slip_time_window_min: 2 }))
    expect(failed(r)).toContain('HARD:TIME_WINDOW')
  })

  it('corrects a wrong device clock with the server offset and flags the drift', () => {
    // Device clock is 30 minutes slow: device times are 30 min earlier than real time
    const r = run(undefined, ctx({
      policyCreatedAt: '2026-10-11T13:06:00+02:00',
      now: '2026-10-11T13:11:00+02:00',
      clockOffsetMs: 30 * 60_000,
      capture: { ...ctx().capture, capturedAt: '2026-10-11T13:10:30+02:00' },
    }))
    expect(failed(r)).toEqual(['FLAG:CLOCK_DRIFT'])
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
  })

  it('flags instead of declining when the clock was never verified', () => {
    const r = run(undefined, ctx({ clockOffsetMs: null, policyCreatedAt: '2026-10-11T14:00:00+02:00', now: '2026-10-11T14:05:00+02:00', capture: { ...ctx().capture, capturedAt: '2026-10-11T14:04:30+02:00' } }))
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
    expect(r.flags).toEqual(expect.arrayContaining(['CLOCK_UNVERIFIED', 'TIME_WINDOW']))
  })
})

describe('duplicates', () => {
  it('declines a payment already used (same TID+RRN+AUTH+time)', () => {
    const key = txnKey({ tid: '00236255', rrn: '628451143467', auth_code: '727255', txn_at: '2026-10-11T11:39:54Z' })
    const r = run(undefined, ctx({ dedupe: { ...ctx().dedupe, txnKeys: [key] } }))
    expect(failed(r)).toEqual(['HARD:DUPLICATE_TXN'])
  })

  it('declines even when the reused slip had a TID OCR error', () => {
    const key = txnKey({ tid: '00236255', rrn: '628451143467', auth_code: '727255', txn_at: '2026-10-11T13:39:54+02:00' })
    const slip = confirm(withLine(SLIP_1, 'TID: 00236255   BATCH:518', 'TID: 00236256   BATCH:518'))
    const r = run(slip, ctx({ dedupe: { ...ctx().dedupe, txnKeys: [key] } }))
    expect(failed(r)).toContain('HARD:DUPLICATE_TXN')
  })

  it('declines a reused photo', () => {
    const r = run(undefined, ctx({ dedupe: { ...ctx().dedupe, imageHashes: ['a'.repeat(64)] } }))
    expect(failed(r)).toEqual(['HARD:DUPLICATE_IMAGE'])
  })

  it('flags the same card paying the same amount shortly before', () => {
    const near = { pan_last4: '8622', amount: '3000.00', currency: 'MZN', txn_at: '2026-10-11T13:20:00+02:00' }
    const r = run(undefined, ctx({ dedupe: { ...ctx().dedupe, cardAmounts: [near] } }))
    expect(r.flags).toEqual(['SAME_CARD_AMOUNT'])
    const far = { ...near, txn_at: '2026-10-11T10:00:00+02:00' }
    expect(run(undefined, ctx({ dedupe: { ...ctx().dedupe, cardAmounts: [far] } })).flags).toEqual([])
    const other = { ...near, amount: '30.00' }
    expect(run(undefined, ctx({ dedupe: { ...ctx().dedupe, cardAmounts: [other] } })).flags).toEqual([])
  })
})

describe('RECIBO sequence per terminal (flags only)', () => {
  const withHistory = (recibos: number[], last: number | null = null) => {
    const c = ctx({ dedupe: { ...ctx().dedupe, recibosByTid: { '00236255': recibos } } })
    c.whitelist.terminals[0] = { ...c.whitelist.terminals[0], last_recibo: last }
    return c
  }
  it('passes the next number in sequence', () => {
    expect(run(undefined, withHistory([709, 710, 711])).flags).toEqual([])
  })
  it('passes when the terminal has no history yet', () => {
    expect(run(undefined, withHistory([])).flags).toEqual([])
  })
  it('flags a repeat', () => {
    expect(run(undefined, withHistory([712])).flags).toEqual(['RECIBO_REPEAT'])
  })
  it('flags a gap', () => {
    const r = run(undefined, withHistory([705]))
    expect(r.flags).toEqual(['RECIBO_GAP'])
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
  })
  it('flags an older number', () => {
    expect(run(undefined, withHistory([800])).flags).toEqual(['RECIBO_OUT_OF_ORDER'])
  })
})

describe('copy wording (configurable)', () => {
  it('is skipped until the expected wording is configured', () => {
    expect(run().checks.some((c) => c.id === 'COPY_WORDING')).toBe(false)
  })
  it('flags a customer copy when the merchant copy is expected', () => {
    const r = run(undefined, ctx(), settings({ expected_copy_wording: ['COPIA DO COMERCIANTE'] }))
    expect(r.flags).toEqual(['COPY_WORDING'])
  })
  it('can be made a hard decline', () => {
    const r = run(undefined, ctx(), settings({ expected_copy_wording: ['COPIA DO COMERCIANTE'], copy_wording_severity: 'HARD' }))
    expect(r.tier).toBe('HARD_DECLINE')
  })
  it('passes the configured wording, tolerating OCR noise', () => {
    const slip = confirm(withLine(SLIP_1, 'COPIA DO CLIENTE', 'COPIA DO COMERC1ANTE'))
    expect(run(slip, ctx(), settings({ expected_copy_wording: ['COPIA DO COMERCIANTE'] })).flags).toEqual([])
  })
})

describe('capture metadata', () => {
  it('declines a photo not taken in-app', () => {
    expect(failed(run(undefined, ctx({ capture: { ...ctx().capture, inApp: false } })))).toEqual(['HARD:CAPTURE_IN_APP'])
  })
  it('flags an old photo', () => {
    const r = run(undefined, ctx({ capture: { ...ctx().capture, capturedAt: '2026-10-11T13:30:00+02:00' } }))
    expect(r.flags).toEqual(['CAPTURE_TIME'])
  })
  it('flags missing GPS only when required', () => {
    const noGps = ctx({ capture: { ...ctx().capture, gps: null } })
    expect(run(undefined, noGps).flags).toEqual([])
    expect(run(undefined, noGps, settings({ require_gps: true })).flags).toEqual(['NO_GPS'])
  })
})

describe('OCR confidence and agent corrections', () => {
  it('flags required fields read below the auto-pass confidence', () => {
    const r = run(confirm(SLIP_1, { conf: 0.8 }))
    expect(r.tier).toBe('ISSUE_WITH_FLAG')
    expect(r.canIssue).toBe(true)
    expect(r.flags).toContain('LOW_CONFIDENCE:rrn')
  })

  it('requires confirmation below the minimum confidence, then issues with flags', () => {
    const low = run(confirm(SLIP_1, { conf: 0.5 }))
    expect(low).toMatchObject({ canIssue: false, blockedReason: 'CONFIRM_FIELDS' })
    expect(low.needsConfirmation).toEqual(expect.arrayContaining(['amount', 'tid', 'rrn']))

    const all = low.needsConfirmation
    const ok = run(confirm(SLIP_1, { conf: 0.5, confirmed: all }))
    expect(ok).toMatchObject({ canIssue: true, tier: 'ISSUE_WITH_FLAG', needsConfirmation: [] })
  })

  it('asks for a missing field and records the agent entry for audit', () => {
    const missing = confirm(withLine(SLIP_1, 'AUTH CODE: 727255', null))
    expect(run(missing).needsConfirmation).toEqual(['auth_code'])

    const fixed = confirm(withLine(SLIP_1, 'AUTH CODE: 727255', null), { edits: [{ field: 'auth_code', value: '727 255' }] })
    expect(fixed.edits).toEqual([{ field: 'auth_code', ocr_value: null, edited_value: '727255', at: AT }])
    const r = run(fixed)
    expect(r).toMatchObject({ canIssue: true, tier: 'ISSUE_WITH_FLAG' })
    expect(r.flags).toEqual(['AGENT_EDITED:auth_code'])
  })

  it('does not decline on a doubtful amount — it asks the agent first', () => {
    // OCR misread 3000 as 300 with low confidence on that line
    const lines = linesFromText(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE: 300.00 MZN'))
    lines.lines[11].confidence = 0.4
    const parsed = parseSlip(lines, SIMO_REDE_PROFILE)
    const doubtful = confirmSlip(parsed, SIMO_REDE_PROFILE, { at: AT })
    const r = run(doubtful)
    expect(r.tier).not.toBe('HARD_DECLINE')
    expect(r.needsConfirmation).toEqual(['amount', 'currency'])

    const corrected = confirmSlip(parsed, SIMO_REDE_PROFILE, { at: AT, edits: [{ field: 'amount', value: '3000.00' }], confirmed: ['currency'] })
    expect(run(corrected)).toMatchObject({ canIssue: true, flags: ['AGENT_EDITED:amount', 'LOW_CONFIDENCE:currency'] })
  })

  it('still declines on a confident hard failure while other fields await confirmation', () => {
    const lines = linesFromText(withLine(SLIP_1, 'APROVADA', 'RECUSADA'))
    lines.lines[14].confidence = 0.3 // AUTH CODE line
    const r = run(confirmSlip(parseSlip(lines, SIMO_REDE_PROFILE), SIMO_REDE_PROFILE, { at: AT }))
    expect(r.tier).toBe('HARD_DECLINE')
    expect(r.needsConfirmation).toEqual(['auth_code'])
  })

  it('flags a full card number printed on the slip', () => {
    const r = run(confirm(withLine(SLIP_1, 'XXXXXXXXXXXX8622', '4111111111118622')))
    expect(r.flags).toEqual(['UNMASKED_PAN_SEEN'])
  })
})

describe('exposure cap', () => {
  const flagged = () => confirm(SLIP_1, { conf: 0.8 })

  it('blocks a flagged issue once the open count reaches the cap', () => {
    const r = run(flagged(), ctx({ exposure: { openCount: 5, openValueMinor: 0 } }))
    expect(r).toMatchObject({ tier: 'ISSUE_WITH_FLAG', canIssue: false, blockedReason: 'EXPOSURE_CAP' })
    expect(run(flagged(), ctx({ exposure: { openCount: 4, openValueMinor: 0 } })).canIssue).toBe(true)
  })

  it('blocks a flagged issue that would exceed the value cap', () => {
    const r = run(flagged(), ctx({ exposure: { openCount: 0, openValueMinor: 4_800_000 } }))
    expect(r.blockedReason).toBe('EXPOSURE_CAP')
  })

  it('never blocks an AUTO_PASS', () => {
    const r = run(undefined, ctx({ exposure: { openCount: 99, openValueMinor: 99_999_999 } }))
    expect(r).toMatchObject({ tier: 'AUTO_PASS', canIssue: true })
  })
})

describe('whitelist freshness', () => {
  it('flags a whitelist older than the configured limit', () => {
    const c = ctx()
    c.whitelist.updatedAt = '2026-10-09T13:00:00+02:00'
    expect(run(undefined, c).flags).toEqual(['WHITELIST_STALE'])
  })
})

describe('matchId', () => {
  const known = ['00236255', '00256885']
  it('exact / snapped / ambiguous / none', () => {
    expect(matchId('00236255', known, 1)).toEqual({ kind: 'exact', value: '00236255' })
    expect(matchId('00236265', known, 1)).toEqual({ kind: 'snapped', value: '00236255', distance: 1 })
    expect(matchId('0023625', known, 1)).toEqual({ kind: 'snapped', value: '00236255', distance: 1 })
    expect(matchId('00236265', known, 0)).toEqual({ kind: 'none' })
    expect(matchId('11111111', known, 1)).toEqual({ kind: 'none' })
    expect(matchId('0', ['1', '2'], 1)).toEqual({ kind: 'ambiguous', options: ['1', '2'], distance: 1 })
  })
})

describe('agent input normalisation', () => {
  it.each([
    ['amount', '3,000.00', '3000.00', true],
    ['amount', '3000', '3000.00', true],
    ['tid', '0023 6255', '00236255', true],
    ['tid', '002362', '002362', false],
    ['currency', 'mt', 'MZN', true],
    ['txn_at', '11/10/2026 13:39:54', '2026-10-11T13:39:54+02:00', true],
    ['txn_at', '31/02/2026 13:39:54', '2026-02-31T13:39:54+02:00', false],
    ['pan_last4', '8622', '8622', true],
  ] as const)('%s "%s"', (field, input, value, valid) => {
    expect(normalizeFieldInput(field, input, SIMO_REDE_PROFILE)).toEqual({ value, valid })
  })

  it('treats re-typing the OCR value as a confirmation, not an edit', () => {
    const s = confirm(SLIP_1, { edits: [{ field: 'rrn', value: '628451143467' }] })
    expect(s.edits).toEqual([])
    expect(s.confirmed).toEqual(['rrn'])
  })
})

describe('insurer settings', () => {
  it('fills missing keys with defaults and rejects contradictions', () => {
    expect(parseInsurerSettings({ slip_time_window_min: 15 }).slip_time_window_min).toBe(15)
    expect(parseInsurerSettings(null).exposure_cap_count).toBe(5)
    expect(() => parseInsurerSettings({ ocr_conf_min: 0.95, ocr_conf_auto: 0.9 })).toThrow()
  })

  it('matches the defaults stored by the database migration', () => {
    const dir = join(__dirname, '../../../supabase/migrations')
    // the latest migration that sets insurers.settings' default wins
    const sql = readdirSync(dir).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    const all = [...sql.matchAll(/settings (?:jsonb not null |set )default '([\s\S]*?)'::jsonb/g)]
    const dbDefaults = JSON.parse(all.at(-1)![1])
    for (const [k, value] of Object.entries(dbDefaults)) {
      expect(DEFAULT_INSURER_SETTINGS[k as keyof InsurerSettings], k).toEqual(value)
    }
  })
})
