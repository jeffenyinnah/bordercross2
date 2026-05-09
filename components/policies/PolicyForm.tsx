'use client'

import { useState, useTransition, useRef } from 'react'
import { toast } from 'sonner'
import { createPolicy } from '@/lib/actions/policies'
import { createClient } from '@/lib/supabase/client'
import { todayISO, calculateEndDate } from '@/lib/utils/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VehicleTypeTable } from './VehicleTypeTable'
import { Upload, X } from 'lucide-react'
import type { VehicleType, Currency, CreditWallet, BorderPost } from '@/lib/types'

const STATIC_BORDERS = [
  { id: 'rgar', name: 'Ressano Garcia', code: 'RGAR' },
  { id: 'nama', name: 'Namaacha', code: 'NAMA' },
  { id: 'poro', name: 'Ponta do Ouro', code: 'PORO' },
  { id: 'chic', name: 'Chicualacuala', code: 'CHIC' },
  { id: 'nyam', name: 'Nyamapanda', code: 'NYAM' },
  { id: 'zobu', name: 'Zobue', code: 'ZOBU' },
  { id: 'caia', name: 'Caia', code: 'CAIA' },
  { id: 'marr', name: 'Marromeu', code: 'MARR' },
  { id: 'mila', name: 'Milange', code: 'MILA' },
  { id: 'mand', name: 'Mandimba', code: 'MAND' },
  { id: 'mued', name: 'Mueda', code: 'MUED' },
  { id: 'moci', name: 'Mocimboa da Praia', code: 'MOCI' },
]

const DOCUMENT_TYPES = ['Passport', 'ID', 'Vehicle Booklet', 'License'] as const

interface PolicyFormProps {
  vehicleTypes: VehicleType[]
  wallet: CreditWallet | null
  isAdmin?: boolean
  borderPosts?: Pick<BorderPost, 'id' | 'name' | 'code'>[]
}

