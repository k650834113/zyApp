import { describe,expect,it } from 'vitest'
import { validateMeetup,validatePlay,filters } from './miniapp-community-validation'
const gameId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
describe('community input validation',()=>{
  const meetup={requestId:'request-123',gameId,title:'约局',date:'2026-10-01',time:'14:00',duration:60,capacity:4,deadline:'2026-10-01 13:00',description:'说明',friendly:true}
  it('rejects invalid dates, times, capacity and elapsed deadlines',()=>{
    const now=Date.parse('2026-09-14T00:00:00Z')
    expect(validateMeetup(meetup,now).capacity).toBe(4)
    for (const change of [{date:'2026-02-30'},{time:'24:00'},{capacity:21},{deadline:'2026-10-01 15:00'},{deadline:'2026-09-01 13:00'}]) expect(()=>validateMeetup({...meetup,...change},now)).toThrow()
    expect(()=>filters({limit:1000})).toThrow()
  })
  it('ranks exact decimal scores with ties and checks manual/team/cooperative inputs',()=>{
    const p={requestId:'request-123',gameId,date:'2026-09-01',duration:30,mode:'个人',players:[{name:'甲',score:'2.125',rank:1},{name:'乙',score:'-1.25',rank:2}],note:'',ranking:'low',result:null}
    expect(validatePlay(p).players.map(v=>v.name)).toEqual(['乙','甲'])
    expect(validatePlay({...p,ranking:'manual'}).players.map(v=>v.rank)).toEqual([1,2])
    expect(()=>validatePlay({...p,mode:'合作'})).toThrow('结果')
    expect(validatePlay({...p,mode:'合作',result:'win'}).players.map(v=>v.rank)).toEqual([1,1])
    expect(()=>validatePlay({...p,mode:'团队'})).toThrow()
    expect(()=>validatePlay({...p,players:[{name:'甲',score:'Infinity',rank:1}]})).toThrow()
  })
  it('supports no-score winners and returns field paths for invalid inputs',()=>{
    const p={requestId:'request-123',gameId,date:'2026-09-01',duration:30,mode:'个人',recordScores:false,resultType:'multiple',ranking:'high',result:null,note:'',players:[{name:'甲',score:'',rank:0,outcome:'win'},{name:'乙',score:'',rank:0,outcome:'win'}]}
    expect(validatePlay(p).players.map(p=>p.outcome)).toEqual(['win','win'])
    const field=(run:()=>unknown)=>{try{run();throw new Error('expected validation failure')}catch(e){return (e as {getResponse:()=>{fieldErrors:Record<string,string>}}).getResponse().fieldErrors}}
    expect(field(()=>validatePlay({...p,resultType:'single'})).resultType).toBeTruthy()
    expect(field(()=>validatePlay({...p,players:[{name:'',score:'',rank:0,outcome:'win'}]}))['players.0.name']).toContain('玩家1')
    expect(field(()=>validatePlay({...p,note:'字'.repeat(201)})).note).toBeTruthy()
    expect(field(()=>validateMeetup({...meetup,title:''},Date.parse('2026-09-14T00:00:00Z'))).title).toBeTruthy()
    expect(field(()=>validateMeetup({...meetup,description:'字'.repeat(201)},Date.parse('2026-09-14T00:00:00Z'))).description).toBeTruthy()
  })
})
