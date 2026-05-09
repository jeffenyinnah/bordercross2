'use client'

import { useTransition } from 'react'
import { logout } from '@/lib/actions/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils/currency'
import { LogOut, Wallet } from 'lucide-react'
import type { Profile, CreditWallet, UserRole } from '@/lib/types'

interface HeaderProps {
  profile: Profile
  wallet?: CreditWallet | null
}

const roleBadgeStyle: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  agent: 'bg-blue-100 text-blue-800',
}

export function Header({ profile, wallet }: HeaderProps) {
  const [isPending, startTransition] = useTransition()

  return (
    <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4 sm:px-6">
      <div />
      <div className="flex items-center gap-2 sm:gap-4">
        {profile.role === 'agent' && wallet && (
          <div className="hidden sm:flex items-center gap-2 text-xs sm:text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">
            <Wallet className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="font-medium">
              {formatCurrency(wallet.balance_mzn, 'MZN')}
            </span>
            <span className="text-gray-300">|</span>
            <span>{formatCurrency(wallet.balance_zar, 'ZAR')}</span>
            <span className="text-gray-300">|</span>
            <span className="hidden sm:inline">{formatCurrency(wallet.balance_usd, 'USD')}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-gray-700 truncate">{profile.full_name}</span>
          <Badge className={`${roleBadgeStyle[profile.role]} text-xs shrink-0`}>
            {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
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
