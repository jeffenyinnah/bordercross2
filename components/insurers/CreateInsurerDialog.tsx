'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createInsurer } from '@/lib/actions/insurers'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus } from 'lucide-react'

export function CreateInsurerDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await createInsurer({
        name: fd.get('name') as string,
        code: fd.get('code') as string,
        admin: {
          full_name: fd.get('admin_name') as string,
          email: fd.get('admin_email') as string,
          password: fd.get('admin_password') as string,
        },
      })
      if (result.success && result.data) {
        toast.success('Insurer created. Its admin can now sign in at /login and set everything up.')
        setOpen(false)
        router.push(`/insurers/${result.data.id}`)
      } else {
        setError(result.error ?? 'Failed to create insurer')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand/90" />}>
        <Plus className="w-4 h-4 mr-2" />
        New Insurer
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Insurer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ins_name">Name *</Label>
            <Input id="ins_name" name="name" required placeholder="Seguradora Exemplo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ins_code">Code *</Label>
            <Input id="ins_code" name="code" required placeholder="EXEMPLO" className="uppercase" />
            <p className="text-xs text-gray-500">Short and permanent. Letters, digits or _.</p>
          </div>
          <div className="border-t pt-4 space-y-4">
            <div>
              <p className="text-sm font-medium">Insurer admin</p>
              <p className="text-xs text-gray-500">
                Their first login. They add agents, top up wallets, set prices and terminals themselves.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_name">Full name *</Label>
              <Input id="admin_name" name="admin_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_email">Email *</Label>
              <Input id="admin_email" name="admin_email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_password">Temporary password *</Label>
              <Input id="admin_password" name="admin_password" type="password" required minLength={8} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Insurer'}
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
