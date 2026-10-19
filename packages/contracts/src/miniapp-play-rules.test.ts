import {describe,it,expect} from 'vitest'
import {rankPlayPlayers,playFieldErrors} from './miniapp-play-rules'
import type {PlayPlayer} from './miniapp-community'
const player=(name:string,score:string,team?:string):PlayPlayer=>({name,score,rank:0,...(team?{team}:{})})
describe('play scoring and outcomes',()=>{
  it('updates high/low rankings with negative decimals and competition ties, without moving inputs',()=>{
    const players=[player('甲','2.125'),player('乙','-1.25'),player('丙','2.125'),player('丁','')]
    expect(rankPlayPlayers(players,'个人','high').map(p=>p.rank)).toEqual([1,3,1,0])
    expect(rankPlayPlayers(players,'个人','low').map(p=>p.rank)).toEqual([2,1,2,0])
    expect(players.every(p=>p.rank===0)).toBe(true)
  })
  it('counts teams rather than people and retains manual rankings without scores',()=>{
    const players=[player('甲','10','A'),player('乙','10','A'),player('丙','5','B')]
    expect(rankPlayPlayers(players,'团队','high').map(p=>p.rank)).toEqual([1,1,2])
    expect(rankPlayPlayers(players,'团队','low').map(p=>p.rank)).toEqual([2,2,1])
    expect(rankPlayPlayers([{...players[0]!,rank:3}],'个人','manual',false)[0]?.rank).toBe(3)
  })
  it('allows scoreless single/multiple winners and all-player draws independently of scores',()=>{
    const base={mode:'个人',ranking:'high' as const,result:null,note:'',recordScores:false,resultType:'single' as const}
    const players=[{...player('甲',''),outcome:'win' as const},{...player('乙',''),outcome:'loss' as const}]
    expect(playFieldErrors({...base,players})).toEqual({})
    const both=players.map(p=>({...p,outcome:'win' as const}))
    expect(playFieldErrors({...base,players:both}).resultType).toBeTruthy()
    expect(playFieldErrors({...base,players:both,resultType:'multiple'})).toEqual({})
    expect(playFieldErrors({...base,players:players.map(p=>({...p,outcome:'draw' as const}))})).toEqual({})
  })
  it('validates team/cooperative shared scores and duplicate linked identities at the exact field',()=>{
    const base={mode:'团队',ranking:'high' as const,result:null,note:'',recordScores:true}
    const players=[{...player('甲','2','A'),memberId:'member'},{...player('乙','3','A'),memberId:'member'}]
    const errors=playFieldErrors({...base,players})
    expect(errors['players.1.score']).toContain('同队')
    expect(errors['players.1.name']).toContain('重复')
    expect(playFieldErrors({...base,mode:'合作',result:'win',players})['players.0.score']).toBeTruthy()
  })
})
