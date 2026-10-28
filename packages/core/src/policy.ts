import { z } from 'zod'
import { PRICE_CURRENCY } from './money'

/**
 * What the agent enters when issuing a policy. Shared by the web server action,
 * the mobile app and the sync endpoint. Prices are never part of it: the premium
 * is always computed from vehicle_type_ids.
 */
export const policyDetailsSchema = z.object({
  policy_type: z.enum(['monthly', 'annual']),
  /** always MZN; accepted for older clients that still send it */
  currency: z.literal(PRICE_CURRENCY).default(PRICE_CURRENCY),
  vehicle_type_ids: z.array(z.uuid()).min(1, 'Select at least one vehicle type'),
  client_name: z.string().trim().min(1, 'Client name is required'),
  client_id_number: z.string().trim().optional(),
  client_nationality: z.string().trim().optional(),
  plate_number: z.string().trim().min(1, 'Plate number is required'),
  vehicle_brand: z.string().trim().min(1, 'Vehicle brand is required'),
  vehicle_model: z.string().trim().min(1, 'Vehicle model is required'),
  vehicle_year: z.number().int().optional(),
  engine_number: z.string().trim().optional(),
  chassis_number: z.string().trim().optional(),
  start_date: z.iso.date(),
  border: z.string().optional(),
  document_type: z.string().optional(),
  document_url: z.string().optional(),
  notes: z.string().optional(),
})

export type PolicyDetails = z.output<typeof policyDetailsSchema>
export type PolicyDetailsInput = z.input<typeof policyDetailsSchema>
