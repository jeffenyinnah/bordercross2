import { formatMinor, parseDecimal, type Currency } from '../money'
import {
  DIGIT_FIELDS, LABELED_FIELDS,
  type DigitField, type LabeledField, type SlipProfileConfig,
} from './profile'
import {
  containsPan, digitShare, hamming, keywordMatch, letterize, maskPan, normalizeLine, repairDigits,
  repairNumericTokens,
} from './text'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OcrLine {
  text: string
  /** 0..1 line confidence from the OCR engine, if it reports one */
  confidence?: number
}

export interface OcrResult {
  lines: OcrLine[]
}

export const SLIP_FIELDS = [
  'bank_brand', 'merchant_name', 'merchant_address', 'recibo_no', 'card_type', 'pan_last4',
  'aid', 'txn_type', 'amount', 'currency', 'approval_status', 'txn_date', 'txn_time', 'txn_at',
  'auth_code', 'rrn', 'rc', 'tid', 'batch', 'mid', 'verification', 'copy_type', 'copy_kind',
  'footer_code',
] as const
export type SlipFieldName = (typeof SLIP_FIELDS)[number]

/** Fields whose absence or invalidity is reported in `warnings` */
const WARN_FIELDS: SlipFieldName[] = [
  'recibo_no', 'card_type', 'pan_last4', 'txn_type', 'amount', 'currency', 'approval_status',
  'txn_at', 'auth_code', 'rrn', 'rc', 'tid', 'batch', 'mid', 'copy_type',
]

export type FieldSource = 'label' | 'label-adjacent' | 'pattern' | 'none'

export interface ParsedField {
  /** Normalised value (digits only for numeric fields, "3000.00" for amount, ISO for txn_at) */
  value: string | null
  /** Text the value was read from (never contains a full card number) */
  raw: string | null
  /** 0..1 — OCR line confidence x label match x repair penalty x format validity */
  confidence: number
  /** Value passes its format check (digit length, date validity, ...) */
  valid: boolean
  /** OCR look-alike characters were corrected (O->0, B->8, ...) */
  repaired: boolean
  source: FieldSource
  /** Index of the OCR line the value came from */
  line: number | null
}

export interface ParsedSlip {
  profileName: string
  profileVersion: number
  fields: Record<SlipFieldName, ParsedField>
  warnings: string[]
  /** OCR text with any full card number masked — the only raw text that should be stored */
  maskedText: string
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Line {
  index: number
  raw: string
  norm: string
  conf: number
}

interface Token {
  text: string
  start: number
  end: number
}

const REPAIR_PENALTY = 0.85
const ADJACENT_PENALTY = 0.9
const INVALID_FACTOR = 0.4

const empty = (): ParsedField => ({
  value: null, raw: null, confidence: 0, valid: false, repaired: false, source: 'none', line: null,
})

function tokenize(s: string): Token[] {
  const out: Token[] = []
  for (const m of s.matchAll(/[^\s:]+/g)) {
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length })
  }
  return out
}

