import { useEffect, useMemo, useRef, useState } from 'react'
import type { FieldEdit, SlipFieldName, SlipProfileConfig } from '@bordercross/core'
import type { CardQuote, SlipCheck, SlipReading } from '@/lib/agent-app/agent'
import { captureFrame, devCapture, guideToVideoRect, openCamera, setTorch, stopCamera, type SlipCapture } from '@/lib/agent-app/capture'
import { recognizeSlip } from '@/lib/agent-app/ocr'
import { money } from '@/lib/agent-app/money'
import type { LocalPolicy } from '@/lib/agent-app/store/types'
import { useServices } from '@/lib/agent-app/services'
import { Banner, Button, Card, Field, Input, Screen } from '../ui'

/** Fields shown for review, in slip order. The first ten are required by validation. */
const REVIEW_FIELDS: { field: SlipFieldName; label: string; hint?: string }[] = [
  { field: 'amount', label: 'Amount (MONTANTE)' },
  { field: 'currency', label: 'Currency' },
  { field: 'approval_status', label: 'Status', hint: 'APROVADA' },
  { field: 'txn_type', label: 'Transaction type', hint: 'COMPRA' },
  { field: 'txn_at', label: 'Date and time', hint: 'DD/MM/YYYY HH:MM:SS' },
  { field: 'auth_code', label: 'AUTH CODE', hint: '6 digits' },
  { field: 'rrn', label: 'RRN', hint: '12 digits' },
  { field: 'rc', label: 'RC', hint: '000' },
  { field: 'tid', label: 'TID', hint: '8 digits' },
  { field: 'mid', label: 'MID', hint: '15 digits' },
  { field: 'recibo_no', label: 'RECIBO #' },
  { field: 'pan_last4', label: 'Card last 4 digits' },
]

type Step =
  | { name: 'charge'; error?: string }
  | { name: 'reading' }
  | { name: 'review'; reading: SlipReading }
  | { name: 'result'; reading: SlipReading; review: Review; check: SlipCheck }

interface Review {
  edits: FieldEdit[]
  confirmed: SlipFieldName[]
}

/** The parser's ISO time shown the way it is printed on the slip. */
function displayValue(field: SlipFieldName, value: string | null, profile: SlipProfileConfig): string {
  if (!value) return ''
  if (field !== 'txn_at') return value
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(value)
  if (!m) return value
  const [, y, mo, d, t] = m
  switch (profile.dateFormat) {
    case 'DD/MM/YYYY': return `${d}/${mo}/${y} ${t}`
    case 'MM/DD/YYYY': return `${mo}/${d}/${y} ${t}`
    case 'YYYY-MM-DD': return `${y}-${mo}-${d} ${t}`
  }
}

export function CardPayment({ quote, onCancel, onIssued }: {
  quote: CardQuote
  onCancel: () => void
  onIssued: (policy: LocalPolicy) => void
}) {
  const [step, setStep] = useState<Step>({ name: 'charge' })
  const amount = money(quote.premiumMinor, quote.currency)

  switch (step.name) {
    case 'charge':
    case 'reading':
      return (
        <ChargeStep
          amount={amount}
          busy={step.name === 'reading'}
          error={step.name === 'charge' ? step.error : undefined}
          onCancel={onCancel}
          onBusy={() => setStep({ name: 'reading' })}
          onRead={(reading) => setStep({ name: 'review', reading })}
          onError={(error) => setStep({ name: 'charge', error })}
        />
      )
    case 'review':
      return (
        <ReviewStep
          quote={quote}
          reading={step.reading}
          onRetake={() => setStep({ name: 'charge' })}
          onChecked={(review, check) => setStep({ name: 'result', reading: step.reading, review, check })}
        />
      )
    case 'result':
      return (
        <ResultStep
          quote={quote}
          amount={amount}
          reading={step.reading}
          review={step.review}
          check={step.check}
          onEdit={() => setStep({ name: 'review', reading: step.reading })}
          onRetake={() => setStep({ name: 'charge' })}
          onCancel={onCancel}
          onIssued={onIssued}
        />
      )
  }
}

