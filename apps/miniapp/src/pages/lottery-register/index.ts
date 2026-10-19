import type {LotteryAdmission} from '@zyapp/contracts'
import {getMiniappClient} from '../../services/client'
import {workspaceApi,beijingTime} from '../../services/workspace'
import {rememberAccountReturn} from '../../services/meetup-return'
Page({
 data:{admission:null as LotteryAdmission|null,drawTime:'',member:false,loading:false,busy:false,error:'',subscriptionResult:'',resultText:''},scene:'',activityId:'',
 onLoad(options:{scene?:string;activityId?:string}){try{this.scene=decodeURIComponent(options.scene??'');this.activityId=options.activityId??''}catch{this.scene=''}},onShow(){void this.load()},
 async load(){this.setData({loading:true,error:''});try{const admission=this.activityId?await workspaceApi().lotteryResult(this.activityId):await workspaceApi().admit(this.scene);const member=!!await getMiniappClient().getMemberSummary();this.setData({admission,member,drawTime:beijingTime(admission.drawAt),resultText:admission.result?(admission.result.prizes.length?'恭喜中奖：'+admission.result.prizes.join('、'):'本次未中奖，感谢参与'):'尚未开奖'})}catch(e){this.setData({error:e instanceof Error?e.message:'报名信息加载失败'})}finally{this.setData({loading:false})}},
 login(){rememberAccountReturn('/pages/lottery-register/index?'+(this.activityId?'activityId='+encodeURIComponent(this.activityId):'scene='+encodeURIComponent(this.scene)));wx.navigateTo({url:'/pages/login/index'})},
 async confirm(e?:{detail:{result:string}}){if(this.data.busy||this.data.admission?.registered)return;this.setData({busy:true,error:'',subscriptionResult:e?.detail.result??''});try{const admission=await workspaceApi().register(this.scene);this.setData({admission});wx.showToast({title:'报名成功',icon:'success'})}catch(e){this.setData({error:e instanceof Error?e.message:'报名失败，请重试'})}finally{this.setData({busy:false})}},
 subscribed(e:{detail:{result:string}}){this.setData({subscriptionResult:e.detail.result})},messages(){wx.navigateTo({url:'/pages/messages/index'})}
})
