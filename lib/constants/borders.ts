export const MOZAMBICAN_BORDERS = [
  { id: 'gaza', name: 'Gaza' },
  { id: 'ressano-garcia', name: 'Ressano Garcia' },
  { id: 'chicualacuala', name: 'Chicualacuala' },
  { id: 'kanyemba', name: 'Kanyemba' },
  { id: 'zumbo', name: 'Zumbo' },
  { id: 'changara', name: 'Changara' },
  { id: 'tete', name: 'Tete' },
  { id: 'caia', name: 'Caia' },
  { id: 'marromeu', name: 'Marromeu' },
  { id: 'machanga', name: 'Machanga' },
  { id: 'pemba', name: 'Pemba' },
  { id: 'mocimboa-da-praia', name: 'Mocimbóa da Praia' },
] as const

export type BorderId = typeof MOZAMBICAN_BORDERS[number]['id']