function ChargeStep({ amount, busy, error, onCancel, onBusy, onRead, onError }: {
  amount: string
  busy: boolean
  error?: string
  onCancel: () => void
  onBusy: () => void
  onRead: (r: SlipReading) => void
  onError: (e: string) => void
}) {
  const { agent } = useServices()
  const [camera, setCamera] = useState(false)
  const [devText, setDevText] = useState('')

  async function read(capture: SlipCapture, ocrImage: HTMLCanvasElement) {
    onBusy()
    try {
      const ocr = await recognizeSlip(ocrImage)
      if (ocr.lines.length === 0) return onError('No text found on the photo. Lay the slip flat in good light and try again.')
      onRead(await agent.readSlip(capture, ocr))
    } catch (e) {
      onError((e as Error).message)
    }
  }

  async function useDevText() {
    onBusy()
    const { capture, ocr } = await devCapture(devText)
    onRead(await agent.readSlip(capture, ocr))
  }

  if (camera && !busy) {
    return (
      <SlipCamera
        onCancel={() => setCamera(false)}
        onError={(e) => { setCamera(false); onError(e) }}
        onCaptured={(capture, ocrImage) => { setCamera(false); read(capture, ocrImage) }}
      />
    )
  }

  return (
    <Screen title="Card payment" onBack={busy ? undefined : onCancel}>
      <Card className="space-y-2 text-center">
        <p className="text-sm text-gray-500">Type this amount into the POS terminal</p>
        <p className="font-mono text-4xl font-bold tracking-tight">{amount}</p>
        <p className="text-sm text-gray-500">Exactly this amount in MZN, also for foreign cards. Any other amount is declined.</p>
      </Card>
      <Card className="space-y-1 text-sm text-gray-700">
        <p>1. Let the customer pay on the POS.</p>
        <p>2. Give the customer their copy.</p>
        <p>3. Photograph the merchant copy: flat, in good light, the whole slip in the frame.</p>
      </Card>
      {error && <Banner tone="error">{error}</Banner>}
      <Button onClick={() => setCamera(true)} disabled={busy}>{busy ? 'Reading slip…' : 'Photograph slip'}</Button>
      {process.env.NODE_ENV !== 'production' && (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Development only: paste the slip text</p>
          <textarea
            value={devText}
            onChange={(e) => setDevText(e.target.value)}
            rows={8}
            className="w-full rounded-xl border border-gray-300 p-2 font-mono text-xs"
          />
          <Button variant="outline" onClick={useDevText} disabled={busy || !devText.trim()}>Read pasted text</Button>
        </Card>
      )}
      <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel sale</Button>
    </Screen>
  )
}

