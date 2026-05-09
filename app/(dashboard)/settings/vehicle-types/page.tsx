import { createClient } from '@/lib/supabase/server'
import { VehicleTypesManager } from '@/components/settings/VehicleTypesManager'

export default async function VehicleTypesPage() {
  const supabase = await createClient()
  const { data: vehicleTypes } = await supabase
    .from('vehicle_types')
    .select('*')
    .order('name')

  return <VehicleTypesManager vehicleTypes={vehicleTypes ?? []} />
}
