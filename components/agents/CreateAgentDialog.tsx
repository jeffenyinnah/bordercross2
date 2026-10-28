'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createAgent } from '@/lib/actions/agents'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormSelect } from '@/components/shared/FormSelect'
import { UserPlus } from 'lucide-react'
import type { BorderPost, Profile } from '@/lib/types'

interface CreateAgentDialogProps {
  agents: (Pick<Profile, 'id' | 'full_name'>)[]
  borderPosts: Pick<BorderPost, 'id' | 'name'>[]
}

/** Insurer admins add agents to their own insurer. */
export function CreateAgentDialog({ agents, borderPosts }: CreateAgentDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      const result = await createAgent({
        full_name: fd.get('full_name') as string,
        email: fd.get('email') as string,
        password: fd.get('password') as string,
        border_post_id: (fd.get('border_post_id') as string) || null,
        parent_agent_id: (fd.get('parent_agent_id') as string) || null,
        commission_rate: Number(fd.get('commission_rate')),
        sub_agent_override_rate: Number(fd.get('sub_agent_override_rate')),
      })

      if (result.success) {
        toast.success('Agent created. They sign in at /login on their Android phone.')
        setOpen(false)
      } else {
        setError(result.error ?? 'Failed to create agent')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand hover:bg-brand/90" />}>
        <UserPlus className="w-4 h-4 mr-2" />
        New Agent
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name *</Label>
            <Input id="full_name" name="full_name" required placeholder="Jane Doe" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" required placeholder="agent@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Temporary Password *</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="border_post_id">Border Post</Label>
            <FormSelect id="border_post_id" name="border_post_id" defaultValue="">
              <option value="">Not assigned yet</option>
              {borderPosts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FormSelect>
            <p className="text-xs text-gray-500">The phone reserves offline policy numbers for this border.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="parent_agent_id">Parent Agent (optional)</Label>
            <FormSelect id="parent_agent_id" name="parent_agent_id" defaultValue="">
              <option value="">None — top-level agent</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="commission_rate">Commission Rate (%)</Label>
              <Input id="commission_rate" name="commission_rate" type="number" step="0.01"
                min={0} max={100} defaultValue={15} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub_agent_override_rate">Override Rate (%)</Label>
              <Input id="sub_agent_override_rate" name="sub_agent_override_rate" type="number" step="0.01"
                min={0} max={100} defaultValue={5} required />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Agent'}
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
