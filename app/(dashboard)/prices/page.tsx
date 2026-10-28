import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import { InsurerPicker } from '@/components/terminals/InsurerPicker'
import { VehicleTypesManager } from '@/components/settings/VehicleTypesManager'

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>
}) {
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  const isAdmin = profile.role === 'admin'
  const supabase = await createClient()

  const { data: insurers } = isAdmin
    ? await supabase.from('insurers').select('id, name').order('name')
    : { data: null }
  const requested = (await searchParams).insurer
  const insurerId = isAdmin
    ? (insurers?.find((i) => i.id === requested) ?? insurers?.[0])?.id ?? null
    : profile.insurer_id

  if (!insurerId) {
    return <p className="text-gray-500">No insurer is set up yet.</p>
  }

  const { data: vehicleTypes } = await supabase
    .from('vehicle_types')
    .select('*')
    .eq('insurer_id', insurerId)
    .order('name')

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price List</h1>
          <p className="text-gray-500 text-sm mt-0.5 max-w-2xl">
            {isAdmin
              ? 'Each insurer sets its own vehicle categories and prices. View only.'
              : 'The vehicle categories your agents sell and their prices in MZN. Changes reach the phones on their next refresh.'}
          </p>
        </div>
        {isAdmin && insurers && insurers.length > 1 && <InsurerPicker insurers={insurers} value={insurerId} />}
      </div>
      <VehicleTypesManager vehicleTypes={vehicleTypes ?? []} kind="insurer" readOnly={isAdmin} />
    </div>
  )
}
