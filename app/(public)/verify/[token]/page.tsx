import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { branding } from '@/lib/branding'

export const metadata: Metadata = {
  title: `Verify policy — ${branding.appName}`,
  robots: { index: false, follow: false },
}

interface Verification {
  valid: boolean
  status: string
  synced: boolean
  issued_offline: boolean
  policy_number: string
  plate_number: string
  vehicle: string
  start_date: string
  end_date: string
  insurer: string
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB')
}

// Public page opened from the certificate QR. It uses the anon key on purpose:
// verify_policy returns validity, plate and dates only, never client data.
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data } = await supabase.rpc('verify_policy', { p_token: token })
  const v = data as Verification | null

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <p className="text-center text-sm font-semibold" style={{ color: branding.brandColor }}>
        {branding.appName} · Policy verification
      </p>
      {!v ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle className="size-8 shrink-0 text-amber-500" />
            <CardTitle>Policy not found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>No policy matches this code.</p>
            <p>
              Policies issued without internet at a border post appear here once the agent&apos;s
              device has synchronised, usually within a few hours. If in doubt, contact the insurer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            {v.valid
              ? <CheckCircle2 className="size-8 shrink-0 text-green-600" />
              : <XCircle className="size-8 shrink-0 text-red-600" />}
            <div>
              <CardTitle>{v.valid ? 'Valid policy' : 'Not valid'}</CardTitle>
              <p className="text-sm text-muted-foreground capitalize">Status: {v.status}</p>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Policy</dt><dd className="font-mono">{v.policy_number}</dd>
              <dt className="text-muted-foreground">Plate</dt><dd className="font-mono">{v.plate_number}</dd>
              <dt className="text-muted-foreground">Vehicle</dt><dd>{v.vehicle}</dd>
              <dt className="text-muted-foreground">Period</dt><dd>{fmt(v.start_date)} – {fmt(v.end_date)}</dd>
              <dt className="text-muted-foreground">Insurer</dt><dd>{v.insurer}</dd>
            </dl>
            {!v.synced && (
              <p className="mt-4 text-xs text-muted-foreground">
                Issued offline; payment is still being confirmed with the insurer.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
