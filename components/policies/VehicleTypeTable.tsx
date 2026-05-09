'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils/currency'
import type { VehicleType, Currency } from '@/lib/types'

interface VehicleTypeTableProps {
  vehicleTypes: VehicleType[]
  currency: Currency
  policyType: 'monthly' | 'annual'
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

export function VehicleTypeTable({
  vehicleTypes,
  currency,
  policyType,
  selectedIds,
  onSelectionChange,
}: VehicleTypeTableProps) {
  const totalPrice = vehicleTypes
    .filter((vt) => selectedIds.includes(vt.id) && vt.is_active)
    .reduce((sum, vt) => {
      const price =
        policyType === 'annual'
          ? currency === 'MZN'
            ? vt.price_mzn_annual
            : currency === 'ZAR'
              ? vt.price_zar_annual
              : vt.price_usd_annual
          : currency === 'MZN'
            ? vt.price_mzn
            : currency === 'ZAR'
              ? vt.price_zar
              : vt.price_usd
      return sum + (price || 0)
    }, 0)

  const handleToggle = (vehicleTypeId: string) => {
    if (selectedIds.includes(vehicleTypeId)) {
      onSelectionChange(selectedIds.filter((id) => id !== vehicleTypeId))
    } else {
      onSelectionChange([...selectedIds, vehicleTypeId])
    }
  }

  const activeVehicleTypes = vehicleTypes.filter((vt) => {
    if (!vt.is_active) return false
    if (policyType === 'annual') {
      const annualPrice =
        currency === 'MZN'
          ? vt.price_mzn_annual
          : currency === 'ZAR'
            ? vt.price_zar_annual
            : vt.price_usd_annual
      return annualPrice !== null && annualPrice !== undefined
    }
    return true
  })

  return (
    <div className="space-y-3">
      <Label>Vehicle Types</Label>

      {/* Desktop table view */}
      <div className="hidden sm:block border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="w-10 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.length > 0 && selectedIds.length === activeVehicleTypes.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onSelectionChange(activeVehicleTypes.map((vt) => vt.id))
                    } else {
                      onSelectionChange([])
                    }
                  }}
                  className="rounded"
                />
              </th>
              <th className="flex-1 px-4 py-3 text-left font-medium text-gray-700">Vehicle Type</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Value ({currency})</th>
            </tr>
          </thead>
          <tbody>
            {activeVehicleTypes.map((vt) => {
              const price =
                policyType === 'annual'
                  ? currency === 'MZN'
                    ? vt.price_mzn_annual
                    : currency === 'ZAR'
                      ? vt.price_zar_annual
                      : vt.price_usd_annual
                  : currency === 'MZN'
                    ? vt.price_mzn
                    : currency === 'ZAR'
                      ? vt.price_zar
                      : vt.price_usd
              return (
                <tr
                  key={vt.id}
                  className={`border-b last:border-b-0 cursor-pointer ${selectedIds.includes(vt.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(vt.id)}
                      onChange={() => handleToggle(vt.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{vt.name}</td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">
                    {formatCurrency(price || 0, currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="sm:hidden space-y-2">
        {activeVehicleTypes.map((vt) => {
          const price =
            policyType === 'annual'
              ? currency === 'MZN'
                ? vt.price_mzn_annual
                : currency === 'ZAR'
                  ? vt.price_zar_annual
                  : vt.price_usd_annual
              : currency === 'MZN'
                ? vt.price_mzn
                : currency === 'ZAR'
                  ? vt.price_zar
                  : vt.price_usd
          return (
            <div
              key={vt.id}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${selectedIds.includes(vt.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
              onClick={() => handleToggle(vt.id)}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(vt.id)}
                  onChange={() => handleToggle(vt.id)}
                  className="rounded mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{vt.name}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    {formatCurrency(price || 0, currency)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-blue-50 border border-brand/20 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <span className="font-medium text-brand">TOTAL:</span>
        <span className="text-lg font-bold text-brand">{formatCurrency(totalPrice, currency)}</span>
      </div>
    </div>
  )
}
