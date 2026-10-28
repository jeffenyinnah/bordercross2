import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIMO_REDE_PROFILE, parseSlipProfile, slipProfileConfigSchema } from '../src'
import simoRede from '../src/slip/profiles/simo-rede.json'

const MIGRATIONS = join(__dirname, '../../../supabase/migrations')

describe('slip profile config', () => {
  it('SIMO Rede JSON satisfies the schema', () => {
    expect(slipProfileConfigSchema.safeParse(simoRede).success).toBe(true)
    expect(SIMO_REDE_PROFILE.name).toBe('simo-rede')
  })

  it('rejects a malformed profile', () => {
    expect(() => parseSlipProfile({ ...simoRede, dateFormat: 'D/M/Y' })).toThrow()
    expect(() => parseSlipProfile({ ...simoRede, utcOffset: 'CAT' })).toThrow()
    const { labels, ...noLabels } = simoRede
    void labels
    expect(() => parseSlipProfile(noLabels)).toThrow()
  })

  it('the seed migration carries exactly the same JSON as the package', () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith('_seed_simo_rede_slip_profile.sql'))
    expect(file).toBeDefined()
    const sql = readFileSync(join(MIGRATIONS, file!), 'utf8')
    const json = /\$json\$([\s\S]*?)\$json\$/.exec(sql)?.[1]
    expect(json).toBeDefined()
    expect(JSON.parse(json!)).toEqual(simoRede)
  })
})
