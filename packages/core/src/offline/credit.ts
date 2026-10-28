import { PRICE_CURRENCY, toMinor, type Minor } from '../money'

/**
 * Offline credit. While online, part of the wallet is moved into a reserve
 * (public.lease_offline_credit). Offline credit sales spend only that reserve, so
 * two devices of one agent can never spend the same money. On sync the server
 * posts the debits against the reserve and releases the rest. All in MZN.
 */
export interface LocalCreditLease {
  id: string
  reservedMinor: Minor
  /** consumed according to the server at the last sync */
  serverConsumedMinor: Minor
  /** spent on the device since then (not yet acknowledged by the server) */
  localConsumedMinor: Minor
}

export function availableCredit(leases: LocalCreditLease[]): Minor {
  return leases.reduce((n, l) => n + Math.max(0, l.reservedMinor - l.serverConsumedMinor - l.localConsumedMinor), 0)
}

/** Spend from the reserve; the whole amount must fit in a single lease. */
export function spendCredit(
  leases: LocalCreditLease[], amount: Minor
): { leaseId: string; leases: LocalCreditLease[] } | null {
  if (amount <= 0) return null
  const lease = leases.find((l) =>
    l.reservedMinor - l.serverConsumedMinor - l.localConsumedMinor >= amount)
  if (!lease) return null
  return {
    leaseId: lease.id,
    leases: leases.map((l) =>
      l.id === lease.id ? { ...l, localConsumedMinor: l.localConsumedMinor + amount } : l),
  }
}

/**
 * Merge server leases (snapshot) into local state. Local spending that the server
 * has not acknowledged yet is kept; acknowledged spending moves to serverConsumed.
 * pendingMinor = sum of unsynced outbox debits per lease id.
 */
export function mergeCreditLeases(
  server: { id: string; currency: string; reserved: number | string; consumed: number | string }[],
  pendingMinor: Record<string, Minor>
): LocalCreditLease[] {
  return server.filter((s) => s.currency === PRICE_CURRENCY).map((s) => ({
    id: s.id,
    reservedMinor: toMinor(s.reserved),
    serverConsumedMinor: toMinor(s.consumed),
    localConsumedMinor: pendingMinor[s.id] ?? 0,
  }))
}
