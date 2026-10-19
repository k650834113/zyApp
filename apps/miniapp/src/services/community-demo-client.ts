import type {CommunityClient} from './types'
import type {CommunitySnapshot} from './community-model'
import {rankPlayPlayers,playFieldErrors} from './play-rules'
import type {PlaySummary} from '@zyapp/contracts'
/** Development-only adapter. The production build removes this module. */
export function createCommunityDemoClient(snapshot:()=>CommunitySnapshot|null):CommunityClient {
  const plays=new Map<string,PlaySummary>()
  const unavailable=async():Promise<never>=>{throw new Error('扫码和好友需连接真实云端，开发演示不生成可用邀请码')}
  return {
    selfMember:unavailable,
    friends:async()=>({friends:[],requests:[]}),findMember:unavailable,friendCommand:unavailable,
    createTable:unavailable,getTable:unavailable,closeTable:unavailable,createInvite:unavailable,previewInvite:unavailable,joinInvite:unavailable,
    listMeetups:async()=>({items:[],hasMore:false}),getMeetup:unavailable,createMeetup:unavailable,actMeetup:unavailable,
    listPlays:async()=>({items:[...plays.values()],hasMore:false}),
    getPlay:async id=>{const value=plays.get(id);if(value)return value;const legacy=snapshot()?.plays.find(p=>p.id===id);if(!legacy)throw new Error('记录不存在');return {...legacy,revision:'demo',visibility:'仅自己',ranking:'high',result:null,recordScores:true,resultType:'ranking',owned:true}},
    savePlay:async input=>{
      const fields=playFieldErrors(input);if(Object.keys(fields).length)throw Object.assign(new Error(Object.values(fields)[0]),{fieldErrors:fields})
      const game=snapshot()?.plays.find(p=>p.game.id===input.gameId)?.game??snapshot()?.meetups.find(p=>p.game.id===input.gameId)?.game
      if(!game)throw new Error('请选择演示桌游')
      const value:PlaySummary={...input,id:input.id??'demo-play-'+Date.now(),revision:'demo-'+Date.now(),game,visibility:'仅自己',owned:true,players:rankPlayPlayers(input.players,input.mode,input.ranking,input.recordScores!==false)}
      plays.set(value.id,value);return value
    },
    deletePlay:async id=>{plays.delete(id);return {deleted:true}}
  }
}
