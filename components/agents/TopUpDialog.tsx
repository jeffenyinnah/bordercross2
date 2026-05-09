'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { topUpWallet } from '@/lib/actions/credits'
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
import { Wallet } from 'lucide-react'
import type { Currency } from '@/lib/types'

interface TopUpDialogProps {
  agentId: string
  agentName: string
}

export function TopUpDialog({ agentId, agentName }: TopUpDialogProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState<Currency>('MZN')
  const [amount, setAmount] = useState('')

  const isLargeTopUp = Number(amount) > 10000

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await topUpWallet(agentId, currency, Number(amount))
      if (result.success) {
        toast.success(`Wallet topped up: ${currency} ${amount}`)
        setOpen(false)
        setAmount('')
      } else {
        setError(result.error ?? 'Top-up failed')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-green-700 hover:bg-green-600" />}>
        <Wallet className="w-4 h-4 mr-2" />
        Top Up Wallet
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Top Up Wallet — {agentName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={(v) => v && setCurrency(v as Currency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MZN">MZN (Metical)</SelectItem>
                <SelectItem value="ZAR">ZAR (Rand)</SelectItem>
                <SelectItem value="USD">USD (Dollar)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              min={1}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="0.00"
            />
            {isLargeTopUp && (
              <p className="text-amber-600 text-xs">Large top-up: {currency} {Number(amount).toLocaleString()}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="submit" className="flex-1 bg-green-700 hover:bg-green-600" disabled={isPending || !amount}>
              {isPending ? 'Processing…' : 'Top Up'}
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
