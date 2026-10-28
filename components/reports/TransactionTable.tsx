'use client'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { exportToCSV } from '@/lib/utils/csv'
import { Download, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import type { CreditTransaction } from '@/lib/types'

/** top-ups and released offline reserves add to the wallet; sales and reserves take from it */
const isIn = (type: CreditTransaction['type']) => type === 'credit' || type === 'release'

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
        Amount_MZN: t.amount,
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
                        isIn(tx.type)
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }
                    >
                      {isIn(tx.type) ? (
                        <ArrowUpCircle className="w-3 h-3 mr-1 inline" />
                      ) : (
                        <ArrowDownCircle className="w-3 h-3 mr-1 inline" />
                      )}
                      {tx.type}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`font-medium ${isIn(tx.type) ? 'text-green-700' : 'text-red-600'}`}
                  >
                    {isIn(tx.type) ? '+' : '-'}
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
