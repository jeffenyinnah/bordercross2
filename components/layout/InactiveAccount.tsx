'use client'

import { useTransition } from 'react'
import { logout } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle, LogOut } from 'lucide-react'

interface InactiveAccountProps {
  email: string
}

export function InactiveAccount({ email }: InactiveAccountProps) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-4">
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <AlertTitle className="text-amber-800 font-semibold">Account deactivated</AlertTitle>
          <AlertDescription className="text-amber-700 mt-1">
            The account <strong>{email}</strong> has been deactivated. Contact your administrator
            to restore access.
          </AlertDescription>
        </Alert>

        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => startTransition(() => logout())}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    </div>
  )
}