export function PolicyForm({
  vehicleTypes,
  wallet,
  isAdmin = false,
  borderPosts = [],
}: PolicyFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [policyType, setPolicyType] = useState<'monthly' | 'annual'>('monthly')
  const [currency, setCurrency] = useState<Currency>('MZN')
  const [selectedVehicleTypeIds, setSelectedVehicleTypeIds] = useState<string[]>([])
  const [border, setBorder] = useState('')
  const effectiveBorders = borderPosts.length > 0 ? borderPosts : STATIC_BORDERS
  const [documentType, setDocumentType] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const endDate = startDate ? calculateEndDate(startDate, policyType) : ''

  const walletBalance = wallet
    ? currency === 'MZN' ? wallet.balance_mzn
      : currency === 'ZAR' ? wallet.balance_zar
      : wallet.balance_usd
    : 0

  const premiumAmounts: Record<string, number> = {}
  let totalPremium = 0
  vehicleTypes.forEach((vt) => {
    if (selectedVehicleTypeIds.includes(vt.id) && vt.is_active) {
      const price = policyType === 'annual'
        ? currency === 'MZN' ? vt.price_mzn_annual : currency === 'ZAR' ? vt.price_zar_annual : vt.price_usd_annual
        : currency === 'MZN' ? vt.price_mzn : currency === 'ZAR' ? vt.price_zar : vt.price_usd
      if (price !== null && price !== undefined) {
        premiumAmounts[vt.id] = price
        totalPremium += price
      }
    }
  })

  const insufficientBalance = !isAdmin && totalPremium > 0 && walletBalance < totalPremium

  async function uploadDocument(): Promise<string | undefined> {
    if (!selectedFile) return undefined
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = selectedFile.name.split('.').pop()
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { data, error } = await supabase.storage
        .from('policy-documents')
        .upload(filename, selectedFile, { upsert: false })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage
        .from('policy-documents')
        .getPublicUrl(data.path)
      return publicUrl
    } finally {
      setUploading(false)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (selectedVehicleTypeIds.length === 0) {
      setError('Select at least one vehicle type')
      return
    }
    if (insufficientBalance) {
      setError(`Insufficient ${currency} balance. Current: ${currency} ${walletBalance.toFixed(2)}`)
      return
    }

    const fd = new FormData(e.currentTarget)
    setError(null)

    startTransition(async () => {
      try {
        let documentUrl: string | undefined
        if (selectedFile) {
          try {
            documentUrl = await uploadDocument()
          } catch {
            toast.error('Document upload failed — policy will be created without it')
          }
        }

        const result = await createPolicy({
          policy_type: policyType,
          currency,
          vehicle_type_ids: selectedVehicleTypeIds,
          vehicle_type_names: vehicleTypes
            .filter((vt) => selectedVehicleTypeIds.includes(vt.id))
            .map((vt) => vt.name),
          premium_amounts: premiumAmounts,
          client_name: fd.get('client_name') as string,
          client_id_number: (fd.get('client_id_number') as string) || undefined,
          client_nationality: (fd.get('client_nationality') as string) || undefined,
          plate_number: fd.get('plate_number') as string,
          vehicle_brand: fd.get('vehicle_brand') as string,
          vehicle_model: fd.get('vehicle_model') as string,
          vehicle_year: fd.get('vehicle_year') ? Number(fd.get('vehicle_year')) : undefined,
          engine_number: (fd.get('engine_number') as string) || undefined,
          chassis_number: (fd.get('chassis_number') as string) || undefined,
          start_date: startDate,
          border: border || undefined,
          document_type: documentType || undefined,
          document_url: documentUrl,
          notes: (fd.get('notes') as string) || undefined,
        })
        if (result && !result.success) {
          setError(result.error ?? 'Failed to create policy')
          toast.error(result.error ?? 'Failed to create policy')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('NEXT_REDIRECT')) { setError(msg); toast.error(msg) }
      }
    })
  }

  const cardHeader = 'bg-brand text-white rounded-t-lg'

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Policy Configuration */}
      <Card className="border-0 shadow-lg">
        <CardHeader className={cardHeader}>
          <CardTitle className="text-xl">Policy Configuration</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          <div className="space-y-2">
            <Label className="font-semibold">Policy Type *</Label>
            <Select value={policyType} onValueChange={(v) => { if (v) { setPolicyType(v as 'monthly' | 'annual'); setSelectedVehicleTypeIds([]) } }}>
              <SelectTrigger className="bg-gray-50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly (30 days)</SelectItem>
                <SelectItem value="annual">Annual (365 days)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Currency *</Label>
            <Select value={currency} onValueChange={(v) => { if (v) { setCurrency(v as Currency); setSelectedVehicleTypeIds([]) } }}>
              <SelectTrigger className="bg-gray-50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MZN">MZN (Metical)</SelectItem>
                <SelectItem value="ZAR">ZAR (Rand)</SelectItem>
                <SelectItem value="USD">USD (Dollar)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Border Post</Label>
            <Select value={border} onValueChange={(v) => v !== null && setBorder(v ?? '')}>
              <SelectTrigger className="bg-gray-50">
                <SelectValue placeholder="Select border post" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {effectiveBorders.map((b) => (
                  <SelectItem key={b.id} value={b.name}>
                    {b.name} ({b.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Start Date *</Label>
            <Input type="date" value={startDate} min={todayISO()}
              onChange={(e) => setStartDate(e.target.value)} required className="bg-gray-50" />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">End Date</Label>
            <Input readOnly value={endDate} className="bg-gray-100 text-gray-500" />
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Types */}
      <Card className="border-0 shadow-lg">
        <CardHeader className={cardHeader}>
          <CardTitle className="text-xl">Select Insurance Coverage</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <VehicleTypeTable
            vehicleTypes={vehicleTypes}
            currency={currency}
            policyType={policyType}
            selectedIds={selectedVehicleTypeIds}
            onSelectionChange={setSelectedVehicleTypeIds}
          />
          {!isAdmin && wallet && totalPremium > 0 && (
            <div className={`mt-4 p-3 rounded-lg border ${insufficientBalance ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
              <p className={`text-sm ${insufficientBalance ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>
                Wallet Balance: {currency} {walletBalance.toFixed(2)}
                {insufficientBalance && ' — Insufficient balance'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client Information */}
      <Card className="border-0 shadow-lg">
        <CardHeader className={cardHeader}>
          <CardTitle className="text-xl">Client Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="client_name" className="font-semibold">Full Name *</Label>
            <Input id="client_name" name="client_name" required placeholder="John Doe" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client_id_number" className="font-semibold">ID / Passport Number</Label>
            <Input id="client_id_number" name="client_id_number" placeholder="Optional" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client_nationality" className="font-semibold">Nationality</Label>
            <Input id="client_nationality" name="client_nationality" placeholder="e.g. South African" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label className="font-semibold">Document Type</Label>
            <Select value={documentType} onValueChange={(v) => v !== null && setDocumentType(v ?? '')}>
              <SelectTrigger className="bg-gray-50">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None —</SelectItem>
                {DOCUMENT_TYPES.map((dt) => (
                  <SelectItem key={dt} value={dt}>{dt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-semibold">Upload Document</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" className="flex-1 justify-start text-left font-normal"
                onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2 shrink-0 text-gray-400" />
                <span className="truncate text-sm text-gray-500">
                  {selectedFile ? selectedFile.name : 'Click to upload (PDF, JPG, PNG)'}
                </span>
              </Button>
              {selectedFile && (
                <Button type="button" variant="ghost" size="sm"
                  onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = '' }}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Information */}
      <Card className="border-0 shadow-lg">
        <CardHeader className={cardHeader}>
          <CardTitle className="text-xl">Vehicle Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="plate_number" className="font-semibold">Plate Number *</Label>
            <Input id="plate_number" name="plate_number" required placeholder="ABC 123 GP" className="uppercase bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle_year" className="font-semibold">Year</Label>
            <Input id="vehicle_year" name="vehicle_year" type="number" min={1900}
              max={new Date().getFullYear() + 1} placeholder="2020" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle_brand" className="font-semibold">Brand *</Label>
            <Input id="vehicle_brand" name="vehicle_brand" required placeholder="Toyota" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle_model" className="font-semibold">Model *</Label>
            <Input id="vehicle_model" name="vehicle_model" required placeholder="Hilux" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="engine_number" className="font-semibold">Engine Number</Label>
            <Input id="engine_number" name="engine_number" placeholder="Optional" className="bg-gray-50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="chassis_number" className="font-semibold">Chassis / VIN</Label>
            <Input id="chassis_number" name="chassis_number" placeholder="Optional" className="bg-gray-50" />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label htmlFor="notes" className="font-semibold">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="Internal notes (optional)" className="bg-gray-50" />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 pb-6">
        <Button
          type="submit"
          className="bg-brand hover:bg-brand/90 text-white px-8"
          disabled={isPending || uploading || insufficientBalance}
        >
          {uploading ? 'Uploading document…' : isPending ? 'Creating Policy…' : 'Create Policy'}
        </Button>
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
      </div>
    </form>
  )
}
