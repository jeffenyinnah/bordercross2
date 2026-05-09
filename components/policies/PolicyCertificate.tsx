import { Document, Page, Text, View, StyleSheet, Image, Line, Svg } from '@react-pdf/renderer'
import type { Policy } from '@/lib/types'

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'BORDERCROSS'
const BRAND = process.env.NEXT_PUBLIC_BRAND_COLOR || '#0D47A1'
const LIMIT = '3,000,000.00'

function fmt(s: string) { return new Date(s).toLocaleDateString('en-GB') }
function fmtLong(s: string) { return new Date(s).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' }) }

/* ─── A4 Certificate ───────────────────────────────────────────────── */

const a4 = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#111', padding: 36, backgroundColor: '#fff' },
  // Header row
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  brandName: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: BRAND },
  brandSub: { fontSize: 8, color: '#555', marginTop: 1 },
  companyInfo: { textAlign: 'right', fontSize: 7, color: '#555', lineHeight: 1.5 },
  divider: { borderBottom: `1.5 solid ${BRAND}`, marginBottom: 10 },
  // Title block
  titleBlock: { textAlign: 'center', marginBottom: 10 },
  titleMain: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND, textTransform: 'uppercase' },
  titleSub: { fontSize: 9, color: '#555', marginTop: 2 },
  confirmText: { fontSize: 8, color: '#555', textAlign: 'center', marginBottom: 10, fontStyle: 'italic' },
  // Fields table
  fieldRow: { flexDirection: 'row', borderBottom: '0.5 solid #e5e7eb', paddingVertical: 4, alignItems: 'flex-start' },
  fieldLabel: { width: 200, fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#333' },
  fieldValue: { flex: 1, fontSize: 9, color: '#111' },
  // Fine print
  finePrint: { flexDirection: 'row', gap: 16, marginTop: 14 },
  finePrintCol: { flex: 1, fontSize: 6.5, color: '#666', lineHeight: 1.6 },
  finePrintTitle: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: '#333', marginBottom: 3, textDecoration: 'underline' },
  // Footer
  footer: { position: 'absolute', bottom: 28, left: 36, right: 36 },
  footerSig: { fontSize: 8, color: '#333', marginBottom: 16 },
  footerName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BRAND, textAlign: 'center', borderTop: '1 solid #ccc', paddingTop: 6 },
  qr: { width: 60, height: 60, position: 'absolute', right: 0, bottom: 0 },
})

type CP = Policy & { agent?: { full_name: string }; vehicle_type?: { name: string } }

