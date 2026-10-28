import { z } from 'zod'
import { formatMinor } from '../money'
import { policyDetailsSchema, type PolicyDetailsInput } from '../policy'
import { calculateEndDate, computePremium, type PricedVehicleType } from '../pricing'
import { spendCredit, type LocalCreditLease } from './credit'
import { takePolicyNumber, type LocalNumberLease } from './numbering'

export const PAYMENT_METHODS = ['VIRTUAL_CREDIT', 'POS_CARD_SLIP'] as const
export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number]

/**
 * A policy issued on the device, as queued in the outbox and pushed to the
 * server. client_uuid is the idempotency key; the server re-prices it from
 * price_snapshot.version and re-checks the number and credit leases.
 */
export const offlinePolicyRecordSchema = policyDetailsSchema.extend({
  client_uuid: z.uuid(),
  device_id: z.uuid(),
  agent_id: z.uuid(),
  insurer_id: z.uuid(),
  policy_number: z.string().regex(/^[A-Z0-9]+-\d{4}-\d{6}$/),
  number_lease_id: z.uuid(),
  payment_method: z.enum(PAYMENT_METHODS),
  credit_lease_id: z.uuid().nullable(),
  premium_amount: z.string().regex(/^\d+\.\d{2}$/),
  end_date: z.iso.date(),
  border: z.string().min(1),
  border_code: z.string().min(1),
  verification_token: z.string().regex(/^[0-9a-f]{32}$/),
  device_issued_at: z.iso.datetime({ offset: true }),
  price_snapshot: z.object({
    version: z.string(),
    lines: z.array(z.object({ id: z.string(), name: z.string(), price: z.number() })),
    coverage_note: z.string().nullable(),
  }),
})

export type OfflinePolicyRecord = z.infer<typeof offlinePolicyRecordSchema>

export interface OfflineIssueState {
  vehicleTypes: PricedVehicleType[]
  /** identifies the price list the premium came from (snapshot pulled_at) */
  priceVersion: string
  numberLeases: LocalNumberLease[]
  creditLeases: LocalCreditLease[]
  allowedMethods: string[]
}

export interface OfflineIssueContext {
  clientUuid: string
  deviceId: string
  agentId: string
  insurerId: string
  border: { code: string; name: string }
  paymentMethod: PaymentMethodCode
  verificationToken: string
  /** device time, already corrected by the server clock offset */
  now: Date
}

export type OfflineIssueResult =
  | { ok: true; record: OfflinePolicyRecord; numberLeases: LocalNumberLease[]; creditLeases: LocalCreditLease[] }
  | { ok: false; error: string }

/** 32 lowercase hex characters, the format public.verify_policy accepts. */
export function generateVerificationToken(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Issue a policy without the network. Pure: returns the record for the outbox
 * and the new lease state; nothing changes unless the caller saves both.
 * A POS_CARD_SLIP sale does not touch credit; its payment record is attached by
 * the slip flow.
 */
export function issueOfflinePolicy(
  input: PolicyDetailsInput, state: OfflineIssueState, ctx: OfflineIssueContext
): OfflineIssueResult {
  const parsed = policyDetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const details = parsed.data

  if (!state.allowedMethods.includes(ctx.paymentMethod)) {
    return { ok: false, error: 'This payment method is not enabled for your insurer' }
  }

  const premium = computePremium({
    vehicleTypes: state.vehicleTypes,
    selectedIds: details.vehicle_type_ids,
    policyType: details.policy_type,
    insurerId: ctx.insurerId,
  })
  if (!premium.ok) return { ok: false, error: premium.error }

  const year = ctx.now.getUTCFullYear()
  const number = takePolicyNumber(state.numberLeases, ctx.border.code, year)
  if (!number) {
    return {
      ok: false,
      error: `No offline policy numbers left for ${ctx.border.code}. Connect to the internet to get more.`,
    }
  }

  let creditLeases = state.creditLeases
  let creditLeaseId: string | null = null
  if (ctx.paymentMethod === 'VIRTUAL_CREDIT') {
    const spent = spendCredit(state.creditLeases, premium.premiumMinor)
    if (!spent) {
      return {
        ok: false,
        error: `Not enough offline credit for ${formatMinor(premium.premiumMinor)} MZN. Connect to the internet to sell on your full balance.`,
      }
    }
    creditLeases = spent.leases
    creditLeaseId = spent.leaseId
  }

  const notes = [details.notes, premium.coverageNote].filter(Boolean).join(' | ') || undefined

  const record: OfflinePolicyRecord = {
    ...details,
    notes,
    border: ctx.border.name,
    border_code: ctx.border.code.toUpperCase(),
    client_uuid: ctx.clientUuid,
    device_id: ctx.deviceId,
    agent_id: ctx.agentId,
    insurer_id: ctx.insurerId,
    policy_number: number.number,
    number_lease_id: number.leaseId,
    payment_method: ctx.paymentMethod,
    credit_lease_id: creditLeaseId,
    premium_amount: formatMinor(premium.premiumMinor),
    end_date: calculateEndDate(details.start_date, details.policy_type),
    verification_token: ctx.verificationToken,
    device_issued_at: ctx.now.toISOString(),
    price_snapshot: { version: state.priceVersion, lines: premium.lines, coverage_note: premium.coverageNote },
  }

  return { ok: true, record, numberLeases: number.leases, creditLeases }
}
