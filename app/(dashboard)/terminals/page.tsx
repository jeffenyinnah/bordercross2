import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InsurerPicker } from '@/components/terminals/InsurerPicker'
import { MerchantManager } from '@/components/terminals/MerchantManager'
import { TerminalManager } from '@/components/terminals/TerminalManager'
import type { MerchantAccount, Terminal } from '@/lib/types'

export default async function TerminalsPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>
}) {
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  const isAdmin = profile.role === 'admin'
  const supabase = await createClient()

  const { data: insurers } = isAdmin
    ? await supabase.from('insurers').select('id, name').order('name')
    : { data: null }
  const requested = (await searchParams).insurer
  const insurerId = isAdmin
    ? (insurers?.find((i) => i.id === requested) ?? insurers?.[0])?.id ?? null
    : profile.insurer_id

  if (!insurerId) {
    return <p className="text-gray-500">No insurer is set up yet.</p>
  }

  const [{ data: merchants }, { data: terminals }, { data: agents }, { data: borderPosts }] = await Promise.all([
    supabase.from('merchant_accounts').select('*').eq('insurer_id', insurerId).order('mid'),
    supabase.from('terminals').select('*').eq('insurer_id', insurerId).order('tid'),
    supabase.from('profiles').select('id, full_name')
      .eq('role', 'agent').eq('insurer_id', insurerId).eq('is_active', true).order('full_name'),
    supabase.from('border_posts').select('id, name').eq('is_active', true).order('name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">POS Terminals</h1>
          <p className="text-gray-500 text-sm mt-0.5 max-w-2xl">
            Phones accept a card slip only when its terminal (TID) and merchant account (MID) are listed here and active.
            Changes reach the phones on their next refresh.
          </p>
        </div>
        {isAdmin && insurers && insurers.length > 1 && <InsurerPicker insurers={insurers} value={insurerId} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Merchant accounts (MID)</CardTitle>
          <p className="text-sm text-gray-500">The insurer&apos;s accounts with the acquiring bank. Every terminal belongs to one.</p>
        </CardHeader>
        <CardContent>
          <MerchantManager insurerId={insurerId} merchants={(merchants ?? []) as MerchantAccount[]} readOnly={isAdmin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Terminals (TID)</CardTitle>
          <p className="text-sm text-gray-500">Assign each terminal to the agent and border post that use it.</p>
        </CardHeader>
        <CardContent>
          <TerminalManager
            insurerId={insurerId}
            terminals={(terminals ?? []) as Terminal[]}
            merchants={((merchants ?? []) as MerchantAccount[]).filter((m) => m.is_active)}
            agents={agents ?? []}
            borderPosts={borderPosts ?? []}
            readOnly={isAdmin}
          />
        </CardContent>
      </Card>
    </div>
  )
}
