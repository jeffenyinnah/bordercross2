'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updatePolicy } from '@/lib/actions/policies'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Pencil } from 'lucide-react'
import type { Policy } from '@/lib/types'

const DOCUMENT_TYPES = ['Passport', 'ID', 'Vehicle Booklet', 'License'] as const

const BORDERS = [
  'Ressano Garcia', 'Namaacha', 'Ponta do Ouro', 'Chicualacuala',
  'Mapai', 'Caia', 'Marromeu', 'Nyamapanda', 'Cassacatiza', 'Zumbo',
  'Changara', 'Zobue', 'Milange', 'Mocuba', 'Cuamba', 'Mandimba',
  'Negomano', 'Mueda', 'Mocimboa da Praia', 'Pemba',
]

interface EditPolicyDialogProps {
  policy: Policy
}

export function EditPolicyDialog({ policy }: EditPolicyDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [border, setBorder] = useState(policy.border ?? '')
  const [documentType, setDocumentType] = useState(policy.document_type ?? '')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      try {
        const result = await updatePolicy(policy.id, {
          client_name: fd.get('client_name') as string,
          client_id_number: (fd.get('client_id_number') as string) || null,
          client_nationality: (fd.get('client_nationality') as string) || null,
          plate_number: fd.get('plate_number') as string,
          vehicle_brand: fd.get('vehicle_brand') as string,
          vehicle_model: fd.get('vehicle_model') as string,
          vehicle_year: fd.get('vehicle_year') ? Number(fd.get('vehicle_year')) : null,
          engine_number: (fd.get('engine_number') as string) || null,
          chassis_number: (fd.get('chassis_number') as string) || null,
          border: border || null,
          document_type: documentType || null,
          notes: (fd.get('notes') as string) || null,
        })

        if (result.success) {
          toast.success('Policy updated')
          setOpen(false)
        } else {
          setError(result.error ?? 'Failed to update policy')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred'
        setError(msg)
        toast.error(msg)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="w-4 h-4 mr-1.5" />
        Edit Policy
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy — {policy.policy_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700 mb-2">Client</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ep_client_name">Full Name *</Label>
                <Input id="ep_client_name" name="client_name" required defaultValue={policy.client_name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_client_id">ID / Passport Number</Label>
                <Input id="ep_client_id" name="client_id_number" defaultValue={policy.client_id_number ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_nationality">Nationality</Label>
                <Input id="ep_nationality" name="client_nationality" defaultValue={policy.client_nationality ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label>Document Type</Label>
                <Select value={documentType} onValueChange={(v) => setDocumentType(v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— None —</SelectItem>
                    {DOCUMENT_TYPES.map((dt) => (
                      <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700 mb-2">Vehicle</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep_plate">Plate Number *</Label>
                <Input id="ep_plate" name="plate_number" required defaultValue={policy.plate_number} className="uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_year">Year</Label>
                <Input id="ep_year" name="vehicle_year" type="number" min={1900} max={new Date().getFullYear() + 1}
                  defaultValue={policy.vehicle_year ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_brand">Brand *</Label>
                <Input id="ep_brand" name="vehicle_brand" required defaultValue={policy.vehicle_brand} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_model">Model *</Label>
                <Input id="ep_model" name="vehicle_model" required defaultValue={policy.vehicle_model} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_engine">Engine Number</Label>
                <Input id="ep_engine" name="engine_number" defaultValue={policy.engine_number ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep_chassis">Chassis / VIN</Label>
                <Input id="ep_chassis" name="chassis_number" defaultValue={policy.chassis_number ?? ''} />
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label>Border Post</Label>
            <Select value={border} onValueChange={(v) => setBorder(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {BORDERS.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep_notes">Notes</Label>
            <Textarea id="ep_notes" name="notes" rows={2} defaultValue={policy.notes ?? ''} />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
