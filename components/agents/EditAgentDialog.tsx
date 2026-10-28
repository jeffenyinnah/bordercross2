'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { toggleAgentStatus, updateAgent } from '@/lib/actions/agents'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormSelect } from '@/components/shared/FormSelect'
import { Pencil } from 'lucide-react'
import type { BorderPost, Profile } from '@/lib/types'

interface EditAgentDialogProps {
  agent: Profile
  /** agents of the same insurer (possible parents) */
  allAgents: Pick<Profile, 'id' | 'full_name'>[]
  borderPosts: Pick<BorderPost, 'id' | 'name'>[]
}

export function EditAgentDialog({ agent, allAgents, borderPosts }: EditAgentDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Exclude current agent from parent options to prevent circular references
  const parentOptions = allAgents.filter((a) => a.id !== agent.id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      const result = await updateAgent(agent.id, {
        full_name: fd.get('full_name') as string,
        commission_rate: Number(fd.get('commission_rate')),
        sub_agent_override_rate: Number(fd.get('sub_agent_override_rate')),
        parent_agent_id: (fd.get('parent_agent_id') as string) || null,
        border_post_id: (fd.get('border_post_id') as string) || null,
      })

      if (result.success) {
        toast.success('Agent updated')
        setOpen(false)
      } else {
        setError(result.error ?? 'Failed to update agent')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="w-4 h-4 mr-1.5" />
        Edit Agent
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ea_full_name">Full Name *</Label>
            <Input id="ea_full_name" name="full_name" required defaultValue={agent.full_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea_border">Border Post</Label>
            <FormSelect id="ea_border" name="border_post_id" defaultValue={agent.border_post_id ?? ''}>
              <option value="">Not assigned</option>
              {borderPosts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FormSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ea_parent">Parent Agent</Label>
            <FormSelect id="ea_parent" name="parent_agent_id" defaultValue={agent.parent_agent_id ?? ''}>
              <option value="">None — top-level agent</option>
              {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </FormSelect>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ea_commission_rate">Commission Rate (%)</Label>
              <Input id="ea_commission_rate" name="commission_rate" type="number" step="0.01"
                min={0} max={100} defaultValue={agent.commission_rate} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ea_override_rate">Override Rate (%)</Label>
              <Input id="ea_override_rate" name="sub_agent_override_rate" type="number" step="0.01"
                min={0} max={100} defaultValue={agent.sub_agent_override_rate} required />
            </div>
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

export function AgentStatusButton({ agent }: { agent: Pick<Profile, 'id' | 'full_name' | 'is_active'> }) {
  const [confirm, setConfirm] = useState(false)
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(async () => {
      const result = await toggleAgentStatus(agent.id)
      if (result.success) {
        toast.success(agent.is_active ? 'Agent deactivated' : 'Agent reactivated')
        setConfirm(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}
        className={agent.is_active ? 'text-red-600' : 'text-green-700'}>
        {agent.is_active ? 'Deactivate' : 'Reactivate'}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={agent.is_active ? 'Deactivate agent' : 'Reactivate agent'}
        description={agent.is_active
          ? `${agent.full_name} will no longer be able to sign in or sell policies. Their phone stops syncing.`
          : `${agent.full_name} will be able to sign in and sell again.`}
        confirmLabel={agent.is_active ? 'Deactivate' : 'Reactivate'}
        variant={agent.is_active ? 'destructive' : 'default'}
        onConfirm={toggle}
        loading={isPending}
      />
    </>
  )
}
