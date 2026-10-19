import {it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import type {Pool} from '@zyapp/cloud-db'
import {MiniappCommunityService} from './miniapp-community.service'
import type {PublicContentService} from './public-content.service'
it('returns live avatars and member identities for a public meetup without exposing phones',async()=>{
  const id=randomUUID(),store=randomUUID(),owner=randomUUID(),other=randomUUID()
  const query=vi.fn(async(sql:string,args:unknown[])=>{
    if(sql.includes('WITH changed AS'))return {rows:[]}
    if(sql.includes('SELECT m.*')){expect(args).toEqual([id,store]);expect(sql).toContain("s.status='active'");expect(sql).toContain('s.tenant_id=m.tenant_id');return {rows:[{id,revision:randomUUID(),owner_id:owner,status:'open',deadline:new Date(Date.now()+86400000),data_json:{title:'公开约局',game:{id:randomUUID(),name:'桌游',imageUrl:null},capacity:4}}]}}
    expect(sql).toContain('m.avatar_url')
    return {rows:[{meetup_id:id,member_id:other,nickname:'同名会员',avatar_url:null},{meetup_id:id,member_id:owner,nickname:'同名会员',avatar_url:'https://example.com/avatar.png'}]}
  })
  const service=new MiniappCommunityService({query} as unknown as Pool,{} as PublicContentService)
  const result=await service.publicMeetup(store,id)
  expect(result.participants).toEqual([{memberId:owner,name:'同名会员',avatarUrl:'https://example.com/avatar.png'},{memberId:other,name:'同名会员',avatarUrl:null}])
  expect(result.players).toEqual(['同名会员','同名会员']);expect(result.owned).toBe(false);expect(result.joined).toBe(false);expect(result.registrationClosed).toBe(false)
  expect(JSON.stringify(result)).not.toContain('phone')
})
it('rejects missing or cross-store public meetup access',async()=>{
  const service=new MiniappCommunityService({query:async()=>({rows:[]})} as unknown as Pool,{} as PublicContentService)
  await expect(service.publicMeetup(randomUUID(),randomUUID())).rejects.toThrow('约局不存在')
})
