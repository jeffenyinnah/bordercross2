import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { PaymentMethodBadge } from '@/components/shared/PaymentBadges'
import { CreateInsurerDialog } from '@/components/insurers/CreateInsurerDialog'
import type { Insurer } from '@/lib/types'

export default async function InsurersPage() {
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  // insurer admins manage only their own insurer
  if (profile.role !== 'admin') {
    redirect(profile.insurer_id ? `/insurers/${profile.insurer_id}` : '/dashboard')
  }

  const supabase = await createClient()
  const [{ data: insurers }, { data: agents }] = await Promise.all([
    supabase.from('insurers').select('*').order('name'),
    supabase.from('profiles').select('insurer_id').eq('role', 'agent').eq('is_active', true),
  ])

  const agentCount = new Map<string, number>()
  for (const a of agents ?? []) {
    if (a.insurer_id) agentCount.set(a.insurer_id, (agentCount.get(a.insurer_id) ?? 0) + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insurers</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Each insurer has its own agents, payment methods, card terminals and staff logins
          </p>
        </div>
        <CreateInsurerDialog />
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Insurer</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Payment methods</TableHead>
              <TableHead>Active agents</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(insurers as Insurer[] | null ?? []).map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/insurers/${i.id}`} className="font-medium text-brand hover:underline">{i.name}</Link>
                </TableCell>
                <TableCell className="font-mono text-sm">{i.code}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {i.payment_methods.map((m) => <PaymentMethodBadge key={m} method={m} />)}
                  </div>
                </TableCell>
                <TableCell>{agentCount.get(i.id) ?? 0}</TableCell>
                <TableCell>
                  <Badge className={i.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                    {i.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
