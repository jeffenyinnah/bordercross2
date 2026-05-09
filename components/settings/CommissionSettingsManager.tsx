'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateCommissionDefaults } from '@/lib/actions/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Check, X } from 'lucide-react'

interface AgentRow {
  id: string
  full_name: string
  commission_rate: number
  sub_agent_override_rate: number
  role: string
}

interface CommissionSettingsManagerProps {
  agents: AgentRow[]
}

export function CommissionSettingsManager({ agents }: CommissionSettingsManagerProps) {
  const [editId, setEditId] = useState<string | null>(null)
  const [editRate, setEditRate] = useState('')
  const [editOverride, setEditOverride] = useState('')
  const [isPending, startTransition] = useTransition()

  function startEdit(agent: AgentRow) {
    setEditId(agent.id)
    setEditRate(String(agent.commission_rate))
    setEditOverride(String(agent.sub_agent_override_rate))
  }

  function cancelEdit() {
    setEditId(null)
    setEditRate('')
    setEditOverride('')
  }

  function saveEdit(agent: AgentRow) {
    startTransition(async () => {
      const result = await updateCommissionDefaults(agent.id, Number(editRate), Number(editOverride))
      if (result.success) {
        toast.success(`Commission rates updated for ${agent.full_name}`)
        cancelEdit()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Set commission rates per agent. Changes only affect new policies.
      </p>
      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Agent</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Commission Rate (%)</TableHead>
              <TableHead>Override Rate (%)</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-medium">{agent.full_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">{agent.role}</Badge>
                </TableCell>
                <TableCell>
                  {editId === agent.id ? (
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={editRate}
                      onChange={(e) => setEditRate(e.target.value)}
                      className="w-24 h-8"
                      autoFocus
                    />
                  ) : (
                    `${agent.commission_rate}%`
                  )}
                </TableCell>
                <TableCell>
                  {editId === agent.id ? (
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={editOverride}
                      onChange={(e) => setEditOverride(e.target.value)}
                      className="w-24 h-8"
                    />
                  ) : (
                    `${agent.sub_agent_override_rate}%`
                  )}
                </TableCell>
                <TableCell>
                  {editId === agent.id ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-green-700"
                        disabled={isPending}
                        onClick={() => saveEdit(agent)}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => startEdit(agent)}>
                      Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
