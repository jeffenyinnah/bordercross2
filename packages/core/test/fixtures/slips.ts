// Hand transcriptions of docs/sample-slips/*.jpeg in the order an OCR engine
// typically returns lines. Logos come through as noise ("SI10 rede").

/** docs/sample-slips/1.jpeg — Millennium bim, Restaurante Marina */
export const SLIP_1 = `SI10 rede
Millennium bim
RESTAURANTE MARINA
AV. 10 DE NOVEMBRO
Maputo-Mozambique
RECIBO #712
Visa Debit
XXXXXXXXXXXX8622
A0000000031010
COMPRA
============================
MONTANTE:      3000.00 MZN
APROVADA
13:39:54      11/10/2026
AUTH CODE: 727255
RRN:628451143467    RC: 000
TID: 00236255   BATCH:518
MID: 000000000130941
VERIFICACAO: PIN OK
COPIA DO CLIENTE
TAUN1268311024`

/**
 * docs/sample-slips/2.jpeg — Absa, Revimo Costa do Sol. The slip is crumpled:
 * the amount sits above its label and date/time come out on separate lines.
 */
export const SLIP_2 = `SIMO
rede
absa
REVIMO-COSTA DO SOL
PORTAGEM COSTA DO SOL
Maputo-Mozambique
RECIBO #654
Visa Debit
XXXXXXXXXXXX8622
A0000000031010
COMPRA
=============================
30.00 MZN
MONTANTE:
APROVADA
09/10/2026
09:35:47
AUTH CODE: 923132
RRN:628216339710      RC: 000
TID: 00256885    BATCH:288
MID: 000000000146159
VERIFICACAO: PIN OK
COPIA DO CLIENTE
TAUN1268040526`

/** Replace one line of a fixture (exact match) — for building synthetic variants. */
export function withLine(slip: string, from: string, to: string | null): string {
  const lines = slip.split('\n')
  const i = lines.indexOf(from)
  if (i < 0) throw new Error(`line not in fixture: ${from}`)
  if (to === null) lines.splice(i, 1)
  else lines[i] = to
  return lines.join('\n')
}
