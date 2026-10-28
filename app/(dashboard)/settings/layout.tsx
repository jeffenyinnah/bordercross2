import { requirePageRole } from '@/lib/auth'
import { NavTabs } from '@/components/shared/NavTabs'

const SETTINGS_TABS = [
  { label: 'Default Price List', href: '/settings/vehicle-types' },
  { label: 'Reference Rates', href: '/settings/exchange-rates' },
  { label: 'Border Posts', href: '/settings/border-posts' },
]

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole(['admin'])

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <NavTabs tabs={SETTINGS_TABS} />
      {children}
    </div>
  )
}
