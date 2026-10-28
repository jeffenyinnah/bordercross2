'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createStaff, toggleStaffStatus } from '@/lib/actions/insurers'
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
import { ROLE_LABELS } from '@/components/layout/nav'
import { UserPlus } from 'lucide-react'
import type { Profile } from '@/lib/types'

interface Props {
  insurerId: string
  staff: Profile[]
  currentUserId: string
}

export function StaffManager({ insurerId, staff, currentUserId }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggle(s: Profile) {
    setPendingId(s.id)
    startTransition(async () => {
      const result = await toggleStaffStatus(s.id)
      setPendingId(null)
      if (result.success) toast.success(s.is_active ? 'Login deactivated' : 'Login reactivated')
      else toast.error(result.error)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <CreateStaffDialog insurerId={insurerId} />
      </div>
      {!staff.length ? (
        <p className="text-gray-400 text-sm text-center py-4">No staff logins yet</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell className="text-sm text-gray-500">{s.email}</TableCell>
                  <TableCell>{ROLE_LABELS[s.role]}</TableCell>
                  <TableCell>
                    <Badge className={s.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {s.id !== currentUserId && (
                      <Button variant="ghost" size="sm" disabled={pendingId === s.id} onClick={() => toggle(s)}
                        className={s.is_active ? 'text-red-600' : 'text-green-700'}>
                        {s.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
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

function CreateStaffDialog({ insurerId }: { insurerId: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await createStaff(insurerId, {
        full_name: fd.get('full_name') as string,
        email: fd.get('email') as string,
        password: fd.get('password') as string,
        role: fd.get('role') as 'insurer_admin' | 'finance',
      })
      if (result.success) {
        toast.success('Login created. They sign in at /login.')
        setOpen(false)
      } else {
        setError(result.error ?? 'Failed to create login')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserPlus className="w-4 h-4 mr-1.5" />
        Add staff
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New staff login</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="st_name">Full Name *</Label>
            <Input id="st_name" name="full_name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st_email">Email *</Label>
            <Input id="st_email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st_password">Temporary Password *</Label>
            <Input id="st_password" name="password" type="password" required minLength={8} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st_role">Role *</Label>
            <FormSelect id="st_role" name="role" defaultValue="finance">
              <option value="finance">{ROLE_LABELS.finance}: reports and card payment review</option>
              <option value="insurer_admin">{ROLE_LABELS.insurer_admin}: also agents, terminals and settings</option>
            </FormSelect>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create login'}
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
