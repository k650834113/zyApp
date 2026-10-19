import type {StaffTransaction} from '@zyapp/contracts'
import {workspaceApi,beijingTime} from '../../services/workspace'
const labels:Record<string,string>={completed:'已完成',settled:'已到账',reversed:'已冲正',pending:'待处理',rejected:'已拒绝',pending_payment:'待支付',creating:'创建中',failed:'失败',expired:'已过期',purchased:'开通',renewed:'续费',paused:'暂停',resumed:'恢复',used:'使用',extended:'延期'}
Page({
 data:{items:[] as Array<StaffTransaction&{timeText:string;amountText:string;giftText:string;statusText:string}>,fromDate:new Date(Date.now()+8*3600000-29*86400000).toISOString().slice(0,10),toDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10),kindIndex:0,kinds:['全部项目','消费订单','充值','月卡','退款'],query:'',busy:false,error:'',hasMore:false,selected:null as (StaffTransaction&{timeText:string;amountText:string;giftText:string;statusText:string})|null},generation:0,
 onShow(){void this.load(true)},onUnload(){this.generation++},
 dateFrom(e:WechatMiniprogram.PickerChange){this.setData({fromDate:String(e.detail.value)})},dateTo(e:WechatMiniprogram.PickerChange){this.setData({toDate:String(e.detail.value)})},kind(e:WechatMiniprogram.PickerChange){this.setData({kindIndex:Number(e.detail.value)})},input(e:WechatMiniprogram.Input){this.setData({query:e.detail.value})},
 search(){void this.load(true)},more(){if(!this.data.busy&&this.data.hasMore)void this.load(false)},
 async load(reset:boolean){if(!reset&&this.data.busy)return;const generation=++this.generation,offset=reset?0:this.data.items.length;this.setData({busy:true,error:'',...(reset?{items:[],hasMore:false}:{})});try{const result=await workspaceApi().transactions({fromDate:this.data.fromDate,toDate:this.data.toDate,kind:['','consumption','recharge','monthly_card','refund'][this.data.kindIndex]??'',query:this.data.query,offset});if(generation!==this.generation)return
 const items=result.items.map(t=>({...t,timeText:beijingTime(t.occurredAt),amountText:'¥'+(t.amountFen/100).toFixed(2),giftText:'¥'+(t.giftFen/100).toFixed(2),statusText:labels[t.status]??t.status}));this.setData({items:reset?items:[...this.data.items,...items],hasMore:result.hasMore})
 }catch(e){if(generation===this.generation)this.setData({error:e instanceof Error?e.message:'交易查询失败，请重试'})}finally{if(generation===this.generation)this.setData({busy:false})}},
 detail(e:{currentTarget:{dataset:{id:string}}}){this.setData({selected:this.data.items.find(t=>t.id===e.currentTarget.dataset.id)??null})},close(){this.setData({selected:null})}
})
