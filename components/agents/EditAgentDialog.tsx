'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateAgent } from '@/lib/actions/agents'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Pencil } from 'lucide-react'
import type { Profile } from '@/lib/types'

interface EditAgentDialogProps {
  agent: Profile
  allAgents: Pick<Profile, 'id' | 'full_name'>[]
}

export function EditAgentDialog({ agent, allAgents }: EditAgentDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [parentAgentId, setParentAgentId] = useState(agent.parent_agent_id ?? '')

  // Exclude current agent from parent options to prevent circular references
  const parentOptions = allAgents.filter((a) => a.id !== agent.id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      try {
        const result = await updateAgent(agent.id, {
          full_name: fd.get('full_name') as string,
          commission_rate: Number(fd.get('commission_rate')),
          sub_agent_override_rate: Number(fd.get('sub_agent_override_rate')),
          parent_agent_id: parentAgentId || null,
        })

        if (result.success) {
          toast.success('Agent updated')
          setOpen(false)
        } else {
          setError(result.error ?? 'Failed to update agent')
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
            <Label>Parent Agent</Label>
            <Select value={parentAgentId} onValueChange={(v) => setParentAgentId(v ?? '')}>
              <SelectTrigger>
                <SelectValue placeholder="None — top-level agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {parentOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ea_commission_rate">Commission Rate (%)</Label>
              <Input
                id="ea_commission_rate"
                name="commission_rate"
                type="number"
                step="0.01"
                min={0}
                max={100}
                defaultValue={agent.commission_rate}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ea_override_rate">Override Rate (%)</Label>
              <Input
                id="ea_override_rate"
                name="sub_agent_override_rate"
                type="number"
                step="0.01"
                min={0}
                max={100}
                defaultValue={agent.sub_agent_override_rate}
                required
              />
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
