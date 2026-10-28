/** A slip photo taken with the in-app camera, ready for OCR and validation. */
export interface SlipCapture {
  /** JPEG, base64 without a data: prefix */
  base64: string
  sha256: string
  /** raw device time */
  capturedAt: string
  inApp: boolean
  gps: { lat: number; lng: number; accuracyM: number | null } | null
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** Best effort: a missing location is a FLAG (when the insurer requires it), never a blocker. */
function currentPosition(): Promise<SlipCapture['gps']> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 },
    )
  })
}

/**
 * Rear camera as a live preview inside the app. There is deliberately no file
 * input anywhere in the flow, so an old or forwarded photo can't be submitted.
 */
export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the camera. Open the app in Chrome on an Android phone.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    })
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError') {
      throw new Error('Camera permission was refused. Allow the camera for this app in Chrome settings.')
    }
    throw e
  }
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Torch for slips photographed at night, where the phone supports it. */
export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  const track = stream.getVideoTracks()[0]
  const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
  if (!caps?.torch) return false
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
  return true
}

/** A region of the video frame, in video pixels. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Freeze the current camera frame. Returns the full JPEG as evidence (hashed
 * exactly as stored) and an OCR copy of just the slip area, preprocessed.
 */
export async function captureFrame(video: HTMLVideoElement, crop: CropRect | null, now: () => number = Date.now):
  Promise<{ capture: SlipCapture; ocrImage: HTMLCanvasElement }> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) throw new Error('The camera is not ready yet')
  const capturedAt = new Date(now()).toISOString()

  const photo = document.createElement('canvas')
  photo.width = w
  photo.height = h
  photo.getContext('2d')!.drawImage(video, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve, reject) =>
    photo.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', 0.9))
  const bytes = new Uint8Array(await blob.arrayBuffer())

  const [sha256, gps] = await Promise.all([sha256Hex(bytes), currentPosition()])
  return {
    capture: { base64: bytesToBase64(bytes), sha256, capturedAt, inApp: true, gps },
    ocrImage: prepareForOcr(photo, crop ?? { x: 0, y: 0, width: w, height: h }),
  }
}

/** Slip width (px) Tesseract reads best at; measured on docs/sample-slips. */
const OCR_SLIP_WIDTH = 1000
/** Black/white cut after the contrast stretch; measured on docs/sample-slips (130-140 best). */
const OCR_THRESHOLD = 135

/**
 * Tuned on the sample slips (thermal print, crumpled, phone photo): upscaling,
 * a contrast stretch and a fixed threshold raised Tesseract from 0-5 to 8-9 of
 * the 10 required fields, and the fields it still misreads come back with low
 * confidence, so the agent is asked to check them instead of them passing.
 */
export function prepareForOcr(source: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const scale = Math.min(3, Math.max(1, OCR_SLIP_WIDTH / crop.width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(crop.width * scale)
  canvas.height = Math.round(crop.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const grey = new Uint8Array(d.length / 4)
  const histogram = new Uint32Array(256)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    grey[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    histogram[grey[p]]++
  }
  // stretch between the 1st and 99th percentile so faint thermal print becomes dark
  const cut = grey.length * 0.01
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += histogram[lo]) < cut; lo++);
  for (let acc = 0; hi > 0 && (acc += histogram[hi]) < cut; hi--);
  const range = Math.max(hi - lo, 1)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ((grey[p] - lo) * 255) / range > OCR_THRESHOLD ? 255 : 0
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Map the on-screen guide frame to video pixels. The <video> uses object-fit:
 * cover, so part of the frame is outside the screen; margin keeps slip edges.
 */
export function guideToVideoRect(video: HTMLVideoElement, guide: DOMRect, margin = 0.04): CropRect | null {
  const box = video.getBoundingClientRect()
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh || !box.width || !box.height) return null
  const scale = Math.max(box.width / vw, box.height / vh)
  const offX = (vw - box.width / scale) / 2
  const offY = (vh - box.height / scale) / 2
  const mx = guide.width * margin
  const my = guide.height * margin
  const x = Math.max(0, offX + (guide.left - box.left - mx) / scale)
  const y = Math.max(0, offY + (guide.top - box.top - my) / scale)
  const right = Math.min(vw, offX + (guide.right - box.left + mx) / scale)
  const bottom = Math.min(vh, offY + (guide.bottom - box.top + my) / scale)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

/**
 * Development only (desktop browser without a slip at hand): the slip text is
 * pasted instead of photographed. The "image" is the text itself, so hashes and
 * duplicate checks still behave. Production builds never offer this.
 */
export async function devCapture(text: string, now: () => number = Date.now) {
  const bytes = new TextEncoder().encode(text)
  return {
    capture: {
      base64: bytesToBase64(bytes),
      sha256: await sha256Hex(bytes),
      capturedAt: new Date(now()).toISOString(),
      inApp: process.env.NODE_ENV !== 'production',
      gps: null,
    } satisfies SlipCapture,
    ocr: { lines: text.split(/\r?\n/).map((t) => ({ text: t })) },
  }
}
