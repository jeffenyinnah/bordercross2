'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { upsertBorderPost, deleteBorderPost, toggleBorderPostStatus } from '@/lib/actions/border-posts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Pencil, Trash2, Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import type { BorderPost } from '@/lib/types'

function BorderPostForm({ initial, onClose }: { initial?: Partial<BorderPost>; onClose: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError('')
    startTransition(async () => {
      try {
        const result = await upsertBorderPost({
          id: initial?.id,
          name: fd.get('name') as string,
          code: fd.get('code') as string,
          province: (fd.get('province') as string) || null,
        })
        if (result.success) {
          toast.success(initial?.id ? 'Border post updated' : 'Border post created')
          onClose()
        } else {
          setError(result.error ?? 'Failed')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="bp-name">Name *</Label>
        <Input id="bp-name" name="name" required defaultValue={initial?.name} placeholder="Ressano Garcia" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="bp-code">Code * (4 letters)</Label>
          <Input
            id="bp-code" name="code" required maxLength={8} defaultValue={initial?.code}
            placeholder="RGAR" className="uppercase font-mono"
          />
          <p className="text-xs text-gray-400">Used in policy numbers</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-province">Province</Label>
          <Input id="bp-province" name="province" defaultValue={initial?.province ?? ''} placeholder="Maputo" />
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <Button type="submit" className="flex-1 bg-brand hover:bg-brand/90" disabled={isPending}>
          {isPending ? 'Saving…' : initial?.id ? 'Update' : 'Create'}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

export function BorderPostsManager({ borderPosts }: { borderPosts: BorderPost[] }) {
  const [editTarget, setEditTarget] = useState<BorderPost | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BorderPost | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteBorderPost(deleteTarget.id)
      if (result.success) { toast.success('Deleted'); setDeleteTarget(null) }
      else toast.error(result.error)
    })
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      const result = await toggleBorderPostStatus(id)
      if (!result.success) toast.error(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-brand hover:bg-brand/90" />}>
            <Plus className="w-4 h-4 mr-2" />New Border Post
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Border Post</DialogTitle></DialogHeader>
            <BorderPostForm onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Province</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {borderPosts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                  No border posts found. Run the SQL migration first.
                </TableCell>
              </TableRow>
            )}
            {borderPosts.map((bp) => (
              <TableRow key={bp.id}>
                <TableCell className="font-medium">{bp.name}</TableCell>
                <TableCell className="font-mono text-sm text-brand">{bp.code}</TableCell>
                <TableCell className="text-sm text-gray-600">{bp.province ?? '—'}</TableCell>
                <TableCell>
                  <Badge className={bp.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                    {bp.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleToggle(bp.id)} title="Toggle status">
                      {bp.is_active
                        ? <ToggleRight className="w-4 h-4 text-green-600" />
                        : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                    </Button>
                    <Dialog open={editTarget?.id === bp.id} onOpenChange={(o) => !o && setEditTarget(null)}>
                      <DialogTrigger render={<Button variant="ghost" size="sm" onClick={() => setEditTarget(bp)} />}>
                        <Pencil className="w-3.5 h-3.5" />
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader><DialogTitle>Edit Border Post</DialogTitle></DialogHeader>
                        <BorderPostForm initial={bp} onClose={() => setEditTarget(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                      onClick={() => setDeleteTarget(bp)}>
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
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Border Post"
        description={`Permanently delete "${deleteTarget?.name}"? Existing policies will not be affected.`}
        confirmLabel="Delete" onConfirm={handleDelete} loading={isPending}
      />
    </div>
  )
}
