'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, Shield, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { branding } from '@/lib/branding'
import type { UserRole } from '@/lib/types'
import { isActive, navFor } from './nav'

export function MobileNav({ role }: { role: UserRole }) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="md:hidden bg-brand text-white">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6" />
          <span className="font-bold text-lg tracking-wide">{branding.appName}</span>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {isOpen && (
        <nav className="px-4 py-4 space-y-1 border-t border-white/20">
          {navFor(role).map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(pathname, item.href)
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
      )}
    </div>
  )
}
