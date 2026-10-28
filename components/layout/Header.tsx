'use client'

import { useTransition } from 'react'
import { logout } from '@/lib/actions/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import type { Profile, UserRole } from '@/lib/types'
import { ROLE_LABELS } from './nav'

interface HeaderProps {
  profile: Profile
  /** shown next to the name for insurer staff */
  insurerName?: string | null
}

const roleBadgeStyle: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  insurer_admin: 'bg-indigo-100 text-indigo-800',
  finance: 'bg-emerald-100 text-emerald-800',
  agent: 'bg-blue-100 text-blue-800',
}

export function Header({ profile, insurerName }: HeaderProps) {
  const [isPending, startTransition] = useTransition()

  return (
    <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4 sm:px-6">
      <div />
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-gray-700 truncate">{profile.full_name}</span>
          <Badge className={`${roleBadgeStyle[profile.role]} text-xs shrink-0`}>
            {ROLE_LABELS[profile.role]}{insurerName ? ` · ${insurerName}` : ''}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => startTransition(() => logout())}
          className="text-gray-500 hover:text-gray-700"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}
