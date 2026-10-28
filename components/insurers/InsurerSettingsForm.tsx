'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import type { InsurerSettings } from '@bordercross/core'
import { updateInsurerSettings } from '@/lib/actions/insurers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormSelect } from '@/components/shared/FormSelect'
import type { PaymentMethod } from '@/lib/types'

interface Props {
  insurerId: string
  paymentMethods: PaymentMethod[]
  settings: InsurerSettings
  activeTerminals: number
  readOnly?: boolean
}

type NumberKey = {
  [K in keyof InsurerSettings]: InsurerSettings[K] extends number ? K : never
}[keyof InsurerSettings]

interface Field {
  key: NumberKey
  label: string
  hint: string
  /** shown as a percentage, stored as 0..1 */
  percent?: boolean
  step?: string
}

const CARD_FIELDS: Field[] = [
  { key: 'slip_time_window_min', label: 'Slip age limit (minutes)', hint: 'Maximum time between the slip and the policy.' },
  { key: 'capture_max_age_sec', label: 'Photo age limit (seconds)', hint: 'Maximum time between taking the photo and checking it.' },
  { key: 'ocr_conf_auto', label: 'Auto-accept reading confidence (%)', hint: 'Slips read at or above this, unedited, pass without a flag.', percent: true },
  { key: 'ocr_conf_min', label: 'Minimum reading confidence (%)', hint: 'Below this the agent must confirm the field.', percent: true },
  { key: 'same_pan_amount_window_min', label: 'Same card + amount window (minutes)', hint: 'Repeated card and amount within this window is flagged.' },
  { key: 'exposure_cap_count', label: 'Open flagged policies per agent', hint: 'Flagged or unsynced card policies an agent may have open at once.', step: '1' },
  { key: 'exposure_cap_value', label: 'Open flagged value per agent (MZN)', hint: 'Total MZN of those policies.' },
  { key: 'settlement_lag_days', label: 'Bank settlement lag (days)', hint: 'Days the bank takes to settle; used when matching statements.', step: '1' },
]

const OFFLINE_FIELDS: Field[] = [
  { key: 'offline_credit_allowance', label: 'Offline credit per phone (MZN)', hint: 'Moved out of the wallet so the phone can sell on credit without signal. 0 = off.' },
  { key: 'number_block_size', label: 'Policy numbers per block', hint: 'Numbers each phone reserves for its border post.', step: '1' },
  { key: 'offline_grace_days', label: 'Offline grace (days)', hint: 'Days a phone may sell without syncing before it stops.', step: '1' },
  { key: 'image_retention_days', label: 'Keep slip photos (days)', hint: 'Photos are deleted after this.', step: '1' },
]

const toInput = (f: Field, v: number) => (f.percent ? Math.round(v * 100) : v)
const fromInput = (f: Field, v: number) => (f.percent ? v / 100 : v)
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)

export function InsurerSettingsForm({ insurerId, paymentMethods, settings, activeTerminals, readOnly = false }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [card, setCard] = useState(paymentMethods.includes('POS_CARD_SLIP'))
  const [credit, setCredit] = useState(paymentMethods.includes('VIRTUAL_CREDIT'))

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)

    const values: Record<string, unknown> = {}
    for (const f of [...CARD_FIELDS, ...OFFLINE_FIELDS]) {
      values[f.key] = fromInput(f, Number(fd.get(f.key)))
    }
    values.require_gps = fd.get('require_gps') === 'on'
    values.expected_copy_wording = list(fd.get('expected_copy_wording') as string)
    values.copy_wording_severity = fd.get('copy_wording_severity')
    values.accepted_txn_types = list(fd.get('accepted_txn_types') as string)

    const methods: PaymentMethod[] = [
      ...(credit ? ['VIRTUAL_CREDIT' as const] : []),
      ...(card ? ['POS_CARD_SLIP' as const] : []),
    ]

    startTransition(async () => {
      const result = await updateInsurerSettings(insurerId, { payment_methods: methods, settings: values })
      if (result.success) toast.success('Settings saved. Phones pick them up on their next refresh.')
      else setError(result.error ?? 'Failed to save settings')
    })
  }

  const numberInput = (f: Field) => (
    <div key={f.key} className="space-y-1.5">
      <Label htmlFor={f.key}>{f.label}</Label>
      <Input id={f.key} name={f.key} type="number" min={0} step={f.step ?? 'any'}
        max={f.percent ? 100 : undefined} defaultValue={toInput(f, settings[f.key])} required />
      <p className="text-xs text-gray-500">{f.hint}</p>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* the platform admin sees the insurer's choices without changing them */}
      <fieldset disabled={readOnly} className="space-y-6 min-w-0">
      <Card>
        <CardHeader><CardTitle className="text-base">Payment methods</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
            <span>
              <span className="font-medium">Virtual credit</span>
              <span className="block text-gray-500">The agent pays from their prepaid wallet and collects cash.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={card} onChange={(e) => setCard(e.target.checked)} />
            <span>
              <span className="font-medium">Card on a POS terminal</span>
              <span className="block text-gray-500">The client pays by card; the agent photographs the slip and the phone checks it.</span>
            </span>
          </label>
          {card && activeTerminals === 0 && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertDescription className="text-amber-800">
                No active terminal is registered. Card slips will be declined until you add one on{' '}
                <Link href="/terminals" className="underline">POS Terminals</Link>.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className={card ? '' : 'opacity-60'}>
        <CardHeader><CardTitle className="text-base">Card slip checks</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{CARD_FIELDS.map(numberInput)}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expected_copy_wording">Slip copy wording</Label>
              <Input id="expected_copy_wording" name="expected_copy_wording"
                defaultValue={settings.expected_copy_wording.join(', ')} placeholder="e.g. VIA COMERCIANTE" />
              <p className="text-xs text-gray-500">Text the merchant copy carries, comma separated. Empty = not checked.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copy_wording_severity">If the wording is missing</Label>
              <FormSelect id="copy_wording_severity" name="copy_wording_severity" defaultValue={settings.copy_wording_severity}>
                <option value="FLAG">Issue the policy with a flag</option>
                <option value="HARD">Decline the slip</option>
              </FormSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="accepted_txn_types">Accepted transaction types</Label>
              <Input id="accepted_txn_types" name="accepted_txn_types" required
                defaultValue={settings.accepted_txn_types.join(', ')} />
              <p className="text-xs text-gray-500">As printed on the slip, comma separated.</p>
            </div>
            <label className="flex items-center gap-3 text-sm pt-6">
              <input type="checkbox" name="require_gps" defaultChecked={settings.require_gps} />
              Require the phone&apos;s location with every slip
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Offline selling</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{OFFLINE_FIELDS.map(numberInput)}</div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      </fieldset>
      {!readOnly && (
        <Button type="submit" className="bg-brand hover:bg-brand/90" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save settings'}
        </Button>
      )}
    </form>
  )
}
