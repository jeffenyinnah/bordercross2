import { useEffect, useState } from 'react'
import type { CertificateFormat } from '@/lib/agent-app/print'
import type { LocalPolicy } from '@/lib/agent-app/store/types'
import { useServices } from '@/lib/agent-app/services'
import { Banner, Button, Card, Screen } from '../ui'

function PrintButtons({ policy }: { policy: LocalPolicy }) {
  const [files, setFiles] = useState<Record<CertificateFormat, File> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Render both PDFs as soon as the buttons show: Chrome refuses to open the share
  // sheet if the tap was more than a few seconds ago, and the first render is slow.
  useEffect(() => {
    let live = true
    // the PDF renderer is large; load it when a certificate is shown, not at startup
    import('@/lib/agent-app/print')
      .then(async ({ certificateFile }) => {
        const [receipt, a4] = await Promise.all([certificateFile(policy, 'receipt'), certificateFile(policy, 'a4')])
        if (live) setFiles({ receipt, a4 })
      })
      .catch((e: Error) => { if (live) setError(`Could not prepare the certificate: ${e.message}`) })
    return () => { live = false }
  }, [policy])

  async function share(format: CertificateFormat) {
    if (!files) return
    setError(null)
    try {
      const { shareFile } = await import('@/lib/agent-app/print')
      await shareFile(files[format])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => share('receipt')} disabled={!files}>{files ? 'Receipt' : 'Preparing…'}</Button>
        <Button variant="outline" onClick={() => share('a4')} disabled={!files}>{files ? 'A4' : 'Preparing…'}</Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  )
}

export function PolicyDone({ policy, onHome, onAnother }: { policy: LocalPolicy; onHome: () => void; onAnother: () => void }) {
  const d = policy.data as Record<string, string>
  const cardPayment = policy.data.card_payment as { tier: string } | undefined
  return (
    <Screen title="Policy issued" onBack={onHome}>
      <Card className="space-y-1 text-center">
        <p className="text-sm text-gray-500">Policy number</p>
        <p className="font-mono text-2xl font-bold">{policy.policy_number}</p>
        <p className="text-lg">{Number(d.premium_amount).toFixed(2)} {d.currency}</p>
        <p className="text-sm text-gray-500">{d.plate_number} · {d.start_date} to {d.end_date}</p>
      </Card>
      {cardPayment?.tier === 'ISSUE_WITH_FLAG' && (
        <Banner tone="warn">Card payment accepted with a review flag. Finance will check the slip.</Banner>
      )}
      {cardPayment?.tier === 'AUTO_PASS' && <Banner tone="ok">Card payment verified.</Banner>}
      {!cardPayment && (
        <Banner tone="info">Paid from your virtual credit: {Number(d.premium_amount).toFixed(2)} {d.currency} was deducted from your balance.</Banner>
      )}
      {policy.issued_offline && (
        <Banner tone="info">Saved on this device. It syncs automatically when the device is online.</Banner>
      )}
      <PrintButtons policy={policy} />
      <Button variant="outline" onClick={onAnother}>New policy</Button>
      <Button variant="ghost" onClick={onHome}>Home</Button>
    </Screen>
  )
}

export function PolicyList({ onBack }: { onBack: () => void }) {
  const { agent } = useServices()
  const [policies, setPolicies] = useState<LocalPolicy[]>([])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { agent.listPolicies(100).then(setPolicies) }, [agent])

  return (
    <Screen title="Issued on this device" onBack={onBack}>
      {policies.length === 0 && <p className="text-center text-gray-500">No policies yet.</p>}
      {policies.map((p) => {
        const d = p.data as Record<string, string>
        return (
          <Card key={p.client_uuid} className="space-y-3">
            <button className="w-full text-left" onClick={() => setOpen(open === p.client_uuid ? null : p.client_uuid)}>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{p.policy_number}</span>
                {p.issued_offline && !p.synced && (
                  <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-800">waiting to sync</span>
                )}
              </div>
              <p className="text-sm text-gray-500">{d.plate_number} · {d.client_name} · {new Date(p.created_at).toLocaleString('en-GB')}</p>
            </button>
            {open === p.client_uuid && <PrintButtons policy={p} />}
          </Card>
        )
      })}
    </Screen>
  )
}
