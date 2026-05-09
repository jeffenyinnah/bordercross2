import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'qrcode', 'canvas'],
}

export default nextConfig
