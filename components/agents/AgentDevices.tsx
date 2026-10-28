'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { revokeDevice } from '@/lib/actions/agents'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'
import type { Device, NumberLease, OfflineCreditLease } from '@/lib/types'

interface AgentDevicesProps {
  agentId: string
  devices: Device[]
  numberLeases: NumberLease[]
  creditLeases: OfflineCreditLease[]
  canRevoke: boolean
}

/** Phones the agent has set up, with what each holds for offline sales. */
export function AgentDevices({ agentId, devices, numberLeases, creditLeases, canRevoke }: AgentDevicesProps) {
  const [target, setTarget] = useState<Device | null>(null)
  const [isPending, startTransition] = useTransition()

  function revoke() {
    if (!target) return
    startTransition(async () => {
      const result = await revokeDevice(target.id, agentId)
      if (result.success) {
        toast.success('Phone blocked')
        setTarget(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  if (!devices.length) {
    return <p className="text-gray-400 text-sm text-center py-4">No phone set up yet. The agent signs in at /agent on their Android phone.</p>
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Phone</TableHead>
              <TableHead>Set up</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Offline numbers left</TableHead>
              <TableHead>Offline credit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => {
              const blocks = numberLeases.filter((l) => l.device_id === d.id && !l.closed_at)
              const numbersLeft = blocks.reduce((n, l) => n + l.end_seq - (l.last_used_seq ?? l.start_seq - 1), 0)
              const credit = creditLeases.filter((c) => c.device_id === d.id && c.status === 'active')
              const creditLeft = credit.reduce((n, c) => n + Number(c.reserved) - Number(c.consumed), 0)
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.model || (d.platform === 'android' ? 'Android phone' : 'Browser')}</div>
                    <div className="text-xs text-gray-400">
                      {d.platform}{d.app_version ? ` · app ${d.app_version}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">{formatDateTime(d.registered_at)}</TableCell>
                  <TableCell className="text-sm text-gray-500">{d.last_seen_at ? formatDateTime(d.last_seen_at) : '—'}</TableCell>
                  <TableCell className="text-sm">
                    {blocks.length ? (
                      <span title={blocks.map((l) => `${l.border_code} ${l.start_seq}–${l.end_seq}`).join(', ')}>
                        {numbersLeft} ({blocks.map((l) => l.border_code).join(', ')})
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{credit.length ? formatCurrency(creditLeft) : '—'}</TableCell>
                  <TableCell>
                    {d.revoked_at
                      ? <Badge className="bg-red-100 text-red-800">Blocked {formatDateTime(d.revoked_at)}</Badge>
                      : <Badge className="bg-green-100 text-green-800">Active</Badge>}
                  </TableCell>
                  <TableCell>
                    {canRevoke && !d.revoked_at && (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setTarget(d)}>
                        Block
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Block this phone?"
        description="Use this for a lost, stolen or replaced phone. It can no longer download data, reserve policy numbers or credit, or issue online. Offline sales already on the phone can't reach the server from it; the agent sets up their new phone by signing in there."
        confirmLabel="Block phone"
        onConfirm={revoke}
        loading={isPending}
      />
    </>
  )
}
