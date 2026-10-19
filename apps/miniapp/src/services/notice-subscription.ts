import type {SubscriptionTicket} from '@zyapp/contracts'
/** Must be called directly from a user tap, with a preloaded ticket. */
export function requestNoticeSubscription(ticket:SubscriptionTicket|null,record:(id:string,result:string)=>Promise<void>):Promise<string>{
  if(!ticket)return Promise.resolve('unavailable')
  return new Promise(resolve=>{try{wx.requestSubscribeMessage({tmplIds:[ticket.templateId],success:r=>{
    const result=String(r[ticket.templateId]??'fail')
    void record(ticket.id,result).then(()=>resolve(result)).catch(()=>resolve('record_failed'))
  },fail:()=>{void record(ticket.id,'fail').catch(()=>{});resolve('fail')}})}catch{void record(ticket.id,'fail').catch(()=>{});resolve('fail')}})
}
