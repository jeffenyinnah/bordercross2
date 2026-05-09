'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  FilePlus,
  Users,
  BarChart2,
  Settings,
  Shield,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/types'

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'agent'],
  },
  {
    label: 'Policies',
    href: '/policies',
    icon: FileText,
    roles: ['admin', 'agent'],
  },
  {
    label: 'New Policy',
    href: '/policies/new',
    icon: FilePlus,
    roles: ['admin', 'agent'],
  },
  { label: 'Agents', href: '/agents', icon: Users, roles: ['admin'] },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart2,
    roles: ['admin'],
  },
  { label: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
]

export function MobileNav({ role }: { role: UserRole }) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="md:hidden bg-red-900 text-white">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6" />
          <span className="font-bold text-lg tracking-wide">Arkos Seguros</span>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {isOpen && (
        <nav className="px-4 py-4 space-y-1 border-t border-blue-800">
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
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'text-blue-100 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              )
            })}
        </nav>
      )}
    </div>
  )
}
