import type { LocalStore } from './store/types'

/**
 * Local unlock PIN. The session itself stays in the encrypted store; the PIN
 * keeps a lost or borrowed phone from being used. Too many wrong attempts
 * force an online login.
 */
const KEY = 'pin'
const ITERATIONS = 150_000
export const MAX_PIN_ATTEMPTS = 5

interface StoredPin {
  salt: string
  hash: string
  iterations: number
  failures: number
}

const toHex = (b: ArrayBuffer | Uint8Array) =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)))

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return toHex(bits)
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function isValidPin(pin: string) {
  return /^\d{4,8}$/.test(pin) && !/^(\d)\1+$/.test(pin) && !'0123456789'.includes(pin) && !'9876543210'.includes(pin)
}

export async function hasPin(store: LocalStore) {
  return (await store.get<StoredPin>(KEY)) !== null
}

export async function setPin(store: LocalStore, pin: string) {
  if (!isValidPin(pin)) throw new Error('Use 4 to 8 digits, not all the same and not a sequence')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  await store.set(KEY, { salt: toHex(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS, failures: 0 } satisfies StoredPin)
}

/** ok, or how many attempts are left (0 = locked: online login required). */
export async function verifyPin(store: LocalStore, pin: string): Promise<{ ok: boolean; attemptsLeft: number }> {
  const stored = await store.get<StoredPin>(KEY)
  if (!stored || stored.failures >= MAX_PIN_ATTEMPTS) return { ok: false, attemptsLeft: 0 }
  const ok = equal(await derive(pin, fromHex(stored.salt), stored.iterations), stored.hash)
  const failures = ok ? 0 : stored.failures + 1
  await store.set(KEY, { ...stored, failures })
  return { ok, attemptsLeft: MAX_PIN_ATTEMPTS - failures }
}

export async function clearPin(store: LocalStore) {
  await store.remove(KEY)
}
