'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateInsurer } from '@/lib/actions/insurers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import type { Insurer } from '@/lib/types'

/** Name and active status. Platform admins only; the code never changes. */
export function InsurerDetailsForm({ insurer }: { insurer: Insurer }) {
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function save(data: { name?: string; is_active?: boolean }, message: string) {
    startTransition(async () => {
      const result = await updateInsurer(insurer.id, data)
      if (result.success) {
        toast.success(message)
        setConfirm(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    save({ name: new FormData(e.currentTarget).get('name') as string }, 'Name saved')
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
      <form onSubmit={handleSubmit} className="flex items-end gap-2 flex-1">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="insurer_name">Name</Label>
          <Input id="insurer_name" name="name" defaultValue={insurer.name} required />
        </div>
        <Button type="submit" variant="outline" disabled={isPending}>Save</Button>
      </form>
      <Button variant="outline" onClick={() => setConfirm(true)} disabled={isPending}
        className={insurer.is_active ? 'text-red-600' : 'text-green-700'}>
        {insurer.is_active ? 'Deactivate insurer' : 'Reactivate insurer'}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={insurer.is_active ? 'Deactivate insurer' : 'Reactivate insurer'}
        description={insurer.is_active
          ? `Agents of ${insurer.name} can no longer sell. Existing policies stay valid.`
          : `Agents of ${insurer.name} can sell again.`}
        confirmLabel={insurer.is_active ? 'Deactivate' : 'Reactivate'}
        variant={insurer.is_active ? 'destructive' : 'default'}
        onConfirm={() => save({ is_active: !insurer.is_active },
          insurer.is_active ? 'Insurer deactivated' : 'Insurer reactivated')}
        loading={isPending}
      />
    </div>
  )
}
