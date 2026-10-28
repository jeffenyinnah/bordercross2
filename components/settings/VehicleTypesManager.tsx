'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  deleteVehicleType, deleteVehicleTypeTemplate, upsertVehicleType, upsertVehicleTypeTemplate,
} from '@/lib/actions/settings'
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
import { formatCurrency } from '@/lib/utils/currency'
import type { VehicleType } from '@/lib/types'

type ListRow = Pick<VehicleType, 'id' | 'name' | 'description' | 'price_mzn' | 'price_mzn_annual' | 'is_active'>

/** 'insurer': the insurer's own price list. 'template': the platform default new insurers start from. */
type ListKind = 'insurer' | 'template'

const ACTIONS = {
  insurer: { upsert: upsertVehicleType, remove: deleteVehicleType },
  template: { upsert: upsertVehicleTypeTemplate, remove: deleteVehicleTypeTemplate },
}

interface VehicleTypesManagerProps {
  vehicleTypes: ListRow[]
  kind: ListKind
  /** the platform admin sees insurers' price lists without changing them */
  readOnly?: boolean
}

interface VehicleTypeFormProps {
  initial?: Partial<ListRow>
  kind: ListKind
  onClose: () => void
}

function VehicleTypeForm({ initial, kind, onClose }: VehicleTypeFormProps) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const getNum = (key: string) => {
      const v = fd.get(key) as string
      return v ? Number(v) : null
    }

    startTransition(async () => {
      const result = await ACTIONS[kind].upsert({
        id: initial?.id,
        name: fd.get('name') as string,
        description: (fd.get('description') as string) || null,
        price_mzn: Number(fd.get('price_mzn')),
        price_mzn_annual: getNum('price_mzn_annual'),
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="price_mzn">Monthly price (MZN) *</Label>
          <Input id="price_mzn" name="price_mzn" type="number" step="0.01" min={0.01} required
            defaultValue={initial?.price_mzn ?? ''} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="price_mzn_annual">Annual price (MZN)</Label>
          <Input id="price_mzn_annual" name="price_mzn_annual" type="number" step="0.01" min={0.01}
            defaultValue={initial?.price_mzn_annual ?? ''} placeholder="Empty = no annual cover" />
        </div>
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

export function VehicleTypesManager({ vehicleTypes, kind, readOnly = false }: VehicleTypesManagerProps) {
  const [editTarget, setEditTarget] = useState<ListRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ListRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await ACTIONS[kind].remove(deleteTarget.id)
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
      {!readOnly && <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-brand hover:bg-brand/90" />}>
            <Plus className="w-4 h-4 mr-2" />
            Add Vehicle Type
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Vehicle Type</DialogTitle>
            </DialogHeader>
            <VehicleTypeForm kind={kind} onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>}

      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Name</TableHead>
              <TableHead>Monthly (MZN)</TableHead>
              <TableHead>Annual (MZN)</TableHead>
              <TableHead>Status</TableHead>
              {!readOnly && <TableHead className="w-20"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!vehicleTypes.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-8">No vehicle categories yet</TableCell>
              </TableRow>
            )}
            {vehicleTypes.map((vt) => (
              <TableRow key={vt.id}>
                <TableCell className="font-medium">{vt.name}</TableCell>
                <TableCell>{formatCurrency(vt.price_mzn)}</TableCell>
                <TableCell>{vt.price_mzn_annual != null ? formatCurrency(vt.price_mzn_annual) : '—'}</TableCell>
                <TableCell>
                  <Badge className={vt.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                    {vt.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {!readOnly && <TableCell>
                  <div className="flex gap-1">
                    <Dialog open={editTarget?.id === vt.id} onOpenChange={(o) => !o && setEditTarget(null)}>
                      <DialogTrigger render={<Button variant="ghost" size="sm" onClick={() => setEditTarget(vt)} />}>
                        <Pencil className="w-3.5 h-3.5" />
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Edit Vehicle Type</DialogTitle>
                        </DialogHeader>
                        <VehicleTypeForm initial={vt} kind={kind} onClose={() => setEditTarget(null)} />
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
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Vehicle Type"
        description={kind === 'template'
          ? `Remove "${deleteTarget?.name}" from the default list? Insurers that already have it keep their copy.`
          : `Remove "${deleteTarget?.name}"? If it has policies, it will be soft-deleted (set to inactive).`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        loading={isPending}
      />
    </div>
  )
}
