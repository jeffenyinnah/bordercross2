import { useEffect, useState } from 'react'
import type { AgentState } from '@/lib/agent-app/agent'
import { money } from '@/lib/agent-app/money'
import { installUpdate, useUpdateReady } from '@/lib/agent-app/pwa'
import { useServices } from '@/lib/agent-app/services'
import { Banner, Button, Card, Screen } from '../ui'

export function Home({ online, warnings, syncRun, onNew, onPolicies, onLogout }: {
  online: boolean
  /** from the last automatic sync */
  warnings: string[]
  /** changes after every automatic sync */
  syncRun: number
  onNew: () => void
  onPolicies: () => void
  onLogout: () => void
}) {
  const { agent } = useServices()
  const [state, setState] = useState<AgentState | null>(null)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const updateReady = useUpdateReady()
  const [persistent, setPersistent] = useState(true)

  useEffect(() => { agent.state().then(setState) }, [agent, syncRun])
  useEffect(() => { navigator.storage?.persisted?.().then(setPersistent).catch(() => {}) }, [])

  async function syncNow() {
    setBusy(true)
    setError(null)
    try {
      const report = await agent.sync()
      setMessages(report.warnings)
      setError(report.error)
      setState(await agent.state())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await agent.logout()
      onLogout()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!state) return null
  const s = state.snapshot
  const border = s.border_posts.find((b) => b.id === s.profile.border_post_id)
  const cap = agent.offlineCapacity(state, border?.code ?? '')
  const pending = state.pendingCount

  return (
    <Screen title={s.profile.full_name}>
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block size-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
        <span>{online ? 'Online' : 'Offline'}</span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">Synced {new Date(state.sync.pulledAt).toLocaleString('en-GB')}</span>
      </div>

      {updateReady && (
        <Banner tone="info">
          A new version of the app is ready.{' '}
          <button className="font-semibold underline" onClick={installUpdate}>Update now</button>
        </Banner>
      )}
      {!persistent && (
        <Banner tone="warn">Install the app (Chrome menu, then Install app) so Android keeps offline sales safely stored.</Banner>
      )}
      {agent.isStale(state) && (
        <Banner tone="warn">Prices and terminal lists are older than {state.settings.whitelist_stale_hours} h. Connect to refresh.</Banner>
      )}
      {pending > 0 && <Banner tone="info">{pending} offline sale{pending === 1 ? '' : 's'} waiting to sync.</Banner>}
      {[...new Set([...warnings, ...messages])].map((m) => <Banner key={m} tone="warn">{m}</Banner>)}
      {error && <Banner tone="error">{error}</Banner>}

      <Card className="space-y-3">
        <p className="text-sm font-medium text-gray-500">Wallet (online sales)</p>
        <p className="text-2xl font-semibold">{money(Math.round(Number(s.wallet?.balance_mzn ?? 0) * 100))}</p>
      </Card>

      <Card className="space-y-2">
        <p className="text-sm font-medium text-gray-500">Offline capacity{border ? ` · ${border.name}` : ''}</p>
        <p>Policy numbers left: <b>{cap.numbers}</b></p>
        {cap.credit > 0
          ? <p>Offline credit: <b>{money(cap.credit)}</b></p>
          : <p className="text-sm text-gray-500">No offline credit reserved. Credit sales need internet.</p>}
      </Card>

      <div className="space-y-2">
        <Button onClick={onNew}>New policy</Button>
        <Button variant="outline" onClick={onPolicies}>Issued policies</Button>
        <Button variant="outline" onClick={syncNow} disabled={!online || busy}>
          {busy ? 'Syncing…' : pending > 0 ? `Sync ${pending} sale${pending === 1 ? '' : 's'} now` : 'Sync now'}
        </Button>
        <Button variant="ghost" onClick={logout}>Log out</Button>
      </div>
    </Screen>
  )
}
