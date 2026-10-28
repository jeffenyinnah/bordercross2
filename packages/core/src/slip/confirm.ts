import { CURRENCIES, formatMinor, parseDecimal } from '../money'
import { DIGIT_FIELDS, type DigitField, type SlipProfileConfig } from './profile'
import { SLIP_FIELDS, type ParsedSlip, type SlipFieldName } from './parser'
import { normalizeLine, repairDigits } from './text'

/** A correction the agent typed on the confirmation screen. */
export interface FieldEdit {
  field: SlipFieldName
  value: string | null
}

/** Audit record stored in policy_payments.edits */
export interface EditRecord {
  field: SlipFieldName
  ocr_value: string | null
  edited_value: string | null
  at: string
}

/** Slip values after the agent reviewed them — the input to validation. */
export interface ConfirmedSlip {
  values: Record<SlipFieldName, string | null>
  valid: Record<SlipFieldName, boolean>
  /** OCR confidence; fields the agent edited or confirmed keep their original score */
  confidence: Record<SlipFieldName, number>
  edits: EditRecord[]
  /** Fields the agent explicitly reviewed and accepted unchanged */
  confirmed: SlipFieldName[]
  /** parser warnings (e.g. UNMASKED_PAN_SEEN) */
  warnings: string[]
}

/**
 * Normalise what an agent typed into the canonical form the parser produces
 * ("3,000.00" -> "3000.00", "0023 6255" -> "00236255", "11/10/2026 13:39:54" -> ISO).
 */
export function normalizeFieldInput(
  field: SlipFieldName, input: string | null, profile: SlipProfileConfig
): { value: string | null; valid: boolean } {
  const text = input?.trim() ?? ''
  if (!text) return { value: null, valid: false }

  if ((DIGIT_FIELDS as readonly string[]).includes(field)) {
    const r = repairDigits(text)
    const rule = profile.digitFields[field as DigitField]
    return {
      value: r.digits || null,
      valid: r.invalid === 0 && r.digits.length >= rule.min && r.digits.length <= rule.max,
    }
  }

  switch (field) {
    case 'amount': {
      const minor = parseDecimal(text)
      return minor === null ? { value: null, valid: false } : { value: formatMinor(minor), valid: minor > 0 }
    }
    case 'currency': {
      const c = normalizeLine(text)
      const value = profile.currencyAliases[c] ?? c
      return { value, valid: (CURRENCIES as readonly string[]).includes(value) }
    }
    case 'pan_last4': {
      const d = repairDigits(text).digits.slice(-4)
      return { value: d || null, valid: /^\d{4}$/.test(d) }
    }
    case 'txn_at':
      return normalizeDateTime(text, profile)
    case 'txn_type':
    case 'approval_status':
    case 'copy_type':
      return { value: normalizeLine(text), valid: true }
    default:
      return { value: text, valid: true }
  }
}

function normalizeDateTime(text: string, profile: SlipProfileConfig): { value: string | null; valid: boolean } {
  // Already ISO with offset (what the parser emits)
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)$/.exec(text)
  let y: string, mo: string, d: string, h: string, mi: string, s: string, offset = profile.utcOffset
  if (iso) {
    ;[, y, mo, d, h, mi, s] = iso
    offset = iso[7] === 'Z' ? '+00:00' : iso[7]
  } else {
    const time = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text)
    const date = profile.dateFormat === 'YYYY-MM-DD'
      ? /(\d{4})[/.\-](\d{2})[/.\-](\d{2})/.exec(text)
      : /(\d{2})[/.\-](\d{2})[/.\-](\d{4})/.exec(text)
    if (!time || !date) return { value: null, valid: false }
    ;[h, mi, s] = [time[1], time[2], time[3] ?? '00']
    if (profile.dateFormat === 'YYYY-MM-DD') [y, mo, d] = [date[1], date[2], date[3]]
    else if (profile.dateFormat === 'MM/DD/YYYY') [y, mo, d] = [date[3], date[1], date[2]]
    else [y, mo, d] = [date[3], date[2], date[1]]
  }
  const value = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`
  const dt = new Date(Date.UTC(+y, +mo - 1, +d))
  const valid = dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d
    && +h < 24 && +mi < 60 && +s < 60
  return { value, valid }
}

/**
 * Apply the agent's corrections to parsed OCR output. Every changed value is
 * recorded with its original OCR value for the audit trail; re-typing the same
 * value counts as a confirmation, not an edit.
 */
export function confirmSlip(
  parsed: ParsedSlip,
  profile: SlipProfileConfig,
  input: { edits?: FieldEdit[]; confirmed?: SlipFieldName[]; at: string }
): ConfirmedSlip {
  const values = {} as Record<SlipFieldName, string | null>
  const valid = {} as Record<SlipFieldName, boolean>
  const confidence = {} as Record<SlipFieldName, number>
  for (const f of SLIP_FIELDS) {
    values[f] = parsed.fields[f].value
    valid[f] = parsed.fields[f].valid
    confidence[f] = parsed.fields[f].confidence
  }

  const edits: EditRecord[] = []
  const confirmed = new Set(input.confirmed ?? [])
  for (const e of input.edits ?? []) {
    const n = normalizeFieldInput(e.field, e.value, profile)
    if (n.value === values[e.field]) {
      confirmed.add(e.field)
      valid[e.field] = n.valid
      continue
    }
    edits.push({ field: e.field, ocr_value: values[e.field], edited_value: n.value, at: input.at })
    values[e.field] = n.value
    valid[e.field] = n.valid
    confirmed.delete(e.field)
  }

  return { values, valid, confidence, edits, confirmed: [...confirmed], warnings: parsed.warnings }
}
