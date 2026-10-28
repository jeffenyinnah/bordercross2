/**
 * End-to-end against a running Supabase (local stack). Skipped unless
 * IT_SUPABASE_URL, IT_ANON_KEY and IT_SERVICE_ROLE_KEY are set, e.g.:
 *   eval "$(supabase status -o env | sed 's/^/IT_/; s/IT_API_URL/IT_SUPABASE_URL/')" && npx vitest run test/integration.test.ts
 */
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { renderToBuffer } from '@react-pdf/renderer'
import { PolicyReceipt, type CertificatePolicy } from '@bordercross/certificate'
import { AgentService } from '@/lib/agent-app/agent'
import { createSupabaseApi } from '@/lib/agent-app/api'
import { MemoryStore } from '@/lib/agent-app/store/memory'

const URL = process.env.IT_SUPABASE_URL
const ANON = process.env.IT_ANON_KEY
const SERVICE = process.env.IT_SERVICE_ROLE_KEY

describe.skipIf(!URL || !ANON || !SERVICE)('mobile agent against Supabase', () => {
  it('logs in, leases, issues online and offline, verifies and renders the certificate', async () => {
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } })
    const email = `it-${Date.now()}@test.local`
    const password = 'Test-pass-1234'

    // fixtures: agent at Ressano Garcia with 20 000 MZN, insurer allows 5 000 MZN offline
    const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userError) throw userError
    const { data: insurer } = await admin.from('insurers').select('id, settings').eq('code', 'DEFAULT').single()
    const { data: rgar } = await admin.from('border_posts').select('id').eq('code', 'RGAR').single()
    await admin.from('insurers').update({
      settings: { ...insurer!.settings, offline_credit_allowance: 5000, number_block_size: 20 },
    }).eq('id', insurer!.id)
    const { error: profileError } = await admin.from('profiles').insert({
      id: user.user.id, full_name: 'IT Agent', email, role: 'agent', insurer_id: insurer!.id, border_post_id: rgar!.id,
    })
    if (profileError) throw profileError
    await admin.from('credit_wallets').insert({ agent_id: user.user.id, balance_mzn: 20000 })
    const { data: vt } = await admin.from('vehicle_types')
      .insert({ name: `IT Light ${Date.now()}`, price_mzn: 1500 }).select('id').single()

    const store = new MemoryStore()
    const agent = new AgentService(store, createSupabaseApi(createClient(URL!, ANON!, { auth: { persistSession: false } })), { platform: 'android', model: 'IT' })

    const { warnings } = await agent.login(email, password)
    expect(warnings).toEqual([])
    let state = await agent.state()
    expect(Math.abs(state.sync.clockOffsetMs)).toBeLessThan(60_000)
    expect(agent.offlineCapacity(state, 'RGAR')).toEqual({ numbers: 20, credit: 500_000 })
    expect(Number(state.snapshot.wallet!.balance_mzn)).toBe(15000)

    const details = {
      policy_type: 'monthly' as const, vehicle_type_ids: [vt!.id],
      client_name: 'Integration Client', plate_number: 'IT 001 MP', vehicle_brand: 'Toyota', vehicle_model: 'Corolla',
      start_date: new Date().toISOString().slice(0, 10),
    }

    const online = await agent.issue({ details, borderPostId: rgar!.id, paymentMethod: 'VIRTUAL_CREDIT', online: true })
    if (!online.ok) throw new Error(online.error)
    // server numbering continues after the device's leased block
    const onlineSeq = Number(online.policy.policy_number.slice(-6))
    expect(onlineSeq).toBeGreaterThan(state.numberLeases[0].end_seq)

    const offline = await agent.issue({ details, borderPostId: rgar!.id, paymentMethod: 'VIRTUAL_CREDIT', online: false })
    if (!offline.ok) throw new Error(offline.error)
    expect(offline.policy.policy_number).toBe(
      `RGAR-${new Date().getUTCFullYear()}-${String(state.numberLeases[0].start_seq).padStart(6, '0')}`)
    state = await agent.state()
    expect(agent.offlineCapacity(state, 'RGAR').credit).toBe(350_000)
    expect(state.pendingCount).toBe(1)

    const anon = createClient(URL!, ANON!, { auth: { persistSession: false } })
    const token = (online.policy.data as { verification_token: string }).verification_token
    const { data: verified } = await anon.rpc('verify_policy', { p_token: token })
    expect(verified).toMatchObject({ valid: true, policy_number: online.policy.policy_number, plate_number: 'IT 001 MP' })
    expect(verified).not.toHaveProperty('client_name')

    for (const p of [online.policy, offline.policy]) {
      const pdf = await renderToBuffer(createElement(PolicyReceipt, {
        policy: p.data as unknown as CertificatePolicy, brand: { appName: 'BORDERCROSS', color: '#0D47A1' },
      }) as never)
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    }

    await admin.from('insurers').update({ settings: insurer!.settings }).eq('id', insurer!.id)
  }, 60_000)
})
