import { describe, expect, it } from 'vitest'
import {
  SIMO_REDE_PROFILE, containsPan, linesFromText, maskPan, parseSlip, parseSlipProfile,
  selectProfile, type ParsedSlip, type SlipFieldName,
} from '../src'
import { SLIP_1, SLIP_2, withLine } from './fixtures/slips'

const parse = (text: string, conf?: number) => parseSlip(linesFromText(text, conf), SIMO_REDE_PROFILE)
const v = (s: ParsedSlip, f: SlipFieldName) => s.fields[f].value

const REQUIRED: SlipFieldName[] = [
  'amount', 'currency', 'approval_status', 'rc', 'txn_type', 'tid', 'mid', 'rrn', 'auth_code', 'txn_at',
]

describe('sample slip 1 (Millennium bim)', () => {
  const s = parse(SLIP_1)

  it('extracts every field', () => {
    expect(v(s, 'bank_brand')).toBe('Millennium bim')
    expect(v(s, 'merchant_name')).toBe('RESTAURANTE MARINA')
    expect(v(s, 'merchant_address')).toBe('AV. 10 DE NOVEMBRO, Maputo-Mozambique')
    expect(v(s, 'recibo_no')).toBe('712')
    expect(v(s, 'card_type')).toBe('VISA DEBIT')
    expect(v(s, 'pan_last4')).toBe('8622')
    expect(v(s, 'aid')).toBe('A0000000031010')
    expect(v(s, 'txn_type')).toBe('COMPRA')
    expect(v(s, 'amount')).toBe('3000.00')
    expect(v(s, 'currency')).toBe('MZN')
    expect(v(s, 'approval_status')).toBe('APROVADA')
    expect(v(s, 'txn_date')).toBe('2026-10-11')
    expect(v(s, 'txn_time')).toBe('13:39:54')
    expect(v(s, 'txn_at')).toBe('2026-10-11T13:39:54+02:00')
    expect(v(s, 'auth_code')).toBe('727255')
    expect(v(s, 'rrn')).toBe('628451143467')
    expect(v(s, 'rc')).toBe('000')
    expect(v(s, 'tid')).toBe('00236255')
    expect(v(s, 'batch')).toBe('518')
    expect(v(s, 'mid')).toBe('000000000130941')
    expect(v(s, 'verification')).toBe('PIN OK')
    expect(v(s, 'copy_type')).toBe('COPIA DO CLIENTE')
    expect(v(s, 'copy_kind')).toBe('CUSTOMER')
    expect(v(s, 'footer_code')).toBe('TAUN1268311024')
  })

  it('is fully confident with no warnings', () => {
    for (const f of REQUIRED) {
      expect(s.fields[f].valid, f).toBe(true)
      expect(s.fields[f].confidence, f).toBe(1)
      expect(s.fields[f].repaired, f).toBe(false)
    }
    expect(s.warnings).toEqual([])
  })

  it('scales confidence by the OCR line confidence', () => {
    const low = parse(SLIP_1, 0.8)
    expect(low.fields.rrn.confidence).toBe(0.8)
    expect(low.fields.rrn.valid).toBe(true)
  })
})

describe('sample slip 2 (Absa, crumpled)', () => {
  const s = parse(SLIP_2)

  it('reads the amount printed above its label', () => {
    expect(v(s, 'amount')).toBe('30.00')
    expect(v(s, 'currency')).toBe('MZN')
    expect(s.fields.amount.source).toBe('label-adjacent')
    expect(s.fields.amount.confidence).toBeLessThan(1)
  })

  it('joins date and time from separate lines', () => {
    expect(v(s, 'txn_at')).toBe('2026-10-09T09:35:47+02:00')
  })

  it('extracts the rest', () => {
    expect(v(s, 'bank_brand')).toBe('Absa')
    expect(v(s, 'merchant_name')).toBe('REVIMO-COSTA DO SOL')
    expect(v(s, 'merchant_address')).toBe('PORTAGEM COSTA DO SOL, Maputo-Mozambique')
    expect(v(s, 'recibo_no')).toBe('654')
    expect(v(s, 'auth_code')).toBe('923132')
    expect(v(s, 'rrn')).toBe('628216339710')
    expect(v(s, 'tid')).toBe('00256885')
    expect(v(s, 'batch')).toBe('288')
    expect(v(s, 'mid')).toBe('000000000146159')
    expect(v(s, 'footer_code')).toBe('TAUN1268040526')
    expect(s.warnings).toEqual([])
  })
})

