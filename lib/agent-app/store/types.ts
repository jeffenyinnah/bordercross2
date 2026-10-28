/**
 * Device-local storage. Everything the agent needs offline lives here:
 * session, snapshot, leases, issued policies and the ordered outbox.
 * On a phone this is SQLCipher (encrypted at rest); tests and browser dev use memory.
 */

/** pushed in seq order: a card sale queues its policy, then its payment */
export type OutboxKind = 'policy' | 'card_payment'

/** kv key prefix of encrypted slip photos waiting for upload, by payment client_uuid */
export const SLIP_IMAGE_PREFIX = 'slip_image:'

export interface OutboxItem {
  /** assigned by the store; push order */
  seq?: number
  client_uuid: string
  kind: OutboxKind
  payload: unknown
  created_at: string
  attempts: number
  last_error: string | null
}

/** A policy issued on this device, kept for reprinting. */
export interface LocalPolicy {
  client_uuid: string
  policy_number: string
  /** certificate fields (CertificatePolicy) plus verification_token */
  data: Record<string, unknown>
  issued_offline: boolean
  created_at: string
  /** the server has it (online sales always; offline sales once pushed) */
  synced?: boolean
}

export type StoreOp =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'remove'; key: string }
  | { type: 'outbox'; item: OutboxItem }
  /** the server acknowledged the item */
  | { type: 'outbox_remove'; client_uuid: string }
  /** a push failed; the item stays in place and is retried */
  | { type: 'outbox_error'; client_uuid: string; error: string }
  | { type: 'policy'; policy: LocalPolicy }

export interface LocalStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  /** All operations succeed or none do (a sale must not use a number without queuing it). */
  commit(ops: StoreOp[]): Promise<void>
  listOutbox(): Promise<OutboxItem[]>
  listPolicies(limit?: number): Promise<LocalPolicy[]>
  getPolicy(clientUuid: string): Promise<LocalPolicy | null>
  /** Wipe everything except kv keys starting with keepPrefix (e.g. the new session). */
  clear(keepPrefix?: string): Promise<void>
}