/** Full-screen live camera. The only way a slip image enters the app. */
function SlipCamera({ onCaptured, onCancel, onError }: {
  onCaptured: (capture: SlipCapture, ocrImage: HTMLCanvasElement) => void
  onCancel: () => void
  onError: (e: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const guide = useRef<HTMLDivElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [torch, setTorchOn] = useState<boolean | null>(null)
  const [shooting, setShooting] = useState(false)
  // the camera opens once per mount, whatever the parent passes on re-render
  const fail = useRef(onError)
  useEffect(() => { fail.current = onError })

  useEffect(() => {
    let cancelled = false
    openCamera()
      .then(async (s) => {
        if (cancelled) return stopCamera(s)
        stream.current = s
        const v = video.current!
        v.srcObject = s
        await v.play()
        setReady(true)
        // offer the torch only where the camera has one
        setTorchOn(await setTorch(s, false).then((ok) => (ok ? false : null)).catch(() => null))
      })
      .catch((e: Error) => { if (!cancelled) fail.current(e.message) })
    return () => {
      cancelled = true
      stopCamera(stream.current)
    }
  }, [])

  async function shoot() {
    if (!video.current) return
    setShooting(true)
    try {
      const crop = guide.current ? guideToVideoRect(video.current, guide.current.getBoundingClientRect()) : null
      const { capture, ocrImage } = await captureFrame(video.current, crop)
      onCaptured(capture, ocrImage)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  async function toggleTorch() {
    if (!stream.current || torch === null) return
    await setTorch(stream.current, !torch)
    setTorchOn(!torch)
  }

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        {/* guide: a slip is tall and narrow */}
        <div ref={guide} className="pointer-events-none absolute inset-x-[15%] inset-y-[8%] rounded-xl border-2 border-white/80" />
        <p className="absolute inset-x-0 top-3 text-center text-sm text-white drop-shadow">
          Fit the whole slip inside the frame
        </p>
      </div>
      <div className="grid grid-cols-3 items-center gap-2 bg-black p-4">
        <button className="h-12 text-white" onClick={onCancel} disabled={shooting}>Cancel</button>
        <button
          aria-label="Take photo"
          onClick={shoot}
          disabled={!ready || shooting}
          className="mx-auto size-16 rounded-full border-4 border-white bg-white/90 disabled:opacity-40"
        />
        {torch !== null
          ? <button className="h-12 text-white" onClick={toggleTorch}>{torch ? 'Light off' : 'Light on'}</button>
          : <span />}
      </div>
    </div>
  )
}

function ReviewStep({ quote, reading, onRetake, onChecked }: {
  quote: CardQuote
  reading: SlipReading
  onRetake: () => void
  onChecked: (review: Review, check: SlipCheck) => void
}) {
  const { agent } = useServices()
  const initial = useMemo(() => Object.fromEntries(REVIEW_FIELDS.map(({ field }) =>
    [field, displayValue(field, reading.parsed.fields[field].value, reading.profile)])) as Record<SlipFieldName, string>,
  [reading])
  const [values, setValues] = useState(initial)
  const [confirmed, setConfirmed] = useState<SlipFieldName[]>([])
  const [check, setCheck] = useState<SlipCheck | null>(null)
  const latest = useRef(0)

  const review: Review = useMemo(() => ({
    edits: REVIEW_FIELDS
      .filter(({ field }) => values[field] !== initial[field])
      .map(({ field }) => ({ field, value: values[field] || null })),
    confirmed,
  }), [values, initial, confirmed])

  // re-validate as the agent types, so the highlights follow the edits
  useEffect(() => {
    const n = ++latest.current
    agent.checkSlip(quote, reading, review).then((c) => { if (n === latest.current) setCheck(c) })
  }, [agent, quote, reading, review])

  const needs = new Set(check?.result.needsConfirmation ?? [])
  const blocked = check?.result.blockedReason === 'CONFIRM_FIELDS'

  return (
    <Screen
      title="Check the slip"
      onBack={onRetake}
      footer={(
        <>
          <Button disabled={!check || blocked} onClick={() => check && onChecked(review, check)}>
            {blocked ? `Check ${needs.size} highlighted field${needs.size === 1 ? '' : 's'}` : 'Continue'}
          </Button>
          <Button variant="outline" onClick={onRetake}>Retake photo</Button>
        </>
      )}
    >
      <Banner tone="info">Compare each value with the paper slip. Correct anything that was read wrong.</Banner>
      {reading.parsed.warnings.includes('UNMASKED_PAN_SEEN') && (
        <Banner tone="warn">A full card number was visible. Only the last 4 digits are kept.</Banner>
      )}
      <Card className="space-y-3">
        {REVIEW_FIELDS.map(({ field, label, hint }) => {
          const parsed = reading.parsed.fields[field]
          const edited = values[field] !== initial[field]
          const mustCheck = needs.has(field)
          const isConfirmed = confirmed.includes(field)
          // readable but unsure: the agent can accept it as read instead of retyping it
          const lowConfidence = !edited && parsed.value !== null && parsed.valid && (mustCheck || isConfirmed)
          return (
            <div key={field} className={mustCheck ? 'rounded-xl bg-amber-50 p-2 ring-1 ring-amber-300' : ''}>
              <Field
                label={label}
                hint={edited ? `Read as: ${initial[field] || '(nothing)'}` : hint}
                error={mustCheck && !lowConfidence ? (parsed.value === null && !edited ? 'Not found on the photo, type it from the slip' : 'Check this value') : undefined}
              >
                <Input
                  value={values[field]}
                  inputMode={['amount', 'auth_code', 'rrn', 'rc', 'tid', 'mid', 'recibo_no', 'pan_last4'].includes(field) ? 'decimal' : undefined}
                  className="font-mono"
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                />
              </Field>
              {lowConfidence && (
                <label className="mt-2 flex items-center gap-2 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand"
                    checked={isConfirmed}
                    onChange={(e) => setConfirmed((c) => e.target.checked ? [...c, field] : c.filter((x) => x !== field))}
                  />
                  Hard to read — I checked it matches the slip
                </label>
              )}
            </div>
          )
        })}
      </Card>
    </Screen>
  )
}

function ResultStep({ quote, amount, reading, review, check, onEdit, onRetake, onCancel, onIssued }: {
  quote: CardQuote
  amount: string
  reading: SlipReading
  review: Review
  check: SlipCheck
  onEdit: () => void
  onRetake: () => void
  onCancel: () => void
  onIssued: (policy: LocalPolicy) => void
}) {
  const { agent } = useServices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { result } = check
  const failed = result.checks.filter((c) => !c.pass)
  const hard = failed.filter((c) => c.severity === 'HARD')
  const flags = failed.filter((c) => c.severity === 'FLAG')

  // a declined slip is kept (with its photo) for fraud review
  useEffect(() => {
    if (result.tier === 'HARD_DECLINE') agent.declineCard(quote, reading, review).catch(() => {})
  }, [agent, quote, reading, review, result.tier])

  async function issue() {
    setBusy(true)
    setError(null)
    try {
      const r = await agent.issueCard(quote, reading, review)
      if (r.ok) return onIssued(r.policy)
      setError(r.error)
    } finally {
      setBusy(false)
    }
  }

  if (result.tier === 'HARD_DECLINE') {
    return (
      <Screen title="Payment not accepted" onBack={onEdit}>
        <Banner tone="error">No policy can be issued with this slip.</Banner>
        {result.amountMismatch && (
          <Card className="grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-xs text-gray-500">Slip shows</p>
              <p className="font-mono text-xl font-bold text-red-700">{result.amountMismatch.actual}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Premium</p>
              <p className="font-mono text-xl font-bold">{result.amountMismatch.expected}</p>
            </div>
          </Card>
        )}
        <Card className="space-y-2">
          {hard.map((c) => <p key={c.id} className="text-sm text-red-800">• {c.message}</p>)}
        </Card>
        {result.amountMismatch && (
          <Banner tone="warn">Refund or void the wrong payment on the POS, then charge {amount} and photograph the new slip.</Banner>
        )}
        <Button onClick={onRetake}>Photograph another slip</Button>
        <Button variant="outline" onClick={onEdit}>Back to the slip values</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel sale</Button>
      </Screen>
    )
  }

  const exposure = result.blockedReason === 'EXPOSURE_CAP'
  return (
    <Screen title={result.tier === 'AUTO_PASS' ? 'Payment verified' : 'Payment needs review'} onBack={onEdit}>
      {result.tier === 'AUTO_PASS'
        ? <Banner tone="ok">The slip matches {amount}. You can issue the policy.</Banner>
        : <Banner tone="warn">You can issue the policy. Finance reviews this payment because:</Banner>}
      {flags.length > 0 && (
        <Card className="space-y-2">
          {flags.map((c) => <p key={c.id} className="text-sm text-amber-900">• {c.message}</p>)}
        </Card>
      )}
      {exposure && (
        <Banner tone="error">Too many card sales are waiting for sync or review. Connect to the internet to sync before issuing more.</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <Button onClick={issue} disabled={busy || !result.canIssue}>{busy ? 'Issuing…' : 'Issue policy'}</Button>
      <Button variant="outline" onClick={onEdit} disabled={busy}>Back to the slip values</Button>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel sale</Button>
    </Screen>
  )
}
