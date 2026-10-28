/**
 * Offline policy numbering. While online the device leases blocks of the
 * BORDER-YYYY counter (public.lease_policy_numbers); offline it hands out the
 * next unused number of a block. Server numbering continues after the block,
 * so numbers never collide. Unused numbers become documented gaps.
 */

/** A leased block as kept on the device. next_seq is the next number to hand out. */
export interface LocalNumberLease {
  id: string
  border_code: string
  year: number
  start_seq: number
  end_seq: number
  next_seq: number
}

/** Same format as public.generate_policy_number: RGAR-2026-000101 */
export function formatPolicyNumber(borderCode: string, year: number, seq: number): string {
  return `${borderCode.toUpperCase()}-${year}-${String(seq).padStart(6, '0')}`
}

export function remainingNumbers(leases: LocalNumberLease[], borderCode: string, year: number): number {
  return leases
    .filter((l) => l.border_code === borderCode.toUpperCase() && l.year === year)
    .reduce((n, l) => n + Math.max(0, l.end_seq - l.next_seq + 1), 0)
}

/**
 * Take the next number for a border post, oldest block first.
 * Returns the updated leases (input is not mutated), or null when no number is left.
 */
export function takePolicyNumber(
  leases: LocalNumberLease[], borderCode: string, year: number
): { number: string; leaseId: string; seq: number; leases: LocalNumberLease[] } | null {
  const code = borderCode.toUpperCase()
  const lease = leases
    .filter((l) => l.border_code === code && l.year === year && l.next_seq <= l.end_seq)
    .sort((a, b) => a.start_seq - b.start_seq)[0]
  if (!lease) return null
  const seq = lease.next_seq
  return {
    number: formatPolicyNumber(code, year, seq),
    leaseId: lease.id,
    seq,
    leases: leases.map((l) => (l.id === lease.id ? { ...l, next_seq: seq + 1 } : l)),
  }
}

/** Refill while online when fewer than this share of a block is left. */
export function needsNumberRefill(
  leases: LocalNumberLease[], borderCode: string, year: number, blockSize: number
): boolean {
  return remainingNumbers(leases, borderCode, year) < Math.max(1, Math.ceil(blockSize / 2))
}

/** Server lease row (from the snapshot or lease_policy_numbers) -> local lease. */
export function toLocalNumberLease(
  row: { id: string; border_code: string; year: number; start_seq: number; end_seq: number },
  existing?: LocalNumberLease
): LocalNumberLease {
  return {
    id: row.id,
    border_code: row.border_code,
    year: row.year,
    start_seq: row.start_seq,
    end_seq: row.end_seq,
    // the device is the only one handing out numbers from its lease
    next_seq: existing ? Math.max(existing.next_seq, row.start_seq) : row.start_seq,
  }
}
