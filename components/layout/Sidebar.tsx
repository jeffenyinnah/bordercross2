'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, FilePlus, Users, BarChart2, Settings, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { branding } from '@/lib/branding'
import type { UserRole } from '@/lib/types'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'agent'] },
  { label: 'Policies',  href: '/policies',  icon: FileText,        roles: ['admin', 'agent'] },
  { label: 'New Policy',href: '/policies/new', icon: FilePlus,     roles: ['admin', 'agent'] },
  { label: 'Agents',   href: '/agents',    icon: Users,           roles: ['admin'] },
  { label: 'Reports',  href: '/reports',   icon: BarChart2,       roles: ['admin'] },
  { label: 'Settings', href: '/settings',  icon: Settings,        roles: ['admin'] },
]

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex w-64 min-h-screen flex-col bg-brand">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-white/20">
        <Shield className="w-6 h-6 text-white shrink-0" />
        <span className="text-white font-bold text-lg tracking-wide truncate">
          {branding.appName}
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => item.roles.includes(role))
          .map((item) => {
            const Icon = item.icon
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
      </nav>

      <div className="px-4 py-3 text-white/40 text-xs border-t border-white/20">
        v1.0 · Mozambique Border Posts
      </div>
    </aside>
  )
}
