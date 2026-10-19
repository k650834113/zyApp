import { BadRequestException } from '@nestjs/common'
import type { MiniappContentCommand, MiniappContentDraft } from '@zyapp/contracts'

function fail(field: string): never { throw new BadRequestException(`Invalid content field: ${field}`) }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field)
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(key)
}
function text(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) return fail(field)
  return value.trim()
}
function array(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(field)
  return value
}
function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) return fail(field)
  return value as T
}
export function contentRevision(value: unknown): string | null {
  if (value === null) return null
  const result = text(value, 'revision', 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) return fail('revision')
  return result.toLowerCase()
}
export function validateMiniappContent(value: unknown): MiniappContentDraft {
  const input = object(value, 'content')
  keys(input, ['schemaVersion','storePhotoUrl','storeCaption','storeFooter','location','contacts','homeHeroUrl','homeHeroTitle','homeHeroSubtitle','recommendationHeroUrl','recommendationHeroTitle','pricing','documents','activityDisplays','recommendationDisplays'])
  if (input.schemaVersion !== 1) return fail('schemaVersion')
  const result: MiniappContentDraft = { schemaVersion: 1 }
  if(input.activityDisplays!==undefined) {
    result.activityDisplays=array(input.activityDisplays,'activityDisplays',50).map(value=>{
      const r=object(value,'activity');keys(r,['activityId','coverUrl','posterUrl','locationText','tags'])
      const activityId=contentRevision(r.activityId);if(!activityId)fail('activityId')
      const url=r.posterUrl===null?null:text(r.posterUrl,'posterUrl',2048)
      if(url){try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)fail('posterUrl')}catch{fail('posterUrl')}}
      const coverUrl=r.coverUrl===undefined?undefined:r.coverUrl===null?null:text(r.coverUrl,'coverUrl',2048)
      if(coverUrl){try{const parsed=new URL(coverUrl);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)fail('coverUrl')}catch{fail('coverUrl')}}
      return {activityId,...(coverUrl!==undefined?{coverUrl}:{}),posterUrl:url,locationText:text(r.locationText,'locationText',100,0),tags:array(r.tags,'tags',10).map(t=>text(t,'tag',40))}
    })
    if(new Set(result.activityDisplays.map(r=>r.activityId)).size!==result.activityDisplays.length)fail('duplicate activityId')
  }
  if(input.recommendationDisplays!==undefined) {
    result.recommendationDisplays=array(input.recommendationDisplays,'recommendationDisplays',50).map(value=>{
      const r=object(value,'recommendation');keys(r,['gameId','reason','audience','badge','sceneIds'])
      const gameId=contentRevision(r.gameId);if(!gameId)fail('gameId')
      return {gameId,reason:text(r.reason,'reason',500,0),audience:text(r.audience,'audience',200,0),badge:text(r.badge,'badge',40,0),sceneIds:array(r.sceneIds,'sceneIds',10).map(v=>text(v,'sceneId',40))}
    })
    if(new Set(result.recommendationDisplays.map(r=>r.gameId)).size!==result.recommendationDisplays.length)fail('duplicate gameId')
  }
  for (const key of ['storePhotoUrl','homeHeroUrl','recommendationHeroUrl'] as const) {
    if (input[key] === undefined) continue
    if (input[key] === null) { result[key] = null; continue }
    const url = text(input[key], key, 2048)
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail(key)
    } catch { fail(key) }
    result[key] = url
  }
  for (const key of ['storeCaption','storeFooter','homeHeroTitle','homeHeroSubtitle','recommendationHeroTitle'] as const) {
    if (input[key] !== undefined) result[key] = input[key] === null ? null : text(input[key], key, 500, 0)
  }
  if (input.location !== undefined) {
    if (input.location === null) result.location = null
    else {
      const loc = object(input.location, 'location'); keys(loc, ['latitude','longitude'])
      if (typeof loc.latitude !== 'number' || !Number.isFinite(loc.latitude) || Math.abs(loc.latitude) > 90 || typeof loc.longitude !== 'number' || !Number.isFinite(loc.longitude) || Math.abs(loc.longitude) > 180) fail('location')
      result.location = { latitude: loc.latitude as number, longitude: loc.longitude as number }
    }
  }
  if (input.contacts !== undefined) {
    result.contacts = array(input.contacts, 'contacts', 12).map(value => {
      const row = object(value, 'contact'); keys(row, ['id','label','value','action'])
      return { id: text(row.id,'contact.id',80), label: text(row.label,'contact.label',40), value: text(row.value,'contact.value',200), action: choice(row.action,['copy','phone'],'contact.action') }
    })
    if (new Set(result.contacts.map(row => row.id)).size !== result.contacts.length) fail('duplicate contact id')
  }
  if (input.pricing !== undefined) {
    if (input.pricing === null) result.pricing = null
    else {
      const pricing = object(input.pricing,'pricing'); keys(pricing,['rows','extras','memberNote'])
      result.pricing = {
        rows: array(pricing.rows,'pricing.rows',30).map(value => {
          const row = object(value,'price'); keys(row,['label','regular','member'])
          return {label:text(row.label,'label',100),regular:text(row.regular,'regular',100),member:text(row.member,'member',100)}
        }),
        extras: array(pricing.extras,'pricing.extras',20).map(value => {
          const row = object(value,'extra'); keys(row,['icon','label','value','note'])
          return {icon:choice(row.icon,['user','people','games','clock','receipt'],'icon'),label:text(row.label,'label',100),value:text(row.value,'value',100),note:text(row.note,'note',500,0)}
        }),
        memberNote: text(pricing.memberNote,'memberNote',1000,0)
      }
    }
  }
  if (input.documents !== undefined) {
    result.documents = array(input.documents,'documents',3).map(value => {
      const row = object(value,'document'); keys(row,['key','title','version','body','updatedAt'])
      const updatedAt = text(row.updatedAt,'updatedAt',40)
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) fail('updatedAt')
      return {key:choice(row.key,['agreement','privacy','help'],'document.key'),title:text(row.title,'title',100),version:text(row.version,'version',80),body:text(row.body,'body',20000),updatedAt:new Date(updatedAt).toISOString()}
    })
    if (new Set(result.documents.map(row => row.key)).size !== result.documents.length) fail('duplicate document key')
  }
  return result
}
export function validateContentCommand(value: unknown): MiniappContentCommand {
  const input = object(value,'command')
  const action = choice(input.action,['save','publish','withdraw','restore'],'action')
  keys(input,['action','requestId','expectedRevision',...(action === 'save' ? ['content'] : action === 'restore' ? ['sourceRevision'] : [])])
  const requestId = text(input.requestId,'requestId',100,8)
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) fail('requestId')
  const base = { requestId, expectedRevision:contentRevision(input.expectedRevision) }
  if (action === 'save') return {...base,action,content:validateMiniappContent(input.content)}
  if (action === 'restore') {
    const sourceRevision = contentRevision(input.sourceRevision)
    if (!sourceRevision) return fail('sourceRevision')
    return {...base,action,sourceRevision}
  }
  return {...base,action}
}
