import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { computePremium, type PaymentMethodCode, type PolicyType } from '@bordercross/core'
import type { AgentState, CardQuote } from '@/lib/agent-app/agent'
import { money, referenceText } from '@/lib/agent-app/money'
import type { LocalPolicy } from '@/lib/agent-app/store/types'
import { useServices } from '@/lib/agent-app/services'
import { Banner, Button, Card, Field, Input, Screen, Select } from '../ui'

const today = () => new Date().toISOString().slice(0, 10)

export function NewPolicy({ online, onBack, onIssued, onCard }: {
  online: boolean
  onBack: () => void
  onIssued: (policy: LocalPolicy) => void
  /** card sale priced: continue to the POS slip capture */
  onCard: (quote: CardQuote) => void
}) {
  const { agent } = useServices()
  const [state, setState] = useState<AgentState | null>(null)
  const [f, setF] = useState({
    policy_type: 'monthly' as PolicyType,
    vehicle_type_ids: [] as string[],
    client_name: '',
    client_id_number: '',
    client_nationality: '',
    plate_number: '',
    vehicle_brand: '',
    vehicle_model: '',
    vehicle_year: '',
    engine_number: '',
    chassis_number: '',
    start_date: today(),
    border_post_id: '',
  })
  const [method, setMethod] = useState<PaymentMethodCode>('VIRTUAL_CREDIT')
  const [error, setError] = useState<string | null>(null)
  const [retryUuid, setRetryUuid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    agent.state().then((s) => {
      setState(s)
      setF((p) => ({ ...p, border_post_id: s.snapshot.profile.border_post_id ?? s.snapshot.border_posts[0]?.id ?? '' }))
      if (!s.snapshot.insurer.payment_methods.includes('VIRTUAL_CREDIT')) setMethod('POS_CARD_SLIP')
    })
  }, [agent])

  const premium = useMemo(() => state && f.vehicle_type_ids.length > 0
    ? computePremium({
        vehicleTypes: state.snapshot.vehicle_types,
        selectedIds: f.vehicle_type_ids,
        policyType: f.policy_type,
        insurerId: state.snapshot.profile.insurer_id,
      })
    : null, [state, f.vehicle_type_ids, f.policy_type])

  if (!state) return null
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const toggleType = (id: string) => setF((p) => ({
    ...p,
    vehicle_type_ids: p.vehicle_type_ids.includes(id) ? p.vehicle_type_ids.filter((x) => x !== id) : [...p.vehicle_type_ids, id],
  }))

  const border = state.snapshot.border_posts.find((b) => b.id === f.border_post_id)
  const cap = agent.offlineCapacity(state, border?.code ?? '')

  const details = () => ({
    policy_type: f.policy_type,
    vehicle_type_ids: f.vehicle_type_ids,
    client_name: f.client_name,
    client_id_number: f.client_id_number || undefined,
    client_nationality: f.client_nationality || undefined,
    plate_number: f.plate_number.toUpperCase(),
    vehicle_brand: f.vehicle_brand,
    vehicle_model: f.vehicle_model,
    vehicle_year: f.vehicle_year ? Number(f.vehicle_year) : undefined,
    engine_number: f.engine_number || undefined,
    chassis_number: f.chassis_number || undefined,
    start_date: f.start_date,
  })

  async function startCard() {
    setBusy(true)
    setError(null)
    try {
      const r = await agent.quoteCard({ details: details(), borderPostId: f.border_post_id })
      if (r.ok) return onCard(r.quote)
      setError(r.error)
    } finally {
      setBusy(false)
    }
  }

  async function issue(mode: 'online' | 'offline', clientUuid?: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await agent.issue({
        details: details(),
        borderPostId: f.border_post_id,
        paymentMethod: 'VIRTUAL_CREDIT',
        online: mode === 'online',
        clientUuid,
      })
      if (r.ok) return onIssued(r.policy)
      setError(r.error)
      setRetryUuid(r.retryable && r.clientUuid ? r.clientUuid : null)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (method === 'POS_CARD_SLIP') startCard()
    else issue(online ? 'online' : 'offline')
  }

  const cardEnabled = state.snapshot.insurer.payment_methods.includes('POS_CARD_SLIP')
  const creditEnabled = state.snapshot.insurer.payment_methods.includes('VIRTUAL_CREDIT')

  return (
    <Screen title="New policy" onBack={onBack}>
      <form id="policy" onSubmit={submit} className="space-y-4">
        {!online && (
          <Banner tone="warn">
            Offline: {cap.numbers} policy numbers{method === 'VIRTUAL_CREDIT' && <> and {money(cap.credit)} credit</>} available here.
          </Banner>
        )}

        <Card className="space-y-3">
          <Field label="Border post">
            <Select value={f.border_post_id} onChange={set('border_post_id')}>
              {state.snapshot.border_posts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Cover">
            <Select value={f.policy_type} onChange={set('policy_type')}>
              <option value="monthly">Monthly (30 days)</option>
              <option value="annual">Annual</option>
            </Select>
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Vehicle type</p>
            {state.snapshot.vehicle_types.map((vt) => (
              <label key={vt.id} className="flex h-11 items-center gap-3 rounded-xl border border-gray-200 px-3">
                <input type="checkbox" className="size-5 accent-brand" checked={f.vehicle_type_ids.includes(vt.id)} onChange={() => toggleType(vt.id)} />
                <span>{vt.name}</span>
              </label>
            ))}
          </div>
          {premium && (premium.ok
            ? (
              <div>
                <p className="text-lg">Premium: <b>{money(premium.premiumMinor)}</b></p>
                {referenceText(premium.premiumMinor, state.snapshot.exchange_rates) && (
                  <p className="text-sm text-gray-500">
                    Cash reference: {referenceText(premium.premiumMinor, state.snapshot.exchange_rates)}
                  </p>
                )}
              </div>
            )
            : <Banner tone="error">{premium.error}</Banner>)}
        </Card>

        <Card className="space-y-3">
          <Field label="Client name"><Input value={f.client_name} onChange={set('client_name')} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID / passport"><Input value={f.client_id_number} onChange={set('client_id_number')} /></Field>
            <Field label="Nationality"><Input value={f.client_nationality} onChange={set('client_nationality')} /></Field>
          </div>
        </Card>

        <Card className="space-y-3">
          <Field label="Plate number"><Input value={f.plate_number} onChange={set('plate_number')} className="uppercase" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand"><Input value={f.vehicle_brand} onChange={set('vehicle_brand')} required /></Field>
            <Field label="Model"><Input value={f.vehicle_model} onChange={set('vehicle_model')} required /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year"><Input inputMode="numeric" value={f.vehicle_year} onChange={set('vehicle_year')} /></Field>
            <Field label="Start date"><Input type="date" value={f.start_date} onChange={set('start_date')} required /></Field>
          </div>
          <Field label="Engine number"><Input value={f.engine_number} onChange={set('engine_number')} /></Field>
          <Field label="Chassis number"><Input value={f.chassis_number} onChange={set('chassis_number')} /></Field>
        </Card>

        <Card className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Payment</p>
          {([
            ['VIRTUAL_CREDIT', 'Virtual credit', creditEnabled],
            ['POS_CARD_SLIP', 'Card on POS terminal (photograph the slip)', cardEnabled],
          ] as const).filter(([, , enabled]) => enabled).map(([code, label]) => (
            <label key={code} className={`flex h-11 items-center gap-3 rounded-xl border px-3 ${method === code ? 'border-brand' : 'border-gray-200'}`}>
              <input type="radio" name="method" checked={method === code} onChange={() => setMethod(code)} className="size-5 accent-brand" />
              <span>{label}</span>
            </label>
          ))}
        </Card>

        {error && <Banner tone="error">{error}</Banner>}
      </form>

      {retryUuid && (
        <div className="space-y-2">
          <Button disabled={busy} onClick={() => issue('online', retryUuid)}>Retry</Button>
          <Button variant="outline" disabled={busy} onClick={() => issue('offline', retryUuid)}>Issue offline instead</Button>
        </div>
      )}

      {!retryUuid && (
        <Button type="submit" form="policy" disabled={busy || !premium?.ok}>
          {busy ? 'Please wait…'
            : method === 'POS_CARD_SLIP' ? 'Continue to card payment'
            : online ? 'Issue policy' : 'Issue policy offline'}
        </Button>
      )}
    </Screen>
  )
}
