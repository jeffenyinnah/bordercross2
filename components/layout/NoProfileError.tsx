'use client'

import { useTransition } from 'react'
import { logout } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle, Copy, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

interface NoProfileErrorProps {
  email: string
  userId: string
}

export function NoProfileError({ email, userId }: NoProfileErrorProps) {
  const [isPending, startTransition] = useTransition()

  const sql = `INSERT INTO profiles (id, full_name, email, role)
VALUES ('${userId}', 'Admin', '${email}', 'admin');`

  function copySql() {
    navigator.clipboard.writeText(sql)
    toast.success('SQL copied to clipboard')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Toaster richColors position="top-right" />
      <div className="max-w-lg w-full space-y-4">
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <AlertTitle className="text-amber-800 font-semibold">Profile not found</AlertTitle>
          <AlertDescription className="text-amber-700 mt-1">
            Your account <strong>{email}</strong> is authenticated but has no profile row in
            the database. Run the SQL below in your{' '}
            <strong>Supabase Dashboard → SQL Editor</strong> to create it.
          </AlertDescription>
        </Alert>

        <div className="bg-white border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              SQL to run in Supabase
            </span>
            <Button variant="ghost" size="sm" onClick={copySql} className="h-7 text-xs">
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </Button>
          </div>
          <pre className="bg-gray-50 rounded p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-all">
            {sql}
          </pre>
          <p className="text-xs text-gray-500">
            You can change <code className="bg-gray-100 px-1 rounded">&apos;Admin&apos;</code> to your
            full name before running.
          </p>
        </div>

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