export function PolicyCertificateA4({ policy, qrDataUrl }: { policy: CP; qrDataUrl?: string }) {
  const period = `${fmt(policy.start_date)} to ${fmt(policy.end_date)}`
  const vehicle = `${policy.vehicle_brand} ${policy.vehicle_model}`

  const fields = [
    ['RAMO/CLASS:', 'Seguro Automóvel/Motor Insurance'],
    ['TIPO/TYPE:', 'Third Party Only - Apenas Contra Terceiros'],
    ['NÚMERO DA APÓLICE/POLICY NUMBER:', policy.policy_number],
    ['LIMITE R.C / LIMIT:', LIMIT],
    ['PRÉMIO/PREMIUM:', `${policy.currency} ${Number(policy.premium_amount).toFixed(2)}`],
    ['SEGURADO/INSURED:', policy.client_name],
    ['VEÍCULO/VEHICLE:', vehicle],
    ['MATRÍCULA/REGISTRATION:', policy.plate_number],
    ['N° DO MOTOR/ENGINE NUMBER:', policy.engine_number ?? '—'],
    ['N° DE CHASSIS/CHASSIS NUMBER:', policy.chassis_number ?? '—'],
    ['PERÍODO/PERIOD:', period],
    ['LIMITES TERRITORIAIS/TERRITORIAL LIMITS:', 'Moçambique Only / Mozambique Only'],
  ] as [string, string][]

  if (policy.border) fields.splice(11, 0, ['POSTO FRONTEIRA/BORDER POST:', policy.border])
  if (policy.document_type) fields.splice(5, 0, ['TIPO DOC/DOCUMENT TYPE:', policy.document_type])

  return (
    <Document>
      <Page size="A4" style={a4.page}>
        {/* Header */}
        <View style={a4.headerRow}>
          <View>
            <Text style={a4.brandName}>{APP_NAME}</Text>
            <Text style={a4.brandSub}>Seguros · Insurance</Text>
          </View>
          <View style={a4.companyInfo}>
            <Text>MAPUTO (SEDE) - AV. MARGINAL, Nº 4067</Text>
            <Text>R/C, C.P. 3681</Text>
            <Text>TEL: (+258) 21 492 480 / 21 492 845/9</Text>
            <Text>EMAIL: info@{APP_NAME.toLowerCase().replace(/\s+/g, '')}.co.mz</Text>
          </View>
        </View>

        <View style={a4.divider} />

        {/* Title */}
        <View style={a4.titleBlock}>
          <Text style={a4.titleMain}>SEGURO AUTOMÓVEL – RESPONSABILIDADE CIVIL TURISTA</Text>
          <Text style={a4.titleSub}>TOURIST MOTOR COVER</Text>
        </View>

        <Text style={a4.confirmText}>
          This certificate serves to confirm that {APP_NAME.toUpperCase()} insures the following vehicle.
        </Text>

        {/* Fields */}
        {fields.map(([label, value]) => (
          <View key={label} style={a4.fieldRow}>
            <Text style={a4.fieldLabel}>{label}</Text>
            <Text style={a4.fieldValue}>{value}</Text>
          </View>
        ))}

        {/* Fine print */}
        <View style={a4.finePrint}>
          <View style={a4.finePrintCol}>
            <Text style={a4.finePrintTitle}>FREE HOLD</Text>
            <Text>
              O presente seguro, efectuado na Companhia {APP_NAME}, cobre o Tomador do Seguro,
              bem como o condutor com o seu consentimento, nos termos da legislação em vigor,
              a responsabilidade civil perante terceiros, nos limites do capital segurado inscrito
              na apólice, pelos danos corporais e/ou materiais causados a terceiros, resultantes
              da circulação do veículo seguro durante o período de vigência da apólice.
            </Text>
          </View>
          <View style={a4.finePrintCol}>
            <Text style={a4.finePrintTitle}>PRAS MOLE</Text>
            <Text>
              This insurance, contracted with {APP_NAME}, covers the Policyholder, as well as the
              driver with their consent, in accordance with current regulations, the civil liability
              to third parties, within the limits of the insured capital inscribed in the policy,
              for bodily and/or material damage caused to third parties resulting from the circulation
              of the insured vehicle during the period of validity of the policy.
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={a4.footer}>
          <Text style={a4.footerSig}>
            Assinatura/Signature: _______________________________{'  '}
            Data/Date: {fmt(policy.created_at)}
          </Text>
          <Text style={a4.footerName}>{APP_NAME.toUpperCase()} SEGUROS</Text>
          {qrDataUrl && <Image src={qrDataUrl} style={a4.qr} />}
        </View>
      </Page>
    </Document>
  )
}

/* ─── Receipt Certificate (thermal 80mm) ──────────────────────────── */

const rx = StyleSheet.create({
  page: { fontFamily: 'Courier', fontSize: 8, color: '#000', padding: 10, backgroundColor: '#fff' },
  center: { textAlign: 'center' },
  bold: { fontFamily: 'Courier-Bold' },
  header: { textAlign: 'center', marginBottom: 6 },
  headerName: { fontSize: 12, fontFamily: 'Courier-Bold', marginBottom: 2 },
  headerSub: { fontSize: 7.5, lineHeight: 1.4 },
  dash: { borderBottom: '1 dashed #888', marginVertical: 5 },
  contactBlock: { fontSize: 7, lineHeight: 1.5, marginBottom: 4 },
  qr: { width: 100, height: 100, alignSelf: 'center', marginVertical: 8 },
  confirmText: { fontSize: 7.5, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 6 },
  sectionTitle: { fontFamily: 'Courier-Bold', fontSize: 8, textAlign: 'center', marginBottom: 4, textDecoration: 'underline' },
  row: { flexDirection: 'row', marginBottom: 3 },
  lbl: { fontFamily: 'Courier-Bold', fontSize: 7.5, width: 140 },
  val: { fontSize: 7.5, flex: 1 },
  footer: { textAlign: 'center', fontSize: 7, marginTop: 8 },
  footerName: { fontFamily: 'Courier-Bold', fontSize: 9, textAlign: 'center', marginTop: 6 },
})

