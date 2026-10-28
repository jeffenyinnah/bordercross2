import { branding } from '@/lib/branding'

/** Agent app configuration: the web app's NEXT_PUBLIC_* values, inlined at build. */
export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  /** where /verify/<token> is served */
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://bordercross.co.mz',
  appName: branding.appName,
  brandColor: branding.brandColor,
  appVersion: '0.1.0',
}
