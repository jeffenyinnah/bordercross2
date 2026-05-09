'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  label: string
  href: string
}

export function NavTabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              active
                ? 'text-brand border-brand'
                : 'text-gray-600 border-transparent hover:text-brand hover:border-brand/60'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
