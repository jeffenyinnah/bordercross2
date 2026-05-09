'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateExchangeRate } from '@/lib/actions/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatDateTime } from '@/lib/utils/dates'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { ExchangeRate } from '@/lib/types'
import { differenceInHours } from 'date-fns'

interface ExchangeRatesManagerProps {
  rates: ExchangeRate[]
}

export function ExchangeRatesManager({ rates }: ExchangeRatesManagerProps) {
  const [editId, setEditId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isPending, startTransition] = useTransition()

  const staleRates = rates.filter(
    (r) => differenceInHours(new Date(), new Date(r.updated_at)) > 24
  )

  function startEdit(rate: ExchangeRate) {
    setEditId(rate.id)
    setEditValue(String(rate.rate))
  }

  function cancelEdit() {
    setEditId(null)
    setEditValue('')
  }

  function saveEdit(rate: ExchangeRate) {
    startTransition(async () => {
      const result = await updateExchangeRate(rate.from_currency, rate.to_currency, Number(editValue))
      if (result.success) {
        toast.success('Exchange rate updated')
        cancelEdit()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      {staleRates.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-700">
            {staleRates.length} exchange rate(s) haven&apos;t been updated in over 24 hours.
            Please update them.
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate) => {
              const isStale = differenceInHours(new Date(), new Date(rate.updated_at)) > 24
              return (
                <TableRow key={rate.id} className={isStale ? 'bg-amber-50' : ''}>
                  <TableCell className="font-medium">{rate.from_currency}</TableCell>
                  <TableCell>{rate.to_currency}</TableCell>
                  <TableCell>
                    {editId === rate.id ? (
                      <Input
                        type="number"
                        step="0.000001"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-36 h-8"
                        autoFocus
                      />
                    ) : (
                      <span className="font-mono">{rate.rate}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    <span className={isStale ? 'text-amber-600 font-medium' : ''}>
                      {formatDateTime(rate.updated_at)}
                      {isStale && ' ⚠'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {editId === rate.id ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-700"
                          disabled={isPending}
                          onClick={() => saveEdit(rate)}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => startEdit(rate)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