describe('profile selection', () => {
  it('selects SIMO Rede for both samples', () => {
    expect(selectProfile(linesFromText(SLIP_1), [SIMO_REDE_PROFILE])?.name).toBe('simo-rede')
    expect(selectProfile(linesFromText(SLIP_2), [SIMO_REDE_PROFILE])?.name).toBe('simo-rede')
  })

  it('rejects text that is not a slip', () => {
    const receipt = 'SUPERMERCADO\nPAO 2x 25.00\nLEITE 60.00\nTOTAL 110.00\nOBRIGADO'
    expect(selectProfile(linesFromText(receipt), [SIMO_REDE_PROFILE])).toBeNull()
  })
})

describe('OCR look-alike repair (numeric fields only)', () => {
  it('repairs O/0, I/l/1, B/8, S/5, G/6 and lowers confidence', () => {
    let t = withLine(SLIP_1, 'RRN:628451143467    RC: 000', 'RRN:62845I1434G7    RC: OOO')
    t = withLine(t, 'TID: 00236255   BATCH:518', 'TID: OO236255   BATCH:51B')
    t = withLine(t, 'MID: 000000000130941', 'MID: OOOOOOOOO13O94l')
    t = withLine(t, 'AUTH CODE: 727255', 'AUTH CODE: 72725S')
    const s = parse(t)
    expect(v(s, 'rrn')).toBe('628451143467')
    expect(v(s, 'rc')).toBe('000')
    expect(v(s, 'tid')).toBe('00236255')
    expect(v(s, 'batch')).toBe('518')
    expect(v(s, 'mid')).toBe('000000000130941')
    expect(v(s, 'auth_code')).toBe('727255')
    for (const f of ['rrn', 'rc', 'tid', 'batch', 'mid', 'auth_code'] as const) {
      expect(s.fields[f].repaired, f).toBe(true)
      expect(s.fields[f].valid, f).toBe(true)
      expect(s.fields[f].confidence, f).toBeLessThan(1)
    }
    // more repairs => lower confidence
    expect(s.fields.mid.confidence).toBeLessThan(s.fields.auth_code.confidence)
  })

  it('repairs look-alikes in date, time and amount', () => {
    let t = withLine(SLIP_1, '13:39:54      11/10/2026', 'I3:39:S4      1I/1O/2O26')
    t = withLine(t, 'MONTANTE:      3000.00 MZN', 'MONTANTE:      3OOO.0O MZN')
    const s = parse(t)
    expect(v(s, 'txn_at')).toBe('2026-10-11T13:39:54+02:00')
    expect(s.fields.txn_at.repaired).toBe(true)
    expect(v(s, 'amount')).toBe('3000.00')
    expect(s.fields.amount.repaired).toBe(true)
  })

  it('does not "repair" letters in text fields', () => {
    const s = parse(SLIP_1)
    expect(v(s, 'merchant_name')).toBe('RESTAURANTE MARINA')
    expect(v(s, 'verification')).toBe('PIN OK')
  })
})

