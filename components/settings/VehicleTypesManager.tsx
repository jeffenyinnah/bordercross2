'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { upsertVehicleType, deleteVehicleType } from '@/lib/actions/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Pencil, Trash2, Plus } from 'lucide-react'
import type { VehicleType } from '@/lib/types'

interface VehicleTypesManagerProps {
  vehicleTypes: VehicleType[]
}

interface VehicleTypeFormProps {
  initial?: Partial<VehicleType>
  onClose: () => void
}

function VehicleTypeForm({ initial, onClose }: VehicleTypeFormProps) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const getNum = (key: string) => {
      const v = fd.get(key) as string
      return v ? Number(v) : null
    }

    startTransition(async () => {
      const result = await upsertVehicleType({
        id: initial?.id,
        name: fd.get('name') as string,
        description: (fd.get('description') as string) || null,
        price_mzn: Number(fd.get('price_mzn')),
        price_zar: Number(fd.get('price_zar')),
        price_usd: Number(fd.get('price_usd')),
        price_mzn_annual: getNum('price_mzn_annual'),
        price_zar_annual: getNum('price_zar_annual'),
        price_usd_annual: getNum('price_usd_annual'),
      })
      if (result.success) {
        toast.success(initial?.id ? 'Vehicle type updated' : 'Vehicle type created')
        onClose()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name *</Label>
        <Input id="name" name="name" required defaultValue={initial?.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Input id="description" name="description" defaultValue={initial?.description ?? ''} />
      </div>
      <div className="text-sm font-medium text-gray-700 pt-2">Monthly Prices</div>
      <div className="grid grid-cols-3 gap-3">
        {['mzn', 'zar', 'usd'].map((cur) => (
          <div key={cur} className="space-y-1">
            <Label htmlFor={`price_${cur}`} className="text-xs">{cur.toUpperCase()}</Label>
            <Input
              id={`price_${cur}`}
              name={`price_${cur}`}
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={initial?.[`price_${cur}` as keyof VehicleType] as number ?? ''}
            />
          </div>
        ))}
      </div>
      <div className="text-sm font-medium text-gray-700 pt-2">Annual Prices (optional)</div>
      <div className="grid grid-cols-3 gap-3">
        {['mzn', 'zar', 'usd'].map((cur) => (
          <div key={cur} className="space-y-1">
            <Label htmlFor={`price_${cur}_annual`} className="text-xs">{cur.toUpperCase()}</Label>
            <Input
              id={`price_${cur}_annual`}
              name={`price_${cur}_annual`}
              type="number"
              step="0.01"
              min={0}
              defaultValue={initial?.[`price_${cur}_annual` as keyof VehicleType] as number ?? ''}
              placeholder="Leave blank if N/A"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
          {isPending ? 'Saving…' : initial?.id ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

export function VehicleTypesManager({ vehicleTypes }: VehicleTypesManagerProps) {
  const [editTarget, setEditTarget] = useState<VehicleType | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VehicleType | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteVehicleType(deleteTarget.id)
      if (result.success) {
        toast.success('Vehicle type removed')
        setDeleteTarget(null)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-brand hover:bg-brand/90" />}>
            <Plus className="w-4 h-4 mr-2" />
            Add Vehicle Type
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Vehicle Type</DialogTitle>
            </DialogHeader>
            <VehicleTypeForm onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Name</TableHead>
              <TableHead>MZN/mo</TableHead>
              <TableHead>ZAR/mo</TableHead>
              <TableHead>USD/mo</TableHead>
              <TableHead>MZN/yr</TableHead>
              <TableHead>ZAR/yr</TableHead>
              <TableHead>USD/yr</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicleTypes.map((vt) => (
              <TableRow key={vt.id}>
                <TableCell className="font-medium">{vt.name}</TableCell>
                <TableCell>{vt.price_mzn.toLocaleString()}</TableCell>
                <TableCell>{vt.price_zar.toLocaleString()}</TableCell>
                <TableCell>{vt.price_usd.toLocaleString()}</TableCell>
                <TableCell>{vt.price_mzn_annual?.toLocaleString() ?? '—'}</TableCell>
                <TableCell>{vt.price_zar_annual?.toLocaleString() ?? '—'}</TableCell>
                <TableCell>{vt.price_usd_annual?.toLocaleString() ?? '—'}</TableCell>
                <TableCell>
                  <Badge className={vt.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                    {vt.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Dialog open={editTarget?.id === vt.id} onOpenChange={(o) => !o && setEditTarget(null)}>
                      <DialogTrigger render={<Button variant="ghost" size="sm" onClick={() => setEditTarget(vt)} />}>
                        <Pencil className="w-3.5 h-3.5" />
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Edit Vehicle Type</DialogTitle>
                        </DialogHeader>
                        <VehicleTypeForm initial={vt} onClose={() => setEditTarget(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => setDeleteTarget(vt)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Vehicle Type"
        description={`Remove "${deleteTarget?.name}"? If it has policies, it will be soft-deleted (set to inactive).`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        loading={isPending}
      />
    </div>
  )
}
