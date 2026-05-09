import { Badge } from '@/components/ui/badge'
import type { PolicyStatus } from '@/lib/types'

const styles: Record<PolicyStatus, string> = {
  active: 'bg-green-100 text-green-800 hover:bg-green-100',
  expired: 'bg-red-100 text-red-800 hover:bg-red-100',
  cancelled: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
}

export function StatusBadge({ status }: { status: PolicyStatus }) {
  return (
    <Badge className={styles[status]}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}