describe('noisy labels and layout', () => {
  it('matches OCR-damaged labels', () => {
    let t = withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'M0NTANTE:      3000.00 MZN')
    t = withLine(t, 'AUTH CODE: 727255', 'AUTH C0DE: 727255')
    t = withLine(t, 'VERIFICACAO: PIN OK', 'VERIFICAÇÃO: PIN OK')
    const s = parse(t)
    expect(v(s, 'amount')).toBe('3000.00')
    expect(v(s, 'auth_code')).toBe('727255')
    expect(v(s, 'verification')).toBe('PIN OK')
  })

  it('handles missing colons and values glued to labels', () => {
    let t = withLine(SLIP_1, 'RRN:628451143467    RC: 000', 'RRN 628451143467 RC 000')
    t = withLine(t, 'TID: 00236255   BATCH:518', 'TID00236255 BATCH518')
    const s = parse(t)
    expect(v(s, 'rrn')).toBe('628451143467')
    expect(v(s, 'rc')).toBe('000')
    expect(v(s, 'tid')).toBe('00236255')
    expect(v(s, 'batch')).toBe('518')
  })

  it('reads a value printed on the line below its label', () => {
    const t = withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE:\n3000.00 MZN')
    const s = parse(t)
    expect(v(s, 'amount')).toBe('3000.00')
    expect(s.fields.amount.source).toBe('label-adjacent')
  })

  it('survives junk lines, lowercase and irregular spacing', () => {
    const noisy = SLIP_1.split('\n')
      .flatMap((l, i) => (i % 4 === 0 ? [l.toLowerCase(), '. , ~', ''] : [`  ${l.replace(/ +/g, '   ')}  `]))
      .join('\n')
    const s = parse(noisy)
    expect(v(s, 'amount')).toBe('3000.00')
    expect(v(s, 'rrn')).toBe('628451143467')
    expect(v(s, 'tid')).toBe('00236255')
    expect(v(s, 'mid')).toBe('000000000130941')
    expect(v(s, 'txn_at')).toBe('2026-10-11T13:39:54+02:00')
    expect(v(s, 'approval_status')).toBe('APROVADA')
    expect(v(s, 'txn_type')).toBe('COMPRA')
  })
})