/** Strip punctuation that OCR glues onto words ("#712", "CODE.", "MZN,"). */
function bare(tok: string): string {
  return tok.replace(/^[#.,;=*_\-]+|[#.,;=*_\-]+$/g, '')
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

interface LabelHit {
  field: LabeledField
  /** token index where the label starts */
  at: number
  /** tokens consumed by the label */
  width: number
  quality: number
  /** remainder when the value is glued to the label ("TID00236255") */
  glued: string | null
}

/** All profile labels, longest first so "AUTH CODE" wins over "AUTH". */
function labelList(profile: SlipProfileConfig): { field: LabeledField; words: string[] }[] {
  const list: { field: LabeledField; words: string[] }[] = []
  for (const field of LABELED_FIELDS) {
    for (const label of profile.labels[field]) {
      list.push({ field, words: normalizeLine(label).split(' ') })
    }
  }
  return list.sort((a, b) =>
    b.words.length - a.words.length || b.words.join(' ').length - a.words.join(' ').length)
}

function matchLabelAt(
  tokens: Token[], at: number, words: string[], field: LabeledField
): Omit<LabelHit, 'field' | 'at'> | null {
  let quality = 1
  for (let k = 0; k < words.length; k++) {
    const tok = tokens[at + k]
    if (!tok) return null
    const t = bare(tok.text)
    const isLast = k === words.length - 1
    const q = keywordMatch(t, words[k])
    if (q > 0) { quality = Math.min(quality, q); continue }
    // Value glued to the last label word: "TID00236255", "RRN628451143467"
    if (isLast && letterize(t).startsWith(words[k]) && t.length > words[k].length) {
      const rest = t.slice(words[k].length)
      const numeric = (DIGIT_FIELDS as readonly string[]).includes(field) || field === 'amount'
      if (numeric && digitShare(rest) >= 0.6 && /[0-9]/.test(rest)) {
        return { width: words.length, quality, glued: rest }
      }
    }
    return null
  }
  return { width: words.length, quality, glued: null }
}

function findLabels(line: Line, labels: ReturnType<typeof labelList>): LabelHit[] {
  const tokens = tokenize(line.norm)
  const hits: LabelHit[] = []
  const used = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue
    for (const { field, words } of labels) {
      const m = matchLabelAt(tokens, i, words, field)
      if (!m) continue
      hits.push({ field, at: i, ...m })
      for (let k = 0; k < m.width; k++) used.add(i + k)
      break
    }
  }
  return hits.sort((a, b) => a.at - b.at)
}

/** Tokens after the label up to the next label on the same line. */
function valueAfter(line: Line, hit: LabelHit, hits: LabelHit[]): string {
  const tokens = tokenize(line.norm)
  const next = hits.find((h) => h.at > hit.at)
  const parts = tokens.slice(hit.at + hit.width, next ? next.at : tokens.length).map((t) => t.text)
  if (hit.glued) parts.unshift(hit.glued)
  return parts.join(' ').replace(/^#\s*/, '').trim()
}

/** Text of a line that carries no label of its own (candidate for a value printed above/below). */
function unlabeledText(line: Line | undefined, labels: ReturnType<typeof labelList>): string | null {
  if (!line) return null
  return findLabels(line, labels).length === 0 ? line.norm : null
}

interface DigitRead {
  value: string
  repairs: number
  valid: boolean
}

function readDigits(text: string, rule: { min: number; max: number }): DigitRead | null {
  // Join digit-like tokens until the field is long enough ("6284 5114 3467")
  let value = ''
  let repairs = 0
  let invalid = 0
  for (const tok of text.split(' ')) {
    const t = bare(tok)
    if (!t) continue
    if (digitShare(t) < 0.6) break
    const r = repairDigits(t)
    value += r.digits
    repairs += r.repairs
    invalid += r.invalid
    if (value.length >= rule.min) break
  }
  if (!value) return null
  return {
    value,
    repairs,
    valid: invalid === 0 && value.length >= rule.min && value.length <= rule.max,
  }
}

interface AmountRead {
  value: string
  currency: Currency | null
  repairs: number
  valid: boolean
}

function readAmount(text: string, profile: SlipProfileConfig): AmountRead | null {
  let currency: Currency | null = null
  let repairsCurrency = 0
  const numericParts: string[] = []
  for (const tok of text.split(' ')) {
    const t = bare(tok)
    if (!t) continue
    const alias = profile.currencyAliases[t]
    if (alias) { currency = alias; continue }
    if (/^[A-Z$]{3}$/.test(t)) {
      // OCR-damaged ISO code ("MZM" -> MZN): one substitution away from a known code
      const near = Object.keys(profile.currencyAliases)
        .filter((k) => hamming(letterize(t), letterize(k)) <= 1)
      if (near.length === 1) { currency = profile.currencyAliases[near[0]]; repairsCurrency++; continue }
    }
    if (digitShare(t.replace(/[.,']/g, '')) >= 0.6 && /[0-9]/.test(t)) numericParts.push(t)
  }
  if (numericParts.length === 0) return null

  const joined = numericParts.join('')
  let repairs = 0
  const cleaned = joined.replace(/[^0-9.,]/g, (c) => {
    const r = repairDigits(c)
    if (r.digits) { repairs += r.repairs; return r.digits }
    return ''
  })
  const minor = parseDecimal(cleaned)
  if (minor === null) return null
  return {
    value: formatMinor(minor),
    currency,
    repairs: repairs + repairsCurrency,
    valid: currency !== null && minor > 0,
  }
}

function phraseMatch(lineNorm: string, phrases: string[]): { phrase: string; quality: number } | null {
  const cleaned = letterize(lineNorm.replace(/[^A-Z0-9 \-]/g, ' ').replace(/\s+/g, ' ').trim())
  let best: { phrase: string; quality: number } | null = null
  for (const phrase of phrases) {
    const p = normalizeLine(phrase)
    const q = cleaned === p ? 1 : keywordMatch(cleaned, p)
    if (q > 0 && (!best || q > best.quality)) best = { phrase: p, quality: q }
  }
  return best
}

function tokenKeyword(lineNorm: string, keywords: string[]): { keyword: string; quality: number } | null {
  const tokens = tokenize(lineNorm).map((t) => bare(t.text)).filter(Boolean)
  for (const kw of keywords) {
    const words = normalizeLine(kw).split(' ')
    for (let i = 0; i + words.length <= tokens.length; i++) {
      let q = 1
      for (let k = 0; k < words.length && q > 0; k++) q = Math.min(q, keywordMatch(tokens[i + k], words[k]))
      if (q > 0) return { keyword: kw, quality: q }
    }
  }
  return null
}

function datePattern(format: SlipProfileConfig['dateFormat']): { re: RegExp; ymd: (m: RegExpExecArray) => [string, string, string] } {
  switch (format) {
    case 'DD/MM/YYYY':
      return { re: /\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\b/, ymd: (m) => [m[3], m[2], m[1]] }
    case 'MM/DD/YYYY':
      return { re: /\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\b/, ymd: (m) => [m[3], m[1], m[2]] }
    case 'YYYY-MM-DD':
      return { re: /\b(\d{4})[/.\-](\d{2})[/.\-](\d{2})\b/, ymd: (m) => [m[1], m[2], m[3]] }
  }
}

function validDate(y: string, m: string, d: string): boolean {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return date.getUTCFullYear() === Number(y)
    && date.getUTCMonth() === Number(m) - 1
    && date.getUTCDate() === Number(d)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function linesFromText(text: string, confidence?: number): OcrResult {
  return { lines: text.split(/\r?\n/).map((t) => ({ text: t, confidence })) }
}

/** Score how well OCR text fits a profile (share of its keywords present). */
export function profileScore(ocr: OcrResult, profile: SlipProfileConfig): number {
  const lines = ocr.lines.map((l) => normalizeLine(l.text)).filter(Boolean)
  const found = profile.matchKeywords.filter((kw) =>
    lines.some((l) => tokenKeyword(l, [kw]) !== null))
  return found.length / profile.matchKeywords.length
}

/** Pick the best-fitting profile, or null when nothing fits well enough. */
export function selectProfile(
  ocr: OcrResult, profiles: SlipProfileConfig[], minScore = 0.5
): SlipProfileConfig | null {
  let best: { p: SlipProfileConfig; s: number } | null = null
  for (const p of profiles) {
    const s = profileScore(ocr, p)
    if (!best || s > best.s) best = { p, s }
  }
  return best && best.s >= minScore ? best.p : null
}

/**
 * Parse OCR output of a POS slip into structured fields with per-field confidence.
 * Pure and deterministic: no I/O, no clock, no OCR — so it runs identically on the
 * device (offline) and on the server during sync.
 */
export function parseSlip(ocr: OcrResult, profile: SlipProfileConfig): ParsedSlip {
  const lines: Line[] = ocr.lines
    .map((l, index) => ({
      index,
      raw: maskPan(l.text.trim()),
      norm: normalizeLine(maskPan(l.text)),
      conf: l.confidence ?? 1,
    }))
    .filter((l) => l.norm.length > 0)

  const fields = Object.fromEntries(SLIP_FIELDS.map((f) => [f, empty()])) as
    Record<SlipFieldName, ParsedField>
  const warnings: string[] = []
  const labels = labelList(profile)
  const hitsByLine = new Map(lines.map((l) => [l.index, findLabels(l, labels)]))

  // ---- Labeled fields ------------------------------------------------------
  for (const field of LABELED_FIELDS) {
    let best: ParsedField | null = null
    let currency: { value: Currency; line: Line; quality: number } | null = null

    for (let li = 0; li < lines.length && !best?.valid; li++) {
      const line = lines[li]
      const hits = hitsByLine.get(line.index)!
      const hit = hits.find((h) => h.field === field)
      if (!hit) continue

      const sameLine = valueAfter(line, hit, hits)
      const candidates: { text: string; src: Line; adjacent: boolean }[] = []
      if (sameLine) candidates.push({ text: sameLine, src: line, adjacent: false })
      for (const adj of [lines[li + 1], lines[li - 1]]) {
        const t = unlabeledText(adj, labels)
        if (t && adj) candidates.push({ text: t, src: adj, adjacent: true })
      }

      for (const c of candidates) {
        let read: { value: string; repairs: number; valid: boolean } | null
        if (field === 'amount') {
          const a = readAmount(c.text, profile)
          read = a
          if (a?.currency) currency = { value: a.currency, line: c.src, quality: hit.quality }
        } else if ((DIGIT_FIELDS as readonly string[]).includes(field)) {
          read = readDigits(c.text, profile.digitFields[field as DigitField])
        } else {
          // free-text labelled value (VERIFICACAO: PIN OK) — only from its own line
          read = c.adjacent ? null : { value: c.text, repairs: 0, valid: c.text.length > 0 }
        }
        if (!read) continue

        const conf = c.src.conf
          * hit.quality
          * (c.adjacent ? ADJACENT_PENALTY : 1)
          * Math.pow(REPAIR_PENALTY, read.repairs)
          * (read.valid ? 1 : INVALID_FACTOR)
        const parsed: ParsedField = {
          value: read.value,
          raw: c.text,
          confidence: round(conf),
          valid: read.valid,
          repaired: read.repairs > 0,
          source: c.adjacent ? 'label-adjacent' : 'label',
          line: c.src.index,
        }
        if (!best || (parsed.valid && !best.valid) || (parsed.valid === best.valid && parsed.confidence > best.confidence)) {
          best = parsed
        }
        if (parsed.valid) break
      }
    }

    if (best) fields[field] = best
    if (field === 'amount' && currency) {
      fields.currency = {
        value: currency.value,
        raw: currency.line.norm,
        confidence: round(currency.line.conf * currency.quality),
        valid: true,
        repaired: false,
        source: 'label',
        line: currency.line.index,
      }
    }
  }

  const reciboLine = fields.recibo_no.line
  const headerEnd = reciboLine ?? -1
  const bodyLines = reciboLine === null ? lines : lines.filter((l) => l.index > reciboLine)

  // ---- Transaction type / approval status / copy (whole-line keywords) -----
  const wholeLine = (
    target: 'txn_type' | 'approval_status', keywords: string[]
  ) => {
    for (const line of bodyLines) {
      if (hitsByLine.get(line.index)!.length) continue
      const m = phraseMatch(line.norm, keywords) ?? tokenKeyword(line.norm, keywords)
      if (!m) continue
      const value = 'phrase' in m ? m.phrase : normalizeLine(m.keyword)
      fields[target] = {
        value, raw: line.norm, confidence: round(line.conf * m.quality), valid: true,
        repaired: m.quality < 1, source: 'pattern', line: line.index,
      }
      return
    }
  }
  wholeLine('txn_type', profile.txnTypes)
  wholeLine('approval_status', profile.approvalStatuses)

  for (const line of bodyLines) {
    const m = phraseMatch(line.norm, Object.keys(profile.copyTypes))
    if (!m) continue
    const kind = Object.entries(profile.copyTypes).find(([k]) => normalizeLine(k) === m.phrase)![1]
    const base = { raw: line.norm, valid: true, repaired: m.quality < 1, source: 'pattern' as const, line: line.index }
    fields.copy_type = { ...base, value: m.phrase, confidence: round(line.conf * m.quality) }
    fields.copy_kind = { ...base, value: kind, confidence: round(line.conf * m.quality) }
    break
  }

  // ---- Card type, masked PAN, AID ------------------------------------------
  for (const line of bodyLines) {
    if (fields.card_type.value === null) {
      const m = tokenKeyword(line.norm, profile.cardBrands)
      if (m && hitsByLine.get(line.index)!.length === 0) {
        fields.card_type = {
          value: line.norm.replace(/[^A-Z0-9 ]/g, '').trim(), raw: line.norm,
          confidence: round(line.conf * m.quality), valid: true, repaired: false,
          source: 'pattern', line: line.index,
        }
      }
    }
    if (fields.pan_last4.value === null) {
      const masked = /[X*#]{4,}[\s\-]*([0-9OQDILZSGB|]{4})(?![0-9A-Z])/.exec(line.norm)
      if (masked) {
        const r = repairDigits(masked[1])
        fields.pan_last4 = {
          value: r.digits, raw: masked[0], valid: r.digits.length === 4 && r.invalid === 0,
          confidence: round(line.conf * Math.pow(REPAIR_PENALTY, r.repairs)),
          repaired: r.repairs > 0, source: 'pattern', line: line.index,
        }
      }
    }
    if (fields.aid.value === null) {
      const tok = tokenize(line.norm).map((t) => bare(t.text)).find((t) => /^A[0-9A-FO]{9,15}$/.test(t))
      if (tok) {
        const value = 'A' + tok.slice(1).replace(/O/g, '0')
        fields.aid = {
          value, raw: tok, confidence: round(line.conf * (value === tok ? 1 : REPAIR_PENALTY)),
          valid: /^A[0-9A-F]{9,15}$/.test(value), repaired: value !== tok, source: 'pattern',
          line: line.index,
        }
      }
    }
  }
  // A full card number was printed or OCR'd: it was masked above; flag it for review
  if (ocr.lines.some((l) => containsPan(l.text))) warnings.push('UNMASKED_PAN_SEEN')

  // ---- Date and time --------------------------------------------------------
  const dp = datePattern(profile.dateFormat)
  for (const line of lines) {
    const fixed = repairNumericTokens(line.norm)
    const repaired = fixed !== line.norm
    if (fields.txn_time.value === null) {
      const t = /\b(\d{2}):(\d{2}):(\d{2})\b/.exec(fixed)
      if (t) {
        const valid = Number(t[1]) < 24 && Number(t[2]) < 60 && Number(t[3]) < 60
        fields.txn_time = {
          value: `${t[1]}:${t[2]}:${t[3]}`, raw: t[0], valid, repaired, source: 'pattern',
          line: line.index,
          confidence: round(line.conf * (repaired ? REPAIR_PENALTY : 1) * (valid ? 1 : INVALID_FACTOR)),
        }
      }
    }
    if (fields.txn_date.value === null) {
      const d = dp.re.exec(fixed)
      if (d) {
        const [y, m, day] = dp.ymd(d)
        const valid = validDate(y, m, day)
        fields.txn_date = {
          value: `${y}-${m}-${day}`, raw: d[0], valid, repaired, source: 'pattern',
          line: line.index,
          confidence: round(line.conf * (repaired ? REPAIR_PENALTY : 1) * (valid ? 1 : INVALID_FACTOR)),
        }
      }
    }
  }
  if (fields.txn_date.value && fields.txn_time.value) {
    const valid = fields.txn_date.valid && fields.txn_time.valid
    fields.txn_at = {
      value: `${fields.txn_date.value}T${fields.txn_time.value}${profile.utcOffset}`,
      raw: `${fields.txn_date.raw} ${fields.txn_time.raw}`,
      confidence: Math.min(fields.txn_date.confidence, fields.txn_time.confidence),
      valid,
      repaired: fields.txn_date.repaired || fields.txn_time.repaired,
      source: 'pattern',
      line: fields.txn_date.line,
    }
  }

  // ---- Footer code (stored, never validated) --------------------------------
  // Searched bottom-up on lines without labels, so "RRN628451143467" is never taken.
  const footerRe = new RegExp(profile.footerPattern)
  for (const line of [...lines].reverse()) {
    if (hitsByLine.get(line.index)!.length) continue
    const compact = line.norm.replace(/\s/g, '')
    let value: string | null = footerRe.test(compact) ? compact : null
    // Repair look-alikes only if the code clearly starts with letters ("TAUNI268...")
    if (!value && compact.length >= 11 && /^[A-Z]{2}/.test(compact)) {
      for (const n of [4, 3, 5]) {
        const tail = repairDigits(compact.slice(n))
        const candidate = letterize(compact.slice(0, n)) + tail.digits
        if (tail.invalid === 0 && footerRe.test(candidate)) { value = candidate; break }
      }
    }
    if (value) {
      fields.footer_code = {
        value, raw: line.norm, confidence: round(line.conf * (value === compact ? 1 : REPAIR_PENALTY)),
        valid: true, repaired: value !== compact, source: 'pattern', line: line.index,
      }
      break
    }
  }

  // ---- Header: bank brand + merchant name/address ---------------------------
  const header = lines.filter((l) => l.index < headerEnd)
  const brandKeys = Object.keys(profile.bankBrands)
  const isMarker = (l: Line) => tokenKeyword(l.norm, profile.networkMarkers) !== null
  for (const line of header) {
    const m = tokenKeyword(line.norm, brandKeys)
    if (m) {
      fields.bank_brand = {
        value: profile.bankBrands[m.keyword], raw: line.norm, confidence: round(line.conf * m.quality),
        valid: true, repaired: m.quality < 1, source: 'pattern', line: line.index,
      }
      break
    }
  }
  const merchantLines = header.filter((l) =>
    !isMarker(l)
    && tokenKeyword(l.norm, brandKeys) === null
    && (l.norm.match(/[A-Z]/g) ?? []).length >= 3)
  if (merchantLines.length) {
    const [first, ...rest] = merchantLines
    fields.merchant_name = {
      value: first.raw, raw: first.raw, confidence: round(first.conf), valid: true,
      repaired: false, source: 'pattern', line: first.index,
    }
    if (rest.length) {
      fields.merchant_address = {
        value: rest.map((l) => l.raw).join(', '), raw: rest.map((l) => l.raw).join('\n'),
        confidence: round(Math.min(...rest.map((l) => l.conf))), valid: true, repaired: false,
        source: 'pattern', line: rest[0].index,
      }
    }
  }

  // ---- Warnings --------------------------------------------------------------
  for (const f of WARN_FIELDS) {
    if (fields[f].value === null) warnings.push(`MISSING:${f}`)
    else if (!fields[f].valid) warnings.push(`INVALID:${f}`)
  }

  return {
    profileName: profile.name,
    profileVersion: profile.version,
    fields,
    warnings,
    maskedText: lines.map((l) => l.raw).join('\n'),
  }
}
