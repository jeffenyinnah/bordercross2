import {
  BarChart2, Building2, CreditCard, FileText, LayoutDashboard, Settings, Smartphone, Tags, Users,
} from 'lucide-react'
import type { UserRole } from '@/lib/types'

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Platform admin',
  insurer_admin: 'Insurer admin',
  finance: 'Finance',
  agent: 'Agent',
}

/** Back-office navigation. Pages enforce the same roles (requirePageRole). */
export const NAV_ITEMS: { label: string; href: string; icon: typeof FileText; roles: UserRole[] }[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'insurer_admin', 'finance'] },
  { label: 'Policies', href: '/policies', icon: FileText, roles: ['admin', 'insurer_admin', 'finance'] },
  { label: 'Card Payments', href: '/payments', icon: CreditCard, roles: ['admin', 'insurer_admin', 'finance'] },
  { label: 'Agents', href: '/agents', icon: Users, roles: ['admin', 'insurer_admin'] },
  { label: 'POS Terminals', href: '/terminals', icon: Smartphone, roles: ['admin', 'insurer_admin'] },
  { label: 'Price List', href: '/prices', icon: Tags, roles: ['admin', 'insurer_admin'] },
  { label: 'Insurers', href: '/insurers', icon: Building2, roles: ['admin'] },
  { label: 'Insurer Settings', href: '/insurers', icon: Building2, roles: ['insurer_admin'] },
  { label: 'Reports', href: '/reports', icon: BarChart2, roles: ['admin', 'insurer_admin', 'finance'] },
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
]

export function navFor(role: UserRole) {
  return NAV_ITEMS.filter((i) => i.roles.includes(role))
}

export function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname.startsWith(href)
}
