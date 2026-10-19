import type {MemberNotice,NoticeScene} from '@zyapp/contracts'
import {getMiniappClient} from '../../services/client'
import {workspaceApi,beijingTime} from '../../services/workspace'
import {rememberAccountReturn} from '../../services/meetup-return'
Page({
 data:{member:false,busy:false,error:'',items:[] as Array<MemberNotice&{timeText:string}>,selected:null as (MemberNotice&{timeText:string})|null,hasMore:false,scenes:[] as NoticeScene[]},noticeId:'',
 onLoad(options:{id?:string}){this.noticeId=options.id??''},onShow(){void this.load(true)},
 async load(reset:boolean=true){if(this.data.busy)return;this.setData({busy:true,error:''});try{const member=!!await getMiniappClient().getMemberSummary();this.setData({member});if(!member){this.setData({items:[],selected:null,scenes:[]});return}const result=await workspaceApi().notices(reset?0:this.data.items.length);const items=result.items.map(n=>({...n,timeText:beijingTime(n.createdAt)}));this.setData({items:reset?items:[...this.data.items,...items],hasMore:result.hasMore});if(reset){const scenes=await workspaceApi().scenes();this.setData({scenes:scenes.filter(s=>s.enabled&&s.templateId)});if(this.noticeId){await this.selectNotice(this.noticeId);this.noticeId=''}}}catch(e){this.setData({error:e instanceof Error?e.message:'消息加载失败，请重试'})}finally{this.setData({busy:false})}},
 more(){void this.load(false)},refresh(){void this.load(true)},async selectNotice(id:string){const n=await workspaceApi().readNotice(id);this.setData({selected:{...n,timeText:beijingTime(n.createdAt)},items:this.data.items.map(item=>item.id===id?{...item,read:true}:item)})},
 async open(e:{currentTarget:{dataset:{id:string}}}){try{await this.selectNotice(e.currentTarget.dataset.id)}catch(e){this.setData({error:e instanceof Error?e.message:'消息不可用'})}},
 close(){this.setData({selected:null})},result(){const n=this.data.selected;if(n?.scene==='lottery.result'&&n.businessId)wx.navigateTo({url:'/pages/lottery-register/index?activityId='+encodeURIComponent(n.businessId)})},
 login(){rememberAccountReturn('/pages/messages/index'+(this.noticeId?'?id='+encodeURIComponent(this.noticeId):''));wx.navigateTo({url:'/pages/login/index'})}
})
