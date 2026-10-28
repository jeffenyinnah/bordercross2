import { createElement } from 'react'
import { pdf } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import {
  PolicyCertificateA4,
  PolicyReceipt,
  verificationUrl,
  type CertificatePolicy,
} from '@bordercross/certificate'
import { config } from './config'
import type { LocalPolicy } from './store/types'

export type CertificateFormat = 'receipt' | 'a4'

/** Rendered entirely on the device, so certificates print without network. */
export async function renderCertificate(policy: LocalPolicy, format: CertificateFormat): Promise<Blob> {
  const data = policy.data as unknown as CertificatePolicy & { verification_token: string }
  const qrDataUrl = await QRCode.toDataURL(verificationUrl(config.appUrl, data.verification_token), {
    width: 150, margin: 1, color: { dark: '#000000', light: '#ffffff' },
  })
  const brand = { appName: config.appName, color: config.brandColor }
  const doc = format === 'receipt'
    ? createElement(PolicyReceipt, { policy: data, brand, qrDataUrl })
    : createElement(PolicyCertificateA4, { policy: data, brand, qrDataUrl })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(doc as any).toBlob()
}

/** The certificate as a ready-to-share PDF file. */
export async function certificateFile(policy: LocalPolicy, format: CertificateFormat): Promise<File> {
  const blob = await renderCertificate(policy, format)
  const name = `${policy.policy_number}-${format === 'receipt' ? 'Receipt' : 'A4'}.pdf`
  return new File([blob], name, { type: 'application/pdf' })
}

/**
 * Open Android's share sheet with the PDF. From there the agent prints (Android
 * print service, Bluetooth printer apps) or sends it by WhatsApp or e-mail.
 * Browsers without file sharing get the PDF opened in a new tab instead.
 *
 * Chrome only opens the share sheet within a few seconds of the tap, so the file
 * must already be rendered (see certificateFile) when this is called.
 */
export async function shareFile(file: File) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
    } catch (e) {
      // closing the share sheet is not an error
      if ((e as Error).name !== 'AbortError') throw e
    }
    return
  }
  const url = URL.createObjectURL(file)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
