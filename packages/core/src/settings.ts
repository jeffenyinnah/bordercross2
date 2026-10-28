import { z } from 'zod'

/** An MZN amount. Settings saved before the MZN-only change stored {MZN, ZAR, USD}. */
const mzn = (fallback: number) => z.preprocess(
  (v) => (v && typeof v === 'object' && 'MZN' in v ? (v as { MZN: unknown }).MZN : v),
  z.number().min(0),
).default(fallback)

/**
 * Per-insurer thresholds (insurers.settings in the DB). Keys missing from the
 * stored JSON fall back to these defaults, so new settings never need a data migration.
 */
export const insurerSettingsSchema = z.object({
  // --- slip validation ---
  /** max minutes between slip date/time and policy creation */
  slip_time_window_min: z.number().positive().default(10),
  /** tolerated clock difference before a slip counts as "in the future" */
  clock_skew_tolerance_sec: z.number().min(0).default(120),
  /** device clock vs server clock difference that raises a CLOCK_DRIFT flag */
  clock_drift_tolerance_sec: z.number().min(0).default(120),
  /** every required field at/above this confidence (and unedited) => AUTO_PASS possible */
  ocr_conf_auto: z.number().min(0).max(1).default(0.9),
  /** below this the agent must confirm or correct the field before validation can finish */
  ocr_conf_min: z.number().min(0).max(1).default(0.6),
  /** wording the slip must carry (e.g. merchant copy). Empty = check not configured yet */
  expected_copy_wording: z.array(z.string()).default([]),
  copy_wording_severity: z.enum(['FLAG', 'HARD']).default('FLAG'),
  accepted_txn_types: z.array(z.string()).min(1).default(['COMPRA']),
  approved_statuses: z.array(z.string()).min(1).default(['APROVADA', 'APROVADO']),
  success_response_codes: z.array(z.string()).min(1).default(['000', '00']),
  /** one-character OCR errors in TID/MID snap to the nearest whitelisted value */
  fuzzy_max_distance: z.number().int().min(0).max(3).default(1),
  same_pan_amount_window_min: z.number().min(0).default(30),
  /** max seconds between photo capture and validation */
  capture_max_age_sec: z.number().positive().default(300),
  require_gps: z.boolean().default(false),
  whitelist_stale_hours: z.number().positive().default(24),

  // --- exposure cap (flagged or unsynced card-slip policies open at once) ---
  exposure_cap_count: z.number().int().min(0).default(5),
  /** MZN */
  exposure_cap_value: mzn(50000),

  // --- offline / retention / reconciliation ---
  image_retention_days: z.number().int().positive().default(730),
  offline_grace_days: z.number().int().positive().default(7),
  number_block_size: z.number().int().positive().default(50),
  /** MZN reserved from the wallet per device for offline credit sales; 0 = off */
  offline_credit_allowance: mzn(0),
  settlement_lag_days: z.number().int().min(0).default(3),
}).refine((s) => s.ocr_conf_min <= s.ocr_conf_auto, {
  message: 'ocr_conf_min must not exceed ocr_conf_auto',
  path: ['ocr_conf_min'],
})

export type InsurerSettings = z.infer<typeof insurerSettingsSchema>

export function parseInsurerSettings(stored: unknown): InsurerSettings {
  return insurerSettingsSchema.parse(stored ?? {})
}

export const DEFAULT_INSURER_SETTINGS: InsurerSettings = parseInsurerSettings({})
