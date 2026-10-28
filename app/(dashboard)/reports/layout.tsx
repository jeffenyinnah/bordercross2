import { NavTabs } from '@/components/shared/NavTabs'
import { STAFF_ROLES, requirePageRole } from '@/lib/auth'

const REPORTS_TABS = [
  { label: 'Transactions', href: '/reports/transactions' },
  { label: 'Policies', href: '/reports/policies' },
  { label: 'Commissions', href: '/reports/commissions' },
]

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(STAFF_ROLES)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      <NavTabs tabs={REPORTS_TABS} />
      {children}
    </div>
  )
}
