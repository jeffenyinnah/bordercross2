'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createTerminal, updateTerminal } from '@/lib/actions/terminals'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormSelect } from '@/components/shared/FormSelect'
import { Pencil, Plus } from 'lucide-react'
import type { MerchantAccount, Terminal } from '@/lib/types'

type Option = { id: string; name?: string; full_name?: string }

interface Props {
  insurerId: string
  terminals: Terminal[]
  /** active merchant accounts */
  merchants: MerchantAccount[]
  agents: { id: string; full_name: string }[]
  borderPosts: { id: string; name: string }[]
  /** the platform admin views an insurer's terminals without changing them */
  readOnly?: boolean
}

export function TerminalManager({ insurerId, terminals, merchants, agents, borderPosts, readOnly = false }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const nameOf = (list: Option[], id: string | null) =>
    id ? (list.find((o) => o.id === id)?.full_name ?? list.find((o) => o.id === id)?.name ?? 'Inactive') : '—'

  function toggle(t: Terminal) {
    setPendingId(t.id)
    startTransition(async () => {
      const result = await updateTerminal(t.id, { is_active: !t.is_active })
      setPendingId(null)
      if (result.success) toast.success(t.is_active ? 'Terminal deactivated' : 'Terminal reactivated')
      else toast.error(result.error)
    })
  }

  const dialogProps = { insurerId, merchants, agents, borderPosts }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex justify-end">
          <TerminalDialog {...dialogProps} />
        </div>
      )}
      {!terminals.length ? (
        <p className="text-gray-400 text-sm text-center py-4">No terminal yet. Add a merchant account first, then its terminals.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>TID</TableHead>
                <TableHead>MID</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Border post</TableHead>
                <TableHead>Last receipt no.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminals.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono">{t.tid}</TableCell>
                  <TableCell className="font-mono text-sm text-gray-500">{t.mid}</TableCell>
                  <TableCell>{t.bank}</TableCell>
                  <TableCell>{nameOf(agents, t.assigned_agent_id)}</TableCell>
                  <TableCell>{nameOf(borderPosts, t.border_post_id)}</TableCell>
                  <TableCell className="text-sm text-gray-500">{t.last_recibo ?? '—'}</TableCell>
                  <TableCell>
                    <Badge className={t.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!readOnly && (
                      <>
                        <TerminalDialog {...dialogProps} terminal={t} />
                        <Button variant="ghost" size="sm" disabled={pendingId === t.id} onClick={() => toggle(t)}
                          className={t.is_active ? 'text-red-600' : 'text-green-700'}>
                          {t.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function TerminalDialog({
  insurerId, merchants, agents, borderPosts, terminal,
}: Omit<Props, 'terminals'> & { terminal?: Terminal }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mid, setMid] = useState(terminal?.mid ?? merchants[0]?.mid ?? '')
  const [bank, setBank] = useState(terminal?.bank ?? merchants[0]?.bank ?? '')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    const assignment = {
      bank,
      assigned_agent_id: (fd.get('assigned_agent_id') as string) || null,
      border_post_id: (fd.get('border_post_id') as string) || null,
    }
    startTransition(async () => {
      const result = terminal
        ? await updateTerminal(terminal.id, assignment)
        : await createTerminal({
          insurer_id: insurerId, tid: (fd.get('tid') as string).replace(/[\s-]/g, ''), mid, ...assignment,
        })
      if (result.success) {
        toast.success(terminal ? 'Terminal saved' : 'Terminal added')
        setOpen(false)
      } else {
        setError(result.error ?? 'Failed to save')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={terminal ? <Button variant="ghost" size="sm" /> : <Button variant="outline" size="sm" disabled={!merchants.length} />}
      >
        {terminal ? <Pencil className="w-4 h-4" /> : <><Plus className="w-4 h-4 mr-1.5" />Add terminal</>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{terminal ? `Terminal ${terminal.tid}` : 'New terminal'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!terminal && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="t_tid">TID *</Label>
                <Input id="t_tid" name="tid" required inputMode="numeric"
                  placeholder="e.g. 00236255" className="font-mono" />
                <p className="text-xs text-gray-500">
                  Exactly 8 digits, as printed after <strong>TID</strong> on the slip. TID and MID can&apos;t be changed later.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t_mid">Merchant account (MID) *</Label>
                <FormSelect id="t_mid" required value={mid} onChange={(e) => {
                  setMid(e.target.value)
                  setBank(merchants.find((m) => m.mid === e.target.value)?.bank ?? bank)
                }}>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.mid}>{m.mid} · {m.bank}{m.name ? ` · ${m.name}` : ''}</option>
                  ))}
                </FormSelect>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="t_bank">Bank *</Label>
            <Input id="t_bank" required value={bank} onChange={(e) => setBank(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t_agent">Assigned agent</Label>
            <FormSelect id="t_agent" name="assigned_agent_id" defaultValue={terminal?.assigned_agent_id ?? ''}>
              <option value="">Not assigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </FormSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t_border">Border post</Label>
            <FormSelect id="t_border" name="border_post_id" defaultValue={terminal?.border_post_id ?? ''}>
              <option value="">Not assigned</option>
              {borderPosts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FormSelect>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
