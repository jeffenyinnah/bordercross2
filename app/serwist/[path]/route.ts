import { createSerwistRoute } from '@serwist/turbopack'

// Serves the agent app's service worker at /serwist/sw.js (see sw/agent-sw.ts).
// The /agent shell gets a new revision on every build so a deploy always refreshes it.
const revision = crypto.randomUUID()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'sw/agent-sw.ts',
  additionalPrecacheEntries: [{ url: '/agent', revision }],
  globPatterns: [
    '.next/static/**/*.{js,css,woff2,png,svg,webp,ico,json}',
    'public/agent/**/*',
    'public/tesseract/**/*',
  ],
  // the Tesseract model and wasm cores are several MB each
  maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
})
