export type UserRole = 'admin' | 'agent'
export type PolicyType = 'monthly' | 'annual'
export type Currency = 'MZN' | 'ZAR' | 'USD'
export type TransactionType = 'credit' | 'debit'
export type CommissionType = 'direct' | 'override'
export type PolicyStatus = 'active' | 'expired' | 'cancelled'
export type DocumentType = 'Passport' | 'ID' | 'Vehicle Booklet' | 'License'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  parent_agent_id: string | null
  commission_rate: number
  sub_agent_override_rate: number
  is_active: boolean
  created_at: string
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
  price_zar: number
  price_usd: number
  price_mzn_annual: number | null
  price_zar_annual: number | null
  price_usd_annual: number | null
  is_active: boolean
}

export interface ExchangeRate {
  id: string
  from_currency: string
  to_currency: string
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
  created_at: string
  updated_at: string
  vehicle_type?: VehicleType
  agent?: Profile
}

export interface CreditWallet {
  id: string
  agent_id: string
  balance_mzn: number
  balance_zar: number
  balance_usd: number
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

export interface ActionResult<T = void> {
  success: boolean
  data?: T
  error?: string
}
