import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { branding } from '@/lib/branding'
import './globals.css'

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: `${branding.appName} — Border Insurance Platform`,
  description: 'Third-Party Vehicle Insurance Issuance System for Mozambican Border Posts',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <head>
        {/* Inject brand color as CSS variable — overrides globals.css :root */}
        <style>{`:root { --brand: ${branding.brandColor}; }`}</style>
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
