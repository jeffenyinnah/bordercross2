import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { PolicyCertificateA4, PolicyReceipt } from '@/components/policies/PolicyCertificate'
import { createClient } from '@/lib/supabase/server'
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

  // Generate QR code as PNG data URL
  let qrDataUrl: string | undefined
  try {
    qrDataUrl = await QRCode.toDataURL(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL ? request.nextUrl.origin : ''}/policies/${id}`,
      { width: 150, margin: 1, color: { dark: '#000000', light: '#ffffff' } }
    )
  } catch {
    // QR generation is non-critical — proceed without it
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let element: any
  if (format === 'receipt') {
    element = React.createElement(PolicyReceipt, { policy, qrDataUrl })
  } else {
    element = React.createElement(PolicyCertificateA4, { policy, qrDataUrl })
  }

  const buffer = await renderToBuffer(element)
  const suffix = format === 'receipt' ? 'Receipt' : 'A4'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${policy.policy_number}-${suffix}.pdf"`,
    },
  })
}
