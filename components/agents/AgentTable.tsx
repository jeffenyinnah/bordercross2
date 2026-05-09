'use client'

import Link from 'next/link'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils/currency'
import { Users } from 'lucide-react'
import type { Profile, CreditWallet } from '@/lib/types'

interface AgentRow extends Profile {
  wallet?: CreditWallet | null
  parent?: Pick<Profile, 'full_name'> | null
}

interface AgentTableProps {
  agents: AgentRow[]
}

export function AgentTable({ agents }: AgentTableProps) {
  if (!agents.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <Users className="w-12 h-12 mb-3 opacity-30" />
        <p className="font-medium">No agents found</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead>MZN Balance</TableHead>
            <TableHead>ZAR Balance</TableHead>
            <TableHead>USD Balance</TableHead>
            <TableHead>Commission</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id} className="hover:bg-gray-50">
              <TableCell>
                <Link
                  href={`/agents/${agent.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {agent.full_name}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-gray-600">{agent.email}</TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">{agent.role}</Badge>
              </TableCell>
              <TableCell className="text-sm text-gray-500">
                {agent.parent?.full_name ?? '—'}
              </TableCell>
              <TableCell>{formatCurrency(agent.wallet?.balance_mzn ?? 0, 'MZN')}</TableCell>
              <TableCell>{formatCurrency(agent.wallet?.balance_zar ?? 0, 'ZAR')}</TableCell>
              <TableCell>{formatCurrency(agent.wallet?.balance_usd ?? 0, 'USD')}</TableCell>
              <TableCell>{agent.commission_rate}%</TableCell>
              <TableCell>
                <Badge className={agent.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                  {agent.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
