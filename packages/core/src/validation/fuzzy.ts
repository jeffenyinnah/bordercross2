import { hamming, levenshtein } from '../slip/text'

export type IdMatch =
  | { kind: 'exact'; value: string }
  | { kind: 'snapped'; value: string; distance: number }
  | { kind: 'ambiguous'; options: string[]; distance: number }
  | { kind: 'none' }

/**
 * Match an OCR'd identifier (TID/MID) against the whitelist. A read within
 * `maxDistance` edits of exactly one known value snaps to it (and is flagged for
 * the agent to confirm); several equally close values are ambiguous.
 */
export function matchId(read: string, known: string[], maxDistance: number): IdMatch {
  if (known.includes(read)) return { kind: 'exact', value: read }
  if (maxDistance <= 0) return { kind: 'none' }

  let best = Infinity
  let options: string[] = []
  for (const k of new Set(known)) {
    // Same length: substitutions only (the usual OCR error). Otherwise allow insert/delete.
    const d = k.length === read.length ? hamming(read, k) : levenshtein(read, k)
    if (d > maxDistance) continue
    if (d < best) { best = d; options = [k] }
    else if (d === best) options.push(k)
  }
  if (options.length === 0) return { kind: 'none' }
  if (options.length > 1) return { kind: 'ambiguous', options: options.sort(), distance: best }
  return { kind: 'snapped', value: options[0], distance: best }
}
