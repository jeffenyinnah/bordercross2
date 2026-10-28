import { useState, type FormEvent } from 'react'
import { Banner, Button, Field, Input } from '../ui'
import { config } from '@/lib/agent-app/config'
import { useServices } from '@/lib/agent-app/services'
import { isValidPin, setPin, verifyPin } from '@/lib/agent-app/pin'

export function SetPin({ onDone }: { onDone: () => void }) {
  const { store } = useServices()
  const [pin, setPinValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isValidPin(pin)) return setError('Use 4 to 8 digits, not all the same and not a sequence')
    if (pin !== confirm) return setError('PINs do not match')
    await setPin(store, pin)
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Choose an unlock PIN</h1>
      <p className="text-sm text-gray-500">You will use it to open the app, also without internet.</p>
      <Field label="PIN"><Input inputMode="numeric" type="password" value={pin} onChange={(e) => setPinValue(e.target.value)} /></Field>
      <Field label="Repeat PIN"><Input inputMode="numeric" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit">Save PIN</Button>
    </form>
  )
}

export function Unlock({ onDone, onLocked }: { onDone: () => void; onLocked: () => void }) {
  const { store } = useServices()
  const [pin, setPinValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = await verifyPin(store, pin)
    setPinValue('')
    if (r.ok) return onDone()
    if (r.attemptsLeft === 0) return onLocked()
    setError(`Wrong PIN. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? '' : 's'} left.`)
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col justify-center gap-4 p-6">
      <p className="text-center text-2xl font-bold text-brand">{config.appName}</p>
      <Field label="Enter your PIN">
        <Input autoFocus inputMode="numeric" type="password" value={pin} onChange={(e) => setPinValue(e.target.value)} />
      </Field>
      {error && <Banner tone="error">{error}</Banner>}
      <Button type="submit">Unlock</Button>
    </form>
  )
}