export function PolicyReceipt({ policy, qrDataUrl }: { policy: CP; qrDataUrl?: string }) {
  const period = `${fmtLong(policy.start_date)} TO ${fmtLong(policy.end_date)}`
  const now = new Date()
  const printedOn = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

  const R = ({ l, v }: { l: string; v?: string | null }) => {
    if (!v) return null
    return (
      <View style={rx.row}>
        <Text style={rx.lbl}>{l}</Text>
        <Text style={rx.val}>{v}</Text>
      </View>
    )
  }

  return (
    <Document>
      <Page size={[226, 800]} style={rx.page}>
        {/* Header */}
        <View style={rx.header}>
          <Text style={rx.headerName}>{APP_NAME.toUpperCase()} SEGUROS</Text>
          <Text style={rx.headerSub}>TOURIST MOTOR COVER</Text>
          <Text style={rx.headerSub}>SEGURO AUTOMÓVEL –</Text>
          <Text style={rx.headerSub}>RESPONSABILIDADE CIVIL TURISTA</Text>
        </View>

        <View style={rx.dash} />

        {/* Contact */}
        <View style={rx.contactBlock}>
          <Text style={[rx.center, rx.bold]}>CONTACTOS / CONTACTS</Text>
          <Text style={rx.center}>MAPUTO (SEDE) – AV. MARGINAL, Nº 4067, R/C, C.P. 3681</Text>
          <Text style={rx.center}>TEL: (+258) 21 492 480 / 21 492 845/9</Text>
          <Text style={rx.center}>CEL: (+258) 82 306 4886</Text>
          <Text style={rx.center}>EMAIL: info@{APP_NAME.toLowerCase().replace(/\s+/g, '')}.co.mz</Text>
          <Text style={rx.center}>WEBSITE: WWW.{APP_NAME.toUpperCase().replace(/\s+/g, '')}.CO.MZ</Text>
        </View>

        <View style={rx.dash} />

        {/* QR Code */}
        {qrDataUrl && <Image src={qrDataUrl} style={rx.qr} />}

        {/* Confirm text */}
        <Text style={rx.confirmText}>
          THIS CERTIFICATE SERVES TO CONFIRM{'\n'}
          THAT {APP_NAME.toUpperCase()} SEGUROS INSURES THE{'\n'}
          FOLLOWING VEHICLE.
        </Text>

        <View style={rx.dash} />

        <Text style={rx.sectionTitle}>DETALHES DA APÓLICE / POLICY DETAILS</Text>

        <R l="RAMO/CLASS:" v="SEGURO AUTOMÓVEL/MOTOR INSURANCE" />
        <R l="TIPO/TYPE:" v="THIRD PARTY ONLY – APENAS CONTRA TERCEIROS" />
        <R l="APÓLICE/POLICY N°:" v={policy.policy_number} />
        <R l="LIMITE R.C / LIMIT:" v={LIMIT} />
        <R l="PRÉMIO / PREMIUM:" v={`${Number(policy.premium_amount).toFixed(2)} ${policy.currency}`} />
        <R l="SEGURADO/INSURED:" v={policy.client_name?.toUpperCase()} />
        <R l="VEÍCULO/VEHICLE:" v={`${policy.vehicle_brand} ${policy.vehicle_model}`.toUpperCase()} />
        <R l="MATRÍCULA/REGISTRATION:" v={policy.plate_number} />
        {policy.engine_number && <R l="N.° MOTOR/ENGINE:" v={policy.engine_number} />}
        {policy.chassis_number && <R l="N.° CHASSIS/CHASSIS:" v={policy.chassis_number} />}
        <R l="PERÍODO/PERIOD:" v={period} />
        {policy.border && <R l="FRONTEIRA/BORDER:" v={policy.border.toUpperCase()} />}
        {policy.document_type && <R l="TIPO DOC/DOC TYPE:" v={policy.document_type.toUpperCase()} />}
        <R l="LIMITES TERRITORIAIS:" v="MOÇAMBIQUE ONLY" />

        <View style={rx.dash} />

        {/* Signature */}
        <Text style={[rx.center, { marginTop: 20, marginBottom: 4 }]}>
          _______________________
        </Text>
        <Text style={[rx.center, rx.bold, { fontSize: 7 }]}>Assinatura / Signature</Text>

        <View style={rx.dash} />

        <Text style={rx.footerName}>{APP_NAME.toUpperCase()} SEGUROS</Text>
        <Text style={[rx.footer, { marginTop: 4 }]}>
          IMPRESSO EM / PRINTED ON: {printedOn}
        </Text>
      </Page>
    </Document>
  )
}

/* ─── Legacy alias ─────────────────────────────────────────────────── */
export { PolicyCertificateA4 as PolicyCertificate }
