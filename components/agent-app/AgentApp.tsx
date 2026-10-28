'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardQuote } from '@/lib/agent-app/agent'
import { warmUpOcr } from '@/lib/agent-app/ocr'
import { clearPin, hasPin } from '@/lib/agent-app/pin'
import { requestPersistence } from '@/lib/agent-app/store/idb'
import type { LocalPolicy } from '@/lib/agent-app/store/types'
import { useOnline } from '@/lib/agent-app/useOnline'
import { CardPayment } from './screens/CardPayment'
import { Home } from './screens/Home'
import { Activate, SignIn } from './screens/Login'
import { NewPolicy } from './screens/NewPolicy'
import { SetPin, Unlock } from './screens/Pin'
import { PolicyDone, PolicyList } from './screens/Policies'
import { config } from '@/lib/agent-app/config'
import { startServiceWorker } from '@/lib/agent-app/pwa'
import { createServices, isAndroid, ServicesContext, useServices, type Services } from '@/lib/agent-app/services'

type Route =
  | { name: 'boot' }
  | { name: 'signin'; notice?: string }
  | { name: 'activate'; notice?: string }
  | { name: 'set-pin' }
  | { name: 'unlock' }
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'card'; quote: CardQuote }
  | { name: 'done'; policy: LocalPolicy }
  | { name: 'policies' }

/** Lock the app when it was in the background longer than this. */
const LOCK_AFTER_MS = 5 * 60_000
/** While online on the home screen, push queued sales this often. */
const SYNC_EVERY_MS = 2 * 60_000

function App() {
  const { agent, store } = useServices()
  const online = useOnline()
  const [route, setRoute] = useState<Route>({ name: 'boot' })
  const [warnings, setWarnings] = useState<string[]>([])
  const [syncRun, setSyncRun] = useState(0)
  const pausedAt = useRef<number | null>(null)

  const firstRoute = useCallback(async (): Promise<Route> => {
    switch (await agent.bootState()) {
      case 'needs-login': return { name: 'signin' }
      case 'needs-activation': return { name: 'activate' }
      case 'expired': return { name: 'activate', notice: 'Offline use has expired. Connect to the internet to continue.' }
      case 'ready': return await hasPin(store) ? { name: 'unlock' } : { name: 'set-pin' }
    }
  }, [agent, store])

  useEffect(() => { firstRoute().then(setRoute) }, [firstRoute])

  // lock after a long pause; refresh prices and leases whenever the app comes back online
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedAt.current = Date.now()
        return
      }
      const away = pausedAt.current ? Date.now() - pausedAt.current : 0
      pausedAt.current = null
      if (away > LOCK_AFTER_MS) setRoute((r) => (['boot', 'signin', 'activate'].includes(r.name) ? r : { name: 'unlock' }))
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // once signed in: keep unsynced sales safe from eviction, and load OCR before the first card sale
  const signedIn = route.name === 'home'
  useEffect(() => {
    if (!signedIn) return
    requestPersistence().catch(() => {})
    warmUpOcr()
  }, [signedIn])

  // push queued sales and pull fresh data when the app comes back online, then periodically
  useEffect(() => {
    if (!online || route.name !== 'home') return
    let live = true
    const run = () => agent.sync()
      .then((r) => {
        if (!live) return
        setWarnings(r.warnings)
        setSyncRun((n) => n + 1)
      })
      .catch(() => {})
    run()
    const timer = setInterval(run, SYNC_EVERY_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [online, route.name, agent])

  switch (route.name) {
    case 'boot':
      return null
    case 'signin':
      return <SignIn notice={route.notice} />
    case 'activate':
      return (
        <Activate
          online={online}
          notice={route.notice}
          onDone={async (w) => { setWarnings(w); setRoute(await hasPin(store) ? { name: 'unlock' } : { name: 'set-pin' }) }}
        />
      )
    case 'set-pin':
      return <SetPin onDone={() => setRoute({ name: 'home' })} />
    case 'unlock':
      return (
        <Unlock
          onDone={() => setRoute({ name: 'home' })}
          onLocked={async () => {
            // the agent's password is now needed to set a new PIN
            await clearPin(store)
            await agent.signOut()
            setRoute({ name: 'signin', notice: 'Too many wrong PINs. Sign in again with internet.' })
          }}
        />
      )
    case 'home':
      return (
        <Home
          online={online}
          warnings={warnings}
          syncRun={syncRun}
          onNew={() => setRoute({ name: 'new' })}
          onPolicies={() => setRoute({ name: 'policies' })}
          onLogout={() => window.location.assign('/login')}
        />
      )
    case 'new':
      return (
        <NewPolicy
          online={online}
          onBack={() => setRoute({ name: 'home' })}
          onIssued={(policy) => setRoute({ name: 'done', policy })}
          onCard={(quote) => setRoute({ name: 'card', quote })}
        />
      )
    case 'card':
      return (
        <CardPayment
          quote={route.quote}
          onCancel={() => setRoute({ name: 'home' })}
          onIssued={(policy) => setRoute({ name: 'done', policy })}
        />
      )
    case 'done':
      return <PolicyDone policy={route.policy} onHome={() => setRoute({ name: 'home' })} onAnother={() => setRoute({ name: 'new' })} />
    case 'policies':
      return <PolicyList onBack={() => setRoute({ name: 'home' })} />
  }
}

/**
 * The agent app at /agent: client-only, offline-first, Android phones.
 * Everything lives on the device (IndexedDB); nothing here renders on the server.
 */
export function AgentApp() {
  const [services, setServices] = useState<Services | null>(null)
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null)

  useEffect(() => {
    // agents work on Android phones only; development builds also run on a desktop
    const supported = isAndroid() || process.env.NODE_ENV !== 'production'
    if (supported) startServiceWorker()
    createServices().then(
      (s) => supported ? setServices(s) : setProblem({
        title: `${config.appName} Agent`,
        text: 'This app works on Android phones only. Open this page in Chrome on your Android phone, then use Install app.',
      }),
      (e: Error) => setProblem({
        title: 'Storage unavailable',
        text: `The app could not open its local storage (${e.message}). Do not use a private/incognito tab.`,
      }),
    )
  }, [])

  if (problem) {
    return (
      <div className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">{problem.title}</h1>
        <p>{problem.text}</p>
      </div>
    )
  }
  if (!services) return null
  return (
    <ServicesContext.Provider value={services}>
      <App />
    </ServicesContext.Provider>
  )
}
