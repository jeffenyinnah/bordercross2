export type UserRole = 'admin' | 'insurer_admin' | 'finance' | 'agent'
export type PolicyType = 'monthly' | 'annual'
/** Everything is sold, paid and accounted in meticais. */
export type Currency = 'MZN'
export type TransactionType = 'credit' | 'debit' | 'reserve' | 'release'
export type CommissionType = 'direct' | 'override'
export type PolicyStatus = 'active' | 'expired' | 'cancelled'
export type DocumentType = 'Passport' | 'ID' | 'Vehicle Booklet' | 'License'
export type PaymentMethod = 'VIRTUAL_CREDIT' | 'POS_CARD_SLIP'
export type PaymentStatus =
  | 'PENDING_RECONCILIATION'
  | 'RECONCILED'
  | 'FAILED_RECONCILIATION'
  | 'NEEDS_REVIEW'
  | 'CONFLICT'
  | 'DECLINED'
export type PaymentTier = 'AUTO_PASS' | 'ISSUE_WITH_FLAG' | 'HARD_DECLINE'
export type SettlementMatchStatus = 'UNMATCHED' | 'MATCHED' | 'AMOUNT_MISMATCH' | 'ORPHAN_SETTLEMENT'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  parent_agent_id: string | null
  commission_rate: number
  sub_agent_override_rate: number
  is_active: boolean
  insurer_id: string | null
  border_post_id: string | null
  created_at: string
}

export interface Insurer {
  id: string
  name: string
  code: string
  payment_methods: PaymentMethod[]
  settings: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BorderPost {
  id: string
  name: string
  code: string
  province: string | null
  is_active: boolean
  created_at: string
}

export interface VehicleType {
  id: string
  name: string
  description: string | null
  price_mzn: number
  price_mzn_annual: number | null
  insurer_id: string | null
  is_active: boolean
}

/** Reference rate for showing a cash amount in rand or dollars: 1 from_currency = rate MZN. */
export interface ExchangeRate {
  id: string
  from_currency: 'ZAR' | 'USD'
  to_currency: 'MZN'
  rate: number
  updated_by: string | null
  updated_at: string
}

export interface Policy {
  id: string
  policy_number: string
  agent_id: string
  client_name: string
  client_id_number: string | null
  client_nationality: string | null
  vehicle_type_id: string
  policy_type: PolicyType
  currency: Currency
  premium_amount: number
  premium_mzn_equivalent: number
  plate_number: string
  vehicle_brand: string
  vehicle_model: string
  vehicle_year: number | null
  engine_number: string | null
  chassis_number: string | null
  start_date: string
  end_date: string
  border: string | null
  document_type: string | null
  document_url: string | null
  status: PolicyStatus
  notes: string | null
  insurer_id: string
  payment_method: PaymentMethod
  device_id: string | null
  client_uuid: string | null
  issued_offline: boolean
  device_issued_at: string | null
  synced_at: string | null
  price_snapshot: Record<string, unknown> | null
  sync_flags: string[]
  verification_token: string
  created_at: string
  updated_at: string
  vehicle_type?: VehicleType
  agent?: Profile
}

export interface CreditWallet {
  id: string
  agent_id: string
  balance_mzn: number
  updated_at: string
}

export interface CreditTransaction {
  id: string
  wallet_id: string
  agent_id: string
  type: TransactionType
  currency: Currency
  amount: number
  balance_after: number
  description: string | null
  reference_id: string | null
  performed_by: string | null
  created_at: string
  performer?: Profile
}

export interface Commission {
  id: string
  policy_id: string
  agent_id: string
  commission_type: CommissionType
  rate: number
  amount: number
  currency: Currency
  paid_at: string | null
  created_at: string
  policy?: Policy
  agent?: Profile
}

export interface Device {
  id: string
  revoked_by: string | null
  agent_id: string
  insurer_id: string
  platform: 'ios' | 'android' | 'web'
  model: string | null
  app_version: string | null
  registered_at: string
  last_seen_at: string | null
  last_sync_at: string | null
  clock_offset_ms: number | null
  revoked_at: string | null
}

export interface MerchantAccount {
  id: string
  mid: string
  insurer_id: string
  bank: string
  name: string | null
  is_active: boolean
}

export interface Terminal {
  id: string
  tid: string
  mid: string
  insurer_id: string
  bank: string
  assigned_agent_id: string | null
  border_post_id: string | null
  last_recibo: number | null
  is_active: boolean
}

export interface SlipProfile {
  id: string
  name: string
  network: string
  version: number
  match_keywords: string[]
  config: Record<string, unknown>
  is_active: boolean
}

export interface PaymentEdit {
  field: string
  ocr_value: string | null
  edited_value: string | null
  at: string
}

export interface PaymentCheck {
  id: string
  pass: boolean
  severity: 'HARD' | 'FLAG'
  expected?: string | null
  actual?: string | null
  message: string
}

export interface PolicyPayment {
  id: string
  client_uuid: string
  policy_id: string | null
  method: PaymentMethod
  status: PaymentStatus
  tier: PaymentTier
  expected_amount: number
  expected_currency: Currency
  bank_brand: string | null
  merchant_name: string | null
  merchant_address: string | null
  recibo_no: number | null
  card_type: string | null
  pan_last4: string | null
  aid: string | null
  txn_type: string | null
  amount: number | null
  currency: string | null
  approval_status: string | null
  txn_at: string | null
  auth_code: string | null
  rrn: string | null
  rc: string | null
  tid: string | null
  mid: string | null
  batch: string | null
  verification: string | null
  copy_type: string | null
  footer_code: string | null
  matched_terminal_id: string | null
  raw_ocr_text: string | null
  field_confidence: Record<string, number>
  edits: PaymentEdit[]
  checks: PaymentCheck[]
  flags: string[]
  slip_profile_id: string | null
  slip_profile_version: number | null
  image_path: string | null
  image_sha256: string | null
  captured_at: string | null
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy_m: number | null
  device_id: string | null
  agent_id: string
  border_post_id: string | null
  insurer_id: string
  device_created_at: string | null
  synced_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  reconciled_at: string | null
  settlement_row_id: string | null
  created_at: string
  updated_at: string
}

export interface NumberLease {
  id: string
  device_id: string
  border_code: string
  year: number
  start_seq: number
  end_seq: number
  last_used_seq: number | null
  leased_at: string
  closed_at: string | null
}

export interface OfflineCreditLease {
  id: string
  device_id: string
  agent_id: string
  reserved: number
  consumed: number
  status: 'active' | 'settled' | 'released'
  created_at: string
  settled_at: string | null
}

export interface ActionResult<T = void> {
  success: boolean
  data?: T
  error?: string
}
