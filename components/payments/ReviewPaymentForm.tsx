'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { reviewPayment } from '@/lib/actions/payments'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

export function ReviewPaymentForm({ paymentId }: { paymentId: string }) {
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [isPending, startTransition] = useTransition()

  function decide(decision: 'approve' | 'reject') {
    startTransition(async () => {
      const result = await reviewPayment(paymentId, decision, note)
      if (result.success) {
        toast.success(decision === 'approve' ? 'Payment approved' : 'Payment rejected and policy cancelled')
        setRejecting(false)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="review_note">Note</Label>
        <Textarea id="review_note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Required when rejecting, e.g. what the bank statement or the photo shows" />
      </div>
      <div className="flex gap-3 flex-wrap">
        <Button className="bg-green-700 hover:bg-green-800" disabled={isPending} onClick={() => decide('approve')}>
          Approve: slip is genuine
        </Button>
        <Button variant="outline" className="text-red-600" disabled={isPending || !note.trim()}
          onClick={() => setRejecting(true)}>
          Reject and cancel policy
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Approved payments wait for the bank settlement. Rejecting cancels the policy; it can&apos;t be undone.
      </p>
      <ConfirmDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this payment?"
        description="The payment is marked rejected and its policy is cancelled. Follow up with the agent to recover the premium."
        confirmLabel="Reject and cancel"
        variant="destructive"
        onConfirm={() => decide('reject')}
        loading={isPending}
      />
    </div>
  )
}