describe('amount formats', () => {
  it.each([
    ['3000.00 MZN', '3000.00', 'MZN'],
    ['3,000.00 MZN', '3000.00', 'MZN'],
    ['3.000,00 MZN', '3000.00', 'MZN'],
    ['3000,00 MT', '3000.00', 'MZN'],
    ['MZN 3000.00', '3000.00', 'MZN'],
    ['250.50 ZAR', '250.50', 'ZAR'],
    ['20.00 USD', '20.00', 'USD'],
    ['3000.00 MZM', '3000.00', 'MZN'],
  ])('%s', (printed, amount, currency) => {
    const s = parse(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', `MONTANTE: ${printed}`))
    expect(v(s, 'amount')).toBe(amount)
    expect(v(s, 'currency')).toBe(currency)
  })

  it('flags an amount without currency as invalid', () => {
    const s = parse(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE: 3000.00'))
    expect(v(s, 'amount')).toBe('3000.00')
    expect(s.fields.amount.valid).toBe(false)
    expect(s.warnings).toContain('MISSING:currency')
  })
})

describe('missing and invalid fields', () => {
  it('reports missing fields with zero confidence', () => {
    let t = withLine(SLIP_1, 'RRN:628451143467    RC: 000', null)
    t = withLine(t, 'AUTH CODE: 727255', null)
    const s = parse(t)
    expect(s.fields.rrn).toMatchObject({ value: null, confidence: 0, valid: false, source: 'none' })
    expect(s.fields.auth_code.value).toBeNull()
    expect(s.warnings).toEqual(expect.arrayContaining(['MISSING:rrn', 'MISSING:rc', 'MISSING:auth_code']))
  })

  it('marks wrong digit lengths invalid', () => {
    let t = withLine(SLIP_1, 'TID: 00236255   BATCH:518', 'TID: 0023625   BATCH:518')
    t = withLine(t, 'MID: 000000000130941', 'MID: 00000000013094')
    const s = parse(t)
    expect(s.fields.tid).toMatchObject({ value: '0023625', valid: false })
    expect(s.fields.tid.confidence).toBeLessThanOrEqual(0.4)
    expect(s.fields.mid.valid).toBe(false)
    expect(s.warnings).toEqual(expect.arrayContaining(['INVALID:tid', 'INVALID:mid']))
  })

  it('marks an impossible date invalid', () => {
    const s = parse(withLine(SLIP_1, '13:39:54      11/10/2026', '13:39:54      32/13/2026'))
    expect(s.fields.txn_date.valid).toBe(false)
    expect(s.fields.txn_at.valid).toBe(false)
  })
})

describe('transaction outcomes and copies', () => {
  it('reads a declined slip', () => {
    let t = withLine(SLIP_1, 'APROVADA', 'RECUSADA')
    t = withLine(t, 'RRN:628451143467    RC: 000', 'RRN:628451143467    RC: 051')
    const s = parse(t)
    expect(v(s, 'approval_status')).toBe('RECUSADA')
    expect(v(s, 'rc')).toBe('051')
  })

  it.each(['DEVOLUCAO', 'ANULACAO', 'ESTORNO', 'DEVOLUÇÃO'])('reads transaction type %s', (type) => {
    const s = parse(withLine(SLIP_1, 'COMPRA', type))
    expect(v(s, 'txn_type')).toBe(type.normalize('NFD').replace(/[̀-ͯ]/g, ''))
  })

  it('tolerates a damaged status word', () => {
    const s = parse(withLine(SLIP_1, 'APROVADA', 'APR0VADA'))
    expect(v(s, 'approval_status')).toBe('APROVADA')
    expect(s.fields.approval_status.confidence).toBe(1)
    const s2 = parse(withLine(SLIP_1, 'APROVADA', 'APROVAOA'))
    expect(v(s2, 'approval_status')).toBe('APROVADA')
    expect(s2.fields.approval_status.confidence).toBeLessThan(1)
  })

  it('recognises merchant copy wording', () => {
    const s = parse(withLine(SLIP_1, 'COPIA DO CLIENTE', 'COPIA DO ESTABELECIMENTO'))
    expect(v(s, 'copy_type')).toBe('COPIA DO ESTABELECIMENTO')
    expect(v(s, 'copy_kind')).toBe('MERCHANT')
  })
})

describe('other bank branding', () => {
  it('detects the bank and keeps it out of the merchant lines', () => {
    const t = withLine(SLIP_1, 'Millennium bim', 'BCI')
    const s = parse(t)
    expect(v(s, 'bank_brand')).toBe('BCI')
    expect(v(s, 'merchant_name')).toBe('RESTAURANTE MARINA')
  })

  it('leaves bank_brand empty for an unknown bank without failing', () => {
    const s = parse(withLine(SLIP_1, 'Millennium bim', 'Banco Desconhecido'))
    expect(v(s, 'bank_brand')).toBeNull()
    expect(v(s, 'tid')).toBe('00236255')
  })
})

describe('date formats come from the profile', () => {
  it('parses YYYY-MM-DD with a configured profile', () => {
    const iso = parseSlipProfile({ ...SIMO_REDE_PROFILE, name: 'iso-bank', dateFormat: 'YYYY-MM-DD' })
    const t = withLine(SLIP_1, '13:39:54      11/10/2026', '2026-10-11 13:39:54')
    const s = parseSlip(linesFromText(t), iso)
    expect(v(s, 'txn_at')).toBe('2026-10-11T13:39:54+02:00')
  })

  it('reads DD/MM (day first), never MM/DD', () => {
    const s = parse(withLine(SLIP_1, '13:39:54      11/10/2026', '13:39:54      03/04/2026'))
    expect(v(s, 'txn_date')).toBe('2026-04-03')
  })
})

describe('card number safety', () => {
  it('never returns a full card number', () => {
    const t = withLine(SLIP_1, 'XXXXXXXXXXXX8622', '4111 1111 1111 1111')
    const s = parse(t)
    expect(v(s, 'pan_last4')).toBe('1111')
    expect(s.warnings).toContain('UNMASKED_PAN_SEEN')
    expect(containsPan(s.maskedText)).toBe(false)
    expect(JSON.stringify(s)).not.toMatch(/4111\s?1111\s?1111\s?1111/)
  })

  it('masks PANs but keeps MIDs and RRNs', () => {
    expect(maskPan('CARD 4111111111111111 MID 000000000130941 RRN 628451143467'))
      .toBe('CARD XXXXXXXXXXXX1111 MID 000000000130941 RRN 628451143467')
    expect(maskPan('5500-0000-0000-0004')).toBe('XXXXXXXXXXXX0004')
  })
})
