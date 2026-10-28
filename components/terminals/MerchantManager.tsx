'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createMerchant, updateMerchant } from '@/lib/actions/terminals'
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
import { Pencil, Plus } from 'lucide-react'
import type { MerchantAccount } from '@/lib/types'

export function MerchantManager({ insurerId, merchants, readOnly = false }: {
  insurerId: string
  merchants: MerchantAccount[]
  readOnly?: boolean
}) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggle(m: MerchantAccount) {
    setPendingId(m.id)
    startTransition(async () => {
      const result = await updateMerchant(m.id, { is_active: !m.is_active })
      setPendingId(null)
      if (result.success) toast.success(m.is_active ? 'Merchant account deactivated' : 'Merchant account reactivated')
      else toast.error(result.error)
    })
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex justify-end">
          <MerchantDialog insurerId={insurerId} />
        </div>
      )}
      {!merchants.length ? (
        <p className="text-gray-400 text-sm text-center py-4">No merchant account yet. Add the MID printed on the slips.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>MID</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {merchants.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono">{m.mid}</TableCell>
                  <TableCell>{m.bank}</TableCell>
                  <TableCell className="text-gray-500">{m.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge className={m.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                      {m.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!readOnly && (
                      <>
                        <MerchantDialog insurerId={insurerId} merchant={m} />
                        <Button variant="ghost" size="sm" disabled={pendingId === m.id} onClick={() => toggle(m)}
                          className={m.is_active ? 'text-red-600' : 'text-green-700'}>
                          {m.is_active ? 'Deactivate' : 'Reactivate'}
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

function MerchantDialog({ insurerId, merchant }: { insurerId: string; merchant?: MerchantAccount }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    const bank = fd.get('bank') as string
    const name = (fd.get('name') as string) || undefined
    startTransition(async () => {
      const result = merchant
        ? await updateMerchant(merchant.id, { bank, name: name ?? null })
        : await createMerchant({ insurer_id: insurerId, mid: fd.get('mid') as string, bank, name })
      if (result.success) {
        toast.success(merchant ? 'Merchant account saved' : 'Merchant account added')
        setOpen(false)
      } else {
        setError(result.error ?? 'Failed to save')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={merchant ? <Button variant="ghost" size="sm" /> : <Button variant="outline" size="sm" />}>
        {merchant ? <Pencil className="w-4 h-4" /> : <><Plus className="w-4 h-4 mr-1.5" />Add MID</>}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{merchant ? `Merchant account ${merchant.mid}` : 'New merchant account'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!merchant && (
            <div className="space-y-1.5">
              <Label htmlFor="m_mid">MID *</Label>
              <Input id="m_mid" name="mid" required inputMode="numeric" pattern="[0-9]{15}" maxLength={15}
                placeholder="15 digits" className="font-mono" />
              <p className="text-xs text-gray-500">Printed on the slip. It can&apos;t be changed later.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="m_bank">Bank *</Label>
            <Input id="m_bank" name="bank" required defaultValue={merchant?.bank} placeholder="e.g. BCI" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m_name">Merchant name</Label>
            <Input id="m_name" name="name" defaultValue={merchant?.name ?? ''} placeholder="As printed on the slip" />
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
