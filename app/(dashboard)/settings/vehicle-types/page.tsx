import { createClient } from '@/lib/supabase/server'
import { VehicleTypesManager } from '@/components/settings/VehicleTypesManager'

export default async function VehicleTypesPage() {
  const supabase = await createClient()
  const { data: templates } = await supabase
    .from('vehicle_type_templates')
    .select('*')
    .order('name')

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 max-w-2xl">
        A new insurer starts with a copy of this list and then manages its own prices.
        Changes here do not affect insurers that already exist.
      </p>
      <VehicleTypesManager vehicleTypes={templates ?? []} kind="template" />
    </div>
  )
}
