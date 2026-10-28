/** Uppercase, strip accents (VERIFICAÇÃO -> VERIFICACAO), collapse whitespace. */
export function normalizeLine(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Digits OCR'd in place of letters, used when matching labels/keywords.
// Char-for-char so indices stay aligned with the source string.
const TO_LETTER: Record<string, string> = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '6': 'G', '8': 'B', '|': 'I', '!': 'I',
}

export function letterize(s: string): string {
  return s.replace(/[012568|!]/g, (c) => TO_LETTER[c])
}

// Letters OCR'd in place of digits (O/0, I/l/1, B/8, S/5, Z/2, G/6). Applied to numeric fields only.
const TO_DIGIT: Record<string, string> = {
  O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', Z: '2', S: '5', G: '6', B: '8',
}

export interface DigitRepair {
  digits: string
  repairs: number
  /** characters that are neither digits nor known confusions */
  invalid: number
}

export function repairDigits(raw: string): DigitRepair {
  let digits = ''
  let repairs = 0
  let invalid = 0
  for (const c of raw.toUpperCase()) {
    if (c >= '0' && c <= '9') digits += c
    else if (TO_DIGIT[c]) { digits += TO_DIGIT[c]; repairs++ }
    else if (c === ' ' || c === '-') continue
    else invalid++
  }
  return { digits, repairs, invalid }
}

/** Share of characters that are digits or digit look-alikes. */
export function digitShare(s: string): number {
  const chars = s.replace(/\s/g, '')
  if (!chars) return 0
  let n = 0
  for (const c of chars.toUpperCase()) if ((c >= '0' && c <= '9') || TO_DIGIT[c]) n++
  return n / chars.length
}

/** Repair confusions inside tokens that are mostly numeric (dates, times, amounts). */
export function repairNumericTokens(line: string): string {
  return line.replace(/[^\s]+/g, (tok) => {
    const real = (tok.match(/[0-9]/g) ?? []).length
    if (real === 0 || digitShare(tok.replace(/[:/.,\-]/g, '')) < 0.6) return tok
    return tok.replace(/[OQDILZSGB|!]/g, (c) => TO_DIGIT[c] ?? c)
  })
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Tolerant keyword equality: exact for short words (TID, MID, RC would collide),
 * one edit for 4-9 chars, two edits for longer phrases.
 * Returns 1 for exact, 0.9 for fuzzy, 0 for no match.
 */
export function keywordMatch(candidate: string, keyword: string): number {
  const a = letterize(candidate)
  const b = letterize(keyword)
  if (a === b) return 1
  const allowed = b.length >= 10 ? 2 : b.length >= 4 ? 1 : 0
  if (allowed === 0) return 0
  return levenshtein(a, b) <= allowed ? 0.9 : 0
}

/** Number of positions at which two equal-length strings differ (Infinity if lengths differ). */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

/**
 * Mask any 16-19 digit card number to its last four digits, including numbers
 * printed in groups ("4111 1111 1111 1111"). MIDs (15) and RRNs (12) are kept.
 */
export function maskPan(text: string): string {
  return text.replace(/\d(?:[ \-]?\d){15,18}(?!\d)/g, (m) => {
    const digits = m.replace(/[ \-]/g, '')
    return 'X'.repeat(digits.length - 4) + digits.slice(-4)
  })
}

/** True when the text contains an unmasked 16-19 digit card number. */
export function containsPan(text: string): boolean {
  return /\d(?:[ \-]?\d){15,18}(?!\d)/.test(text)
}
