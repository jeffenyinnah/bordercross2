import { branding } from '@/lib/branding'

// Install manifest for the agent PWA. Served outside the auth proxy: Chrome fetches
// manifests without cookies.
export const dynamic = 'force-static'

export function GET() {
  return Response.json({
    name: `${branding.appName} Agent`,
    short_name: `${branding.appName} Agent`,
    description: 'Issue border vehicle insurance, online or offline.',
    id: '/agent',
    start_url: '/agent',
    scope: '/agent',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: branding.brandColor,
    icons: [
      { src: '/agent/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/agent/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/agent/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/agent/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json' } })
}
