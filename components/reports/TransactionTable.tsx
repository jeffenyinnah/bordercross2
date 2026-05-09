'use client'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CurrencyBadge } from '@/components/shared/CurrencyBadge'
import { formatDateTime } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { exportToCSV } from '@/lib/utils/csv'
import { Download, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import type { CreditTransaction } from '@/lib/types'

interface TransactionTableProps {
  transactions: (CreditTransaction & { agent?: { full_name: string } | null })[]
  showAgent?: boolean
}

export function TransactionTable({ transactions, showAgent }: TransactionTableProps) {
  function handleExport() {
    exportToCSV(
      transactions.map((t) => ({
        Date: formatDateTime(t.created_at),
        Type: t.type,
        Currency: t.currency,
        Amount: t.amount,
        Balance_After: t.balance_after,
        Description: t.description ?? '',
        Agent: t.agent?.full_name ?? '',
      })),
      'transactions'
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>
      {!transactions.length ? (
        <div className="text-center py-12 text-gray-400">No transactions found</div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance After</TableHead>
                <TableHead>Description</TableHead>
                {showAgent && <TableHead>Agent</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="text-sm text-gray-500">{formatDateTime(tx.created_at)}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        tx.type === 'credit'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }
                    >
                      {tx.type === 'credit' ? (
                        <ArrowUpCircle className="w-3 h-3 mr-1 inline" />
                      ) : (
                        <ArrowDownCircle className="w-3 h-3 mr-1 inline" />
                      )}
                      {tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CurrencyBadge currency={tx.currency} />
                  </TableCell>
                  <TableCell
                    className={`font-medium ${tx.type === 'credit' ? 'text-green-700' : 'text-red-600'}`}
                  >
                    {tx.type === 'credit' ? '+' : '-'}
                    {formatCurrency(tx.amount, tx.currency)}
                  </TableCell>
                  <TableCell>{formatCurrency(tx.balance_after, tx.currency)}</TableCell>
                  <TableCell className="text-sm text-gray-600 max-w-[200px] truncate">
                    {tx.description ?? '—'}
                  </TableCell>
                  {showAgent && (
                    <TableCell className="text-sm">{tx.agent?.full_name ?? '—'}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
