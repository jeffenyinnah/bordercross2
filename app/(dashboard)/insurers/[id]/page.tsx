import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { parseInsurerSettings } from '@bordercross/core'
import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { InsurerDetailsForm } from '@/components/insurers/InsurerDetailsForm'
import { InsurerSettingsForm } from '@/components/insurers/InsurerSettingsForm'
import { StaffManager } from '@/components/insurers/StaffManager'
import { ArrowLeft } from 'lucide-react'
import type { Insurer, Profile } from '@/lib/types'

export default async function InsurerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  const isAdmin = profile.role === 'admin'
  if (!isAdmin && profile.insurer_id !== id) redirect(`/insurers/${profile.insurer_id}`)

  const supabase = await createClient()
  const [{ data: insurer }, { data: staff }, { count: terminalCount }] = await Promise.all([
    supabase.from('insurers').select('*').eq('id', id).single(),
    supabase.from('profiles').select('*')
      .eq('insurer_id', id).in('role', ['insurer_admin', 'finance']).order('full_name'),
    supabase.from('terminals').select('id', { count: 'exact', head: true })
      .eq('insurer_id', id).eq('is_active', true),
  ])
  if (!insurer) notFound()
  const ins = insurer as Insurer

  return (
    <div className="space-y-6 max-w-4xl">
      {isAdmin && (
        <Link href="/insurers" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Insurers
        </Link>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{ins.name}</h1>
          <p className="text-gray-500 text-sm font-mono">{ins.code}</p>
        </div>
        <Badge className={ins.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
          {ins.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent><InsurerDetailsForm insurer={ins} /></CardContent>
        </Card>
      )}

      <InsurerSettingsForm
        insurerId={ins.id}
        paymentMethods={ins.payment_methods}
        settings={parseInsurerSettings(ins.settings)}
        activeTerminals={terminalCount ?? 0}
        readOnly={isAdmin}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Staff logins</CardTitle>
          <p className="text-sm text-gray-500">
            Insurer admins run the insurer: agents, top-ups, prices, terminals and these settings. Finance staff see
            reports and review card payments.
          </p>
        </CardHeader>
        <CardContent>
          <StaffManager insurerId={ins.id} staff={(staff ?? []) as Profile[]} currentUserId={profile.id} />
        </CardContent>
      </Card>
    </div>
  )
}
