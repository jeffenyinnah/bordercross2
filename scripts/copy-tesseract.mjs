// Slip OCR runs offline in the agent app (/agent), so Tesseract's worker, WASM
// cores and English model are served from our own origin (public/tesseract,
// generated, not committed) and precached by the agent service worker.
// Runs before `next dev` and `next build`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const pkg = (name) => dirname(require.resolve(`${name}/package.json`))
const out = resolve(import.meta.dirname, '../public/tesseract')
mkdirSync(out, { recursive: true })

copyFileSync(join(pkg('tesseract.js'), 'dist/worker.min.js'), join(out, 'worker.min.js'))
// LSTM-only cores; the browser picks the SIMD variant it supports
for (const core of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  copyFileSync(join(pkg('tesseract.js-core'), `${core}.wasm.js`), join(out, `${core}.wasm.js`))
}
// stored uncompressed: some hosts add Content-Encoding to .gz files, which breaks Tesseract's own gunzip
const model = join(out, 'eng.traineddata')
if (!existsSync(model)) {
  writeFileSync(model, gunzipSync(readFileSync(join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'))))
}
