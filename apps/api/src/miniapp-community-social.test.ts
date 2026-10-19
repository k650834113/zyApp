import {describe,it,expect,vi,afterEach} from 'vitest'
import {randomUUID} from 'node:crypto'
import type {Pool} from '@zyapp/cloud-db'
import type {MiniappPrincipal} from './miniapp-auth'
import {MiniappCommunityService} from './miniapp-community.service'
import {PublicContentService} from './public-content.service'
import {createCommunityMiniappCode} from './wechat-miniapp-provider'
import type {ApiConfig} from './config'
const me=randomUUID(),other=randomUUID(),game=randomUUID()
const principal:MiniappPrincipal={tenantId:randomUUID(),storeId:randomUUID(),memberId:me,memberStatus:'active',identityId:randomUUID(),provider:'development',providerSubject:'test',employeeId:null,employeeStatus:null,employeeRole:null,identity:{role:'guest'}}
const play=()=>({requestId:randomUUID(),gameId:game,date:'2026-09-01',duration:30,mode:'个人',players:[{name:'客户端姓名',memberId:other,avatarUrl:'https://forged/a',score:'10',rank:1}],note:'',ranking:'high',result:null,recordScores:true,resultType:'ranking'})
function harness(allowed:boolean){
  let event:{request_hash:string;result_json:unknown}|null=null
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    if(sql.includes('FROM miniapp_community_event'))return {rows:event?[event]:[]}
    if(sql.includes('INSERT INTO miniapp_community_event'))event={request_hash:String(args[5]),result_json:JSON.parse(String(args[7]))}
    if(sql.includes('SELECT id FROM cloud_member'))return {rows:[{id:me}]}
    if(sql.includes('SELECT id,member_number,nickname,avatar_url'))return {rows:[{id:args[1],member_number:'123',nickname:'服务器姓名',avatar_url:'https://trusted/avatar'}]}
    if(sql.includes('SELECT 1 FROM miniapp_friend'))return {rows:allowed?[{}]:[]}
    return {rows:[]}
  })
  const release=vi.fn(),pool={query,connect:async()=>({query,release})} as unknown as Pool
  const content={getGame:async()=>({id:game,name:'游戏',imageUrl:null})} as unknown as PublicContentService
  return {service:new MiniappCommunityService(pool,content),query,release}
}
describe('social command authorization and transaction boundaries',()=>{
  it('rejects unconfirmed identity association before a play can be written',async()=>{
    const h=harness(false);await expect(h.service.savePlay(principal,play())).rejects.toThrow('已确认好友')
    expect(h.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO miniapp_play('))).toBe(false)
    expect(h.query).toHaveBeenCalledWith('ROLLBACK');expect(h.release).toHaveBeenCalled()
  })
  it('canonicalizes profiles, shares one record, and replays uncertain commands without writing twice',async()=>{
    const h=harness(true),input=play()
    const saved=await h.service.savePlay(principal,input)
    expect(saved.players[0]).toMatchObject({memberId:other,name:'服务器姓名',avatarUrl:'https://trusted/avatar'})
    expect(saved.visibility).toBe('参与者')
    expect(await h.service.savePlay(principal,input)).toEqual(saved)
    expect(h.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO miniapp_play('))).toHaveLength(1)
    await expect(h.service.savePlay(principal,{...input,note:'不同内容'})).rejects.toThrow('请求编号')
  })
  it('rejects anonymous and disabled actors, self friendships, and foreign recipient decisions',async()=>{
    const h=harness(true)
    await expect(h.service.friends({...principal,memberId:null})).rejects.toThrow('注册')
    await expect(h.service.friends({...principal,memberStatus:'disabled'})).rejects.toThrow('注册')
    await expect(h.service.friendCommand(principal,'request',{requestId:randomUUID(),memberId:me})).rejects.toThrow('自己')
    await expect(h.service.friendCommand(principal,'accept',{requestId:randomUUID(),id:randomUUID()})).rejects.toThrow('不存在')
  })
})
afterEach(()=>vi.unstubAllGlobals())
describe('miniapp invitation code provider',()=>{
  const config={wechatMiniappAppId:'test-app',wechatMiniappAppSecret:'test-secret'} as ApiConfig
  const redis={get:async()=> 'test-platform-token'} as unknown as Parameters<typeof createCommunityMiniappCode>[1]
  it('uses the caller build version and returns only image bytes, without a reusable credential',async()=>{
    const fetcher=vi.fn(async(_url:string,_options:RequestInit)=>new Response(new Uint8Array([0x89,0x50,0x4e,0x47]),{headers:{'content-type':'image/png'}}));vi.stubGlobal('fetch',fetcher)
    const image=await createCommunityMiniappCode(config,redis,'a'.repeat(32),'trial')
    expect(image).toMatch(/^data:image\/png;base64,/);expect(image).not.toContain('test-platform-token')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({scene:'a'.repeat(32),env_version:'trial',check_path:false,page:'pages/community-invite/index'})
  })
  it('fails explicitly for a platform JSON error or invalid scene',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"errcode":40001}',{headers:{'content-type':'application/json'}})))
    await expect(createCommunityMiniappCode(config,redis,'a'.repeat(32))).rejects.toThrow('微信未返回')
    await expect(createCommunityMiniappCode(config,redis,'invalid')).rejects.toThrow('邀请码无效')
  })
})
