import type { OcrResult } from '@bordercross/core'
import type { Worker } from 'tesseract.js'

/** Served from our origin (see vite.config.ts) and precached, so OCR works offline. */
const assets = () => new URL('tesseract/', document.baseURI).href

let worker: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const base = assets()
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      gzip: false,
      // the service worker already caches the model; no second copy in IndexedDB
      cacheMethod: 'none',
      workerBlobURL: false,
    })
    await w.setParameters({
      // uniform block: best on the sample slips (incl. two-column lines like RRN ... RC)
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    })
    return w
  })()
  worker.catch(() => { worker = null })
  return worker
}

/** Load the OCR engine in the background (e.g. after login) so the first slip reads quickly. */
export function warmUpOcr() {
  getWorker().catch(() => {})
}

/** Read a slip photo on the device. Lines come back top to bottom with 0..1 confidence. */
export async function recognizeSlip(image: HTMLCanvasElement): Promise<OcrResult> {
  const w = await getWorker()
  const { data } = await w.recognize(image, {}, { blocks: true })
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
  return {
    lines: lines
      .map((l) => ({ text: l.text.replace(/\s+$/, ''), confidence: Math.max(0, Math.min(1, l.confidence / 100)) }))
      .filter((l) => l.text.trim().length > 0),
  }
}
