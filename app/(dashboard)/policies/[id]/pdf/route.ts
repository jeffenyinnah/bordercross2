import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { PolicyCertificateA4, PolicyReceipt, verificationUrl } from '@bordercross/certificate'
import { createClient } from '@/lib/supabase/server'
import { branding } from '@/lib/branding'
import QRCode from 'qrcode'
import React from 'react'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const format = request.nextUrl.searchParams.get('format') ?? 'a4'

  const supabase = await createClient()

  const { data: policy } = await supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(*), agent:profiles!agent_id(full_name, email)')
    .eq('id', id)
    .single()

  if (!policy) {
    return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
  }

  // QR opens the public verification page (border officials have no login)
  let qrDataUrl: string | undefined
  try {
    qrDataUrl = await QRCode.toDataURL(
      verificationUrl(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin, policy.verification_token),
      { width: 150, margin: 1, color: { dark: '#000000', light: '#ffffff' } }
    )
  } catch {
    // QR generation is non-critical — proceed without it
  }

  const brand = { appName: branding.appName, color: branding.brandColor }
  const element = format === 'receipt'
    ? React.createElement(PolicyReceipt, { policy, brand, qrDataUrl })
    : React.createElement(PolicyCertificateA4, { policy, brand, qrDataUrl })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)
  const suffix = format === 'receipt' ? 'Receipt' : 'A4'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${policy.policy_number}-${suffix}.pdf"`,
    },
  })
}
