import { describe, expect, it, vi } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappContentWorkspace } from '@zyapp/contracts'
import { MiniappContentService } from './miniapp-content.service'
import type { BoardGameCoverCacheService } from './board-game-cover-cache.service'
import { validateContentCommand, validateMiniappContent } from './miniapp-content-validation'

const principal = {tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storeId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',deviceName:'test'}
const actor = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
function fixture() {
  let state: MiniappContentWorkspace = {revision:null,draft:null,published:null}
  const events = new Map<string,{request_hash:string;result_json:MiniappContentWorkspace;action:string}>()
  let manager = true
  let failEvent = false
  const media = new Set<string>()
  let backup: MiniappContentWorkspace
  const query = vi.fn(async (sql:string, args:unknown[] = []): Promise<{rows:any[]}> => {
    if (sql === 'BEGIN') backup = structuredClone(state)
    if (sql === 'ROLLBACK') state = backup
    if (sql.includes('FROM cloud_employee')) return {rows:manager ? [{id:actor}] : []}
    if (sql.startsWith('SELECT revision, draft_json')) {
      expect(args).toEqual([principal.tenantId,principal.storeId])
      return {rows:[{revision:state.revision,draft_json:state.draft,published_json:state.published}]}
    }
    if (sql.startsWith('SELECT request_hash')) return {rows:events.has(String(args[2])) ? [events.get(String(args[2]))] : []}
    if (sql.startsWith('SELECT result_json')) return {rows:[...events.values()].filter(event=>event.result_json.revision===args[2]&&['publish','restore'].includes(event.action))}
    if (sql.startsWith('SELECT id FROM cloud_activity_campaign')) return {rows:(args[2] as string[]).map(id=>({id}))}
    if (sql.startsWith('SELECT url')) return {rows:[...media].map(url=>({url}))}
    if (sql.startsWith('SELECT item.name')) {
      expect(args).toEqual([principal.tenantId,principal.storeId])
      return {rows:[{name:'入场费',regular:4000,member:3000}]}
    }
    if (sql.startsWith('UPDATE miniapp_content_workspace')) state = {revision:String(args[2]),draft:JSON.parse(String(args[3])),published:JSON.parse(String(args[4]))}
    if (sql.startsWith('INSERT INTO miniapp_content_event')) {
      if (failEvent) throw new Error('audit unavailable')
      events.set(String(args[5]),{request_hash:String(args[6]),action:String(args[7]),result_json:JSON.parse(String(args[8]))})
    }
    return {rows:[]}
  })
  const release = vi.fn()
  const pool = {query,connect:async()=>({query,release})} as unknown as Pool
  const service = new MiniappContentService(pool,{} as BoardGameCoverCacheService)
  let counter = 0
  const command = (body:Record<string,unknown>) => service.execute(principal,actor,{requestId:`request-${++counter}`,expectedRevision:state.revision,...body})
  return {service,query,release,command,media,state:()=>state,deny:()=>{manager=false},fail:()=>{failEvent=true}}
}
describe('miniapp content publication',()=>{
  it('requires cover ownership and publishes it only after the PC publishes the saved draft', async()=>{
    const f=fixture()
    const coverUrl='https://example.com/cover.jpg',posterUrl='https://example.com/poster.jpg'
    const content={schemaVersion:1,activityDisplays:[{activityId:actor,coverUrl,posterUrl,locationText:'',tags:[]}]}
    f.media.add(posterUrl)
    await expect(f.command({action:'save',content})).rejects.toThrow('this store')
    f.media.add(coverUrl)
    await f.command({action:'save',content})
    expect(f.state().published).toBeNull()
    expect((await f.command({action:'publish'})).published?.activityDisplays?.[0]).toMatchObject({coverUrl,posterUrl})
    await f.command({action:'save',content:{...content,activityDisplays:[{...content.activityDisplays[0],coverUrl:null}]}})
    expect(f.state().published?.activityDisplays?.[0]?.coverUrl).toBe(coverUrl)
    expect((await f.command({action:'publish'})).published?.activityDisplays?.[0]?.coverUrl).toBeNull()
  })
  it('keeps draft private, publishes, withdraws, and restores with a new revision',async()=>{
    const f=fixture()
    const saved=await f.command({action:'save',content:{schemaVersion:1,homeHeroTitle:'Welcome'}})
    expect(saved.published).toBeNull()
    const published=await f.command({action:'publish'})
    expect(published.published?.homeHeroTitle).toBe('Welcome')
    expect(published.revision).not.toBe(saved.revision)
    const withdrawn=await f.command({action:'withdraw'})
    expect(withdrawn.published).toBeNull()
    const restored=await f.command({action:'restore',sourceRevision:published.revision})
    expect(restored.published?.homeHeroTitle).toBe('Welcome')
    expect(restored.published?.revision).toBe(restored.revision)
    expect(restored.revision).not.toBe(published.revision)
  })
  it('returns original result for exact retries even after the revision changed',async()=>{
    const f=fixture()
    const command={action:'save',requestId:'request-stable',expectedRevision:null,content:{schemaVersion:1}}
    const first=await f.service.execute(principal,actor,command)
    await f.command({action:'publish'})
    expect(await f.service.execute(principal,actor,command)).toEqual(first)
    await expect(f.service.execute(principal,actor,{...command,content:{schemaVersion:1,homeHeroTitle:'different'}})).rejects.toThrow('Request ID')
  })
  it('rejects stale edits and releases transaction',async()=>{
    const f=fixture()
    await f.command({action:'save',content:{schemaVersion:1}})
    await expect(f.command({action:'withdraw',expectedRevision:null})).rejects.toThrow('Content changed')
    expect(f.query).toHaveBeenCalledWith('ROLLBACK')
    expect(f.release).toHaveBeenCalledTimes(2)
  })
  it('rejects non-manager reads and writes before loading content',async()=>{
    const f=fixture();f.deny()
    await expect(f.service.read(principal,actor)).rejects.toThrow('Manager')
    await expect(f.command({action:'withdraw'})).rejects.toThrow('Manager')
    expect(f.state().revision).toBeNull()
  })
  it('rolls back publication when history cannot be written',async()=>{
    const f=fixture()
    await f.command({action:'save',content:{schemaVersion:1}})
    const before=structuredClone(f.state());f.fail()
    await expect(f.command({action:'publish'})).rejects.toThrow('audit unavailable')
    expect(f.state()).toEqual(before)
  })
  it('rejects missing drafts, inaccessible history and media owned by another store',async()=>{
    const f=fixture()
    await expect(f.command({action:'publish'})).rejects.toThrow('draft')
    await expect(f.command({action:'restore',sourceRevision:actor})).rejects.toThrow('not found')
    await expect(f.command({action:'save',content:{schemaVersion:1,homeHeroUrl:'https://example.com/private.png'}})).rejects.toThrow('this store')
  })
  it('publishes an explicit empty selection without adding catalog items',async()=>{
    const f=fixture()
    await f.command({action:'save',content:{schemaVersion:1,pricing:{rows:[],extras:[],memberNote:'free'}}})
    const result = await f.command({action:'publish'})
    expect(result.published?.pricing?.rows).toEqual([])
  })
  it('publishes selected prices only when they match the current store configuration',async()=>{
    const f=fixture()
    await f.command({action:'save',content:{schemaVersion:1,pricing:{rows:[{label:'入场费',regular:'¥40',member:'30元'}],extras:[],memberNote:''}}})
    expect((await f.command({action:'publish'})).published?.pricing?.rows).toHaveLength(1)
    await f.command({action:'save',content:{schemaVersion:1,pricing:{rows:[{label:'入场费',regular:'0元',member:'30元'}],extras:[],memberNote:''}}})
    await expect(f.command({action:'publish'})).rejects.toThrow('收费配置不一致')
    expect(f.state().published?.pricing?.rows[0]?.regular).toBe('¥40')
  })
})
describe('content validation',()=>{
  it('accepts independent optional covers, including old documents and explicit removal', () => {
    const row={activityId:actor,posterUrl:'https://example.com/poster.jpg',locationText:'',tags:[]}
    expect(validateMiniappContent({schemaVersion:1,activityDisplays:[row]}).activityDisplays?.[0]).not.toHaveProperty('coverUrl')
    expect(validateMiniappContent({schemaVersion:1,activityDisplays:[{...row,coverUrl:'https://example.com/cover.jpg'}]}).activityDisplays?.[0]?.coverUrl).toBe('https://example.com/cover.jpg')
    expect(validateMiniappContent({schemaVersion:1,activityDisplays:[{...row,coverUrl:null}]}).activityDisplays?.[0]?.coverUrl).toBeNull()
    for (const coverUrl of ['http://example.com/a','https://user:pass@example.com/a','https://example.com/a#fragment','']) {
      expect(()=>validateMiniappContent({schemaVersion:1,activityDisplays:[{...row,coverUrl}]})).toThrow()
    }
  })
  it.each([
    {schemaVersion:2}, {schemaVersion:1,internalNote:'private'},
    {schemaVersion:1,homeHeroUrl:'http://example.com/a'},
    {schemaVersion:1,homeHeroUrl:'https://user:password@example.com/a'},
    {schemaVersion:1,location:{latitude:91,longitude:0}},
    {schemaVersion:1,contacts:[{id:'a',label:'a',value:'b',action:'execute'}]},
    {schemaVersion:1,documents:[{key:'privacy',title:'p',version:'1',body:'text',updatedAt:'2026-09-14'}]},
    {schemaVersion:1,homeHeroTitle:'a'.repeat(501)}
  ])('rejects invalid or private fields %j',value=>expect(()=>validateMiniappContent(value)).toThrow())
  it('rejects missing revision and unknown command fields',()=>{
    expect(()=>validateContentCommand({action:'withdraw',requestId:'request-123'})).toThrow()
    expect(()=>validateContentCommand({action:'withdraw',requestId:'request-123',expectedRevision:null,storeId:actor})).toThrow()
  })
})
