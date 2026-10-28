-- ============================================================
-- Seed the SIMO Rede slip profile (both sample slips: Millennium bim, Absa).
-- The JSON below must stay identical to
-- packages/core/src/slip/profiles/simo-rede.json (enforced by a core test).
-- ============================================================
insert into public.slip_profiles (name, network, version, match_keywords, config)
values (
  'simo-rede',
  'SIMO Rede',
  1,
  array['RECIBO', 'MONTANTE', 'AUTH CODE', 'RRN', 'TID', 'MID', 'BATCH', 'VERIFICACAO', 'SIMO', 'REDE'],
  $json$
{
  "name": "simo-rede",
  "network": "SIMO Rede",
  "version": 1,
  "matchKeywords": [
    "RECIBO",
    "MONTANTE",
    "AUTH CODE",
    "RRN",
    "TID",
    "MID",
    "BATCH",
    "VERIFICACAO",
    "SIMO",
    "REDE"
  ],
  "networkMarkers": [
    "SIMO",
    "REDE",
    "SIIMO",
    "SI10"
  ],
  "dateFormat": "DD/MM/YYYY",
  "utcOffset": "+02:00",
  "labels": {
    "recibo_no": [
      "RECIBO"
    ],
    "amount": [
      "MONTANTE",
      "VALOR",
      "TOTAL"
    ],
    "auth_code": [
      "AUTH CODE",
      "COD AUT",
      "COD AUTORIZACAO",
      "AUTORIZACAO",
      "AUTH"
    ],
    "rrn": [
      "RRN"
    ],
    "rc": [
      "RC"
    ],
    "tid": [
      "TID"
    ],
    "batch": [
      "BATCH",
      "LOTE"
    ],
    "mid": [
      "MID"
    ],
    "verification": [
      "VERIFICACAO"
    ]
  },
  "digitFields": {
    "recibo_no": {
      "min": 1,
      "max": 10
    },
    "auth_code": {
      "min": 6,
      "max": 6
    },
    "rrn": {
      "min": 12,
      "max": 12
    },
    "rc": {
      "min": 2,
      "max": 3
    },
    "tid": {
      "min": 8,
      "max": 8
    },
    "batch": {
      "min": 1,
      "max": 8
    },
    "mid": {
      "min": 15,
      "max": 15
    }
  },
  "txnTypes": [
    "COMPRA",
    "ANULACAO",
    "ESTORNO",
    "DEVOLUCAO",
    "REEMBOLSO",
    "CANCELAMENTO",
    "PRE-AUTORIZACAO",
    "LEVANTAMENTO"
  ],
  "approvalStatuses": [
    "APROVADA",
    "APROVADO",
    "RECUSADA",
    "RECUSADO",
    "NEGADA",
    "DECLINADA",
    "CANCELADA",
    "ANULADA"
  ],
  "copyTypes": {
    "COPIA DO CLIENTE": "CUSTOMER",
    "VIA DO CLIENTE": "CUSTOMER",
    "COPIA DO COMERCIANTE": "MERCHANT",
    "COPIA DO ESTABELECIMENTO": "MERCHANT",
    "VIA DO ESTABELECIMENTO": "MERCHANT",
    "COPIA DO LOJISTA": "MERCHANT"
  },
  "cardBrands": [
    "VISA",
    "MASTERCARD",
    "MAESTRO",
    "AMEX",
    "UNIONPAY",
    "SIMO"
  ],
  "bankBrands": {
    "MILLENNIUM": "Millennium bim",
    "BIM": "Millennium bim",
    "ABSA": "Absa",
    "BCI": "BCI",
    "STANDARD BANK": "Standard Bank",
    "MOZA": "Moza Banco",
    "FNB": "FNB",
    "NEDBANK": "Nedbank",
    "ECOBANK": "Ecobank",
    "ACCESS BANK": "Access Bank",
    "LETSHEGO": "Letshego",
    "SOCREMO": "Socremo",
    "UBA": "UBA",
    "FIRST CAPITAL": "First Capital Bank"
  },
  "currencyAliases": {
    "MZN": "MZN",
    "MT": "MZN",
    "MTN": "MZN",
    "ZAR": "ZAR",
    "USD": "USD",
    "US$": "USD"
  },
  "footerPattern": "^[A-Z]{3,5}[0-9]{8,12}$"
}
$json$::jsonb
)
on conflict (name, version) do update
  set config = excluded.config,
      match_keywords = excluded.match_keywords,
      network = excluded.network;
