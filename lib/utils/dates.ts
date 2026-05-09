import { format, addDays, addYears } from 'date-fns'

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy')
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy HH:mm')
}

export function calculateEndDate(startDate: string, policyType: 'monthly' | 'annual'): string {
  const start = new Date(startDate)
  const end = policyType === 'annual' ? addDays(start, 365) : addDays(start, 30)
  return format(end, 'yyyy-MM-dd')
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}
