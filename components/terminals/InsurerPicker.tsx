'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FormSelect } from '@/components/shared/FormSelect'

/** Platform admins switch the insurer a page shows (?insurer=). */
export function InsurerPicker({ insurers, value }: { insurers: { id: string; name: string }[]; value: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <FormSelect
      aria-label="Insurer"
      className="w-56"
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params)
        next.set('insurer', e.target.value)
        router.push(`${pathname}?${next}`)
      }}
    >
      {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </FormSelect>
  )
}
