import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Button({ variant = 'primary', className, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition active:scale-[0.99] disabled:opacity-50',
        variant === 'primary' && 'bg-brand text-white',
        variant === 'outline' && 'border border-gray-300 bg-white text-gray-900',
        variant === 'ghost' && 'text-brand',
        variant === 'danger' && 'bg-red-600 text-white',
        className,
      )}
    />
  )
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-gray-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  )
}

const inputClass = 'h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, props.className)} />
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl bg-white p-4 shadow-sm', className)}>{children}</div>
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={cx(
      'rounded-xl px-3 py-2 text-sm',
      tone === 'info' && 'bg-blue-50 text-blue-900',
      tone === 'warn' && 'bg-amber-50 text-amber-900',
      tone === 'error' && 'bg-red-50 text-red-800',
      tone === 'ok' && 'bg-green-50 text-green-800',
    )}>
      {children}
    </div>
  )
}

export function Screen({ title, onBack, children, footer }: { title: string; onBack?: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 bg-brand px-4 text-white">
        {onBack && <button onClick={onBack} className="-ml-2 h-10 w-10 text-2xl" aria-label="Back">‹</button>}
        <h1 className="truncate text-lg font-semibold">{title}</h1>
      </header>
      <main className="flex-1 space-y-4 overflow-y-auto p-4">{children}</main>
      {footer && <footer className="shrink-0 space-y-2 border-t border-gray-200 bg-white p-4">{footer}</footer>}
    </div>
  )
}
