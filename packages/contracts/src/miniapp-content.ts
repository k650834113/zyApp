import type { MiniappHomeSnapshot, PublicMiniappContent, PublicPricing } from './index'

export type MiniappContentDraft = Omit<PublicMiniappContent, 'revision' | 'publishedAt'>
export type MiniappContentWorkspace = {
  revision: string | null
  draft: MiniappContentDraft | null
  published: PublicMiniappContent | null
  current?: {
    home: MiniappHomeSnapshot
    pricing: PublicPricing
    readAt: string
  }
}
export type MiniappContentCommand = {
  requestId: string
  expectedRevision: string | null
} & (
  | { action: 'save'; content: MiniappContentDraft }
  | { action: 'publish' | 'withdraw' }
  | { action: 'restore'; sourceRevision: string }
)

export type MapLocationSearch = { name: string; city: string; address: string }
export type MapLocationCandidate = {
  id: string; name: string; address: string
  location: {latitude: number; longitude: number}
  provider: 'tencent' | 'amap'; kind: 'poi' | 'address'
}
