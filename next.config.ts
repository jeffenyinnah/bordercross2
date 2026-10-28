import path from 'node:path'
import type { NextConfig } from 'next'
import { withSerwist } from '@serwist/turbopack'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'qrcode', 'canvas'],
  transpilePackages: ['@bordercross/core', '@bordercross/certificate'],
  // Pin the workspace root: a stray package-lock.json in the user's home folder
  // otherwise makes Turbopack treat the whole home directory as the project.
  turbopack: { root: path.resolve(import.meta.dirname) },
  async headers() {
    return [
      {
        // the agent worker lives at /serwist/sw.js but controls /agent
        source: '/serwist/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/agent' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ]
  },
}

export default withSerwist(nextConfig)
