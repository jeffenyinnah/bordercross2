import { useEffect, useState } from 'react'
import { Banner, Button } from '../ui'
import { config } from '@/lib/agent-app/config'
import { useServices } from '@/lib/agent-app/services'

/** Agents sign in on the shared /login page, which sends them back here. */
export function SignIn({ notice }: { notice?: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-6 p-6">
      <Brand />
      {notice && <Banner tone="warn">{notice}</Banner>}
      <Button onClick={() => window.location.assign('/login')}>Sign in</Button>
      <p className="text-center text-xs text-gray-500">The first sign-in needs internet. After that the app works offline.</p>
    </div>
  )
}

/**
 * Signed in but this phone is not set up yet (or offline use expired): register
 * the device and download prices, terminals and offline number blocks.
 */
export function Activate({ online, notice, onDone }: { online: boolean; notice?: string; onDone: (warnings: string[]) => void }) {
  const { agent } = useServices()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const busy = online && !error

  // start as soon as there is a connection, and again on "Try again"
  useEffect(() => {
    if (!online) return
    let live = true
    agent.activate().then(
      (r) => { if (live) onDone(r.warnings) },
      (e: Error) => { if (live) setError(e.message) },
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, attempt])

  function retry() {
    setError(null)
    setAttempt((a) => a + 1)
  }

  return (
    <div className="flex h-full flex-col justify-center gap-6 p-6">
      <Brand />
      {notice && <Banner tone="warn">{notice}</Banner>}
      {!online && <Banner tone="warn">Connect to the internet to set up this phone.</Banner>}
      {busy && <Banner tone="info">Setting up this phone for offline sales…</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {error && <Button onClick={retry} disabled={!online}>Try again</Button>}
      <Button variant="ghost" onClick={async () => { await agent.signOut(); window.location.assign('/login') }}>
        Sign in as someone else
      </Button>
    </div>
  )
}

function Brand() {
  return (
    <div className="text-center">
      <p className="text-3xl font-bold text-brand">{config.appName}</p>
      <p className="text-sm text-gray-500">Agent app</p>
    </div>
  )
}
