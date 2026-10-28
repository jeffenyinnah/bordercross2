import type { Metadata, Viewport } from 'next'
import { branding } from '@/lib/branding'

export const metadata: Metadata = {
  title: `${branding.appName} Agent`,
  manifest: '/agent/manifest.webmanifest',
  icons: { icon: '/agent/icon.svg', apple: '/agent/icon-192.png' },
  appleWebApp: { capable: true, title: `${branding.appName} Agent` },
}

export const viewport: Viewport = {
  themeColor: branding.brandColor,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-slate-900">
      {children}
    </div>
  )
}
