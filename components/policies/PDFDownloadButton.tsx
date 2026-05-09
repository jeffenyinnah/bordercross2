'use client'

import { Download, FileText, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PDFDownloadButtonProps {
  policyId: string
  policyNumber: string
}

export function PDFDownloadButton({ policyId, policyNumber }: PDFDownloadButtonProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <a href={`/policies/${policyId}/pdf?format=a4`} download={`${policyNumber}-A4.pdf`}>
        <Button variant="outline" className="text-brand border-brand/20 hover:bg-blue-50">
          <FileText className="w-4 h-4 mr-2" />
          A4 Certificate
        </Button>
      </a>
      <a href={`/policies/${policyId}/pdf?format=receipt`} download={`${policyNumber}-Receipt.pdf`}>
        <Button variant="outline" className="text-brand border-brand/20 hover:bg-blue-50">
          <Receipt className="w-4 h-4 mr-2" />
          Receipt
        </Button>
      </a>
    </div>
  )
}
