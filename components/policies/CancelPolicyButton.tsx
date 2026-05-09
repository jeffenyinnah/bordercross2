'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { cancelPolicy } from '@/lib/actions/policies'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { XCircle } from 'lucide-react'

export function CancelPolicyButton({ policyId }: { policyId: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelPolicy(policyId)
      if (result.success) {
        toast.success('Policy cancelled')
        setOpen(false)
      } else {
        toast.error(result.error ?? 'Failed to cancel')
      }
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="text-red-600 border-red-200 hover:bg-red-50">
        <XCircle className="w-4 h-4 mr-2" />
        Cancel Policy
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel Policy"
        description="Are you sure you want to cancel this policy? This action cannot be undone."
        confirmLabel="Yes, Cancel Policy"
        onConfirm={handleConfirm}
        loading={isPending}
      />
    </>
  )
}
