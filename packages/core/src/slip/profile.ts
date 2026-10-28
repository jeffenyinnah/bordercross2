import { z } from 'zod'
import { CURRENCIES } from '../money'
import simoRede from './profiles/simo-rede.json'

/** Fields located by a printed label (value follows the label, same line or adjacent line). */
export const LABELED_FIELDS = [
  'recibo_no', 'amount', 'auth_code', 'rrn', 'rc', 'tid', 'batch', 'mid', 'verification',
] as const
export type LabeledField = (typeof LABELED_FIELDS)[number]

export const DIGIT_FIELDS = ['recibo_no', 'auth_code', 'rrn', 'rc', 'tid', 'batch', 'mid'] as const
export type DigitField = (typeof DIGIT_FIELDS)[number]

const digitRule = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1),
}).refine((r) => r.max >= r.min, 'max must be >= min')

/**
 * A slip layout described as data, so a new bank/network is added by inserting a
 * row into slip_profiles rather than changing code.
 */
export const slipProfileConfigSchema = z.object({
  name: z.string().min(1),
  network: z.string().min(1),
  version: z.number().int().min(1),
  matchKeywords: z.array(z.string().min(1)).min(1),
  networkMarkers: z.array(z.string()).default([]),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/),
  labels: z.object(
    Object.fromEntries(LABELED_FIELDS.map((f) => [f, z.array(z.string().min(1)).min(1)])) as
      Record<LabeledField, z.ZodArray<z.ZodString>>
  ),
  digitFields: z.object(
    Object.fromEntries(DIGIT_FIELDS.map((f) => [f, digitRule])) as Record<DigitField, typeof digitRule>
  ),
  txnTypes: z.array(z.string().min(1)).min(1),
  approvalStatuses: z.array(z.string().min(1)).min(1),
  copyTypes: z.record(z.string(), z.enum(['CUSTOMER', 'MERCHANT'])),
  cardBrands: z.array(z.string().min(1)),
  bankBrands: z.record(z.string(), z.string()),
  currencyAliases: z.record(z.string(), z.enum(CURRENCIES)),
  footerPattern: z.string().min(1),
})

export type SlipProfileConfig = z.infer<typeof slipProfileConfigSchema>

export function parseSlipProfile(config: unknown): SlipProfileConfig {
  return slipProfileConfigSchema.parse(config)
}

export const SIMO_REDE_PROFILE: SlipProfileConfig = parseSlipProfile(simoRede)
