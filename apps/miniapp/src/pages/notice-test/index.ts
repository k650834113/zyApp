import type {NoticeScene,MemberNotice} from '@zyapp/contracts'
import {getMiniappClient} from '../../services/client'
import {workspaceApi} from '../../services/workspace'
import {inviteEnvironment} from '../../services/social'
import {rememberAccountReturn} from '../../services/meetup-return'
function requestId(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16)})}
function status(notice:MemberNotice){if(notice.errorCode==='in_app_only')return '站内消息已写入，未发送微信';const names:Record<string,string>={pending:'已排队，等待微信发送',sending:'正在向微信发送',sent:'微信接口已接受，请到微信服务通知查看',unsubscribed:'没有可用订阅授权或微信拒收',disabled:'模板尚未启用',failed:'微信发送失败',uncertain:'发送结果不明，请检查微信，系统不会重复发送'};return names[notice.delivery]??notice.delivery}
Page({
 data:{employee:false,manager:false,member:false,scenes:[] as NoticeScene[],sceneIndex:0,requestId:requestId(),busy:false,error:'',result:null as MemberNotice|null,statusText:'',identityName:''},timer:null as ReturnType<typeof setTimeout>|null,polls:0,
 onShow(){void this.load()},onHide(){this.stop()},onUnload(){this.stop()},stop(){if(this.timer)clearTimeout(this.timer);this.timer=null},
 async load(){this.setData({error:''});try{const identity=await getMiniappClient().getIdentity();const employee=identity.role==='staff'||identity.role==='manager';this.setData({employee,manager:identity.role==='manager',identityName:employee?identity.displayName:''});if(!employee)throw new Error('请先从员工工作台登录');const member=!!await getMiniappClient().getMemberSummary();const scenes=(await workspaceApi().scenes()).filter(s=>s.enabled&&s.templateId);this.setData({member,scenes,sceneIndex:0});if(this.data.result&&['pending','sending'].includes(this.data.result.delivery))this.poll()}catch(e){this.fail(e)}},
 fail(e:unknown){this.setData({error:e instanceof Error?e.message:'测试请求失败，请重试'})},
 choose(e:WechatMiniprogram.PickerChange){this.stop();this.setData({sceneIndex:Number(e.detail.value),requestId:requestId(),result:null,statusText:'',error:''})},
 newTest(){this.stop();this.setData({requestId:requestId(),result:null,statusText:'',error:''})},
 inApp(){void this.send('in_app')},subscribed(e:{detail:{result:string}}){if(e.detail.result==='accept')void this.send('wechat');else this.setData({error:e.detail.result==='record_failed'?'授权记录保存失败，请重试。':'未开启本次微信订阅，没有发送测试通知。'})},
 async send(channel:'in_app'|'wechat'){if(this.data.busy||this.data.result)return;this.setData({busy:true,error:''});try{const result=await workspaceApi().testNotice({requestId:this.data.requestId,scene:this.data.scenes[this.data.sceneIndex]?.key??'system.test',channel,envVersion:inviteEnvironment()});this.setData({result,statusText:status(result)});this.polls=0;if(['pending','sending'].includes(result.delivery))this.poll()}catch(e){this.fail(e)}finally{this.setData({busy:false})}},
 poll(){this.stop();this.timer=setTimeout(()=>{void this.refresh()},2000)},
 async refresh(){const notice=this.data.result;if(!notice)return;try{const result=await workspaceApi().readNotice(notice.id);this.setData({result,statusText:status(result)});if(['pending','sending'].includes(result.delivery)&&++this.polls<25)this.poll()}catch(e){this.fail(e)}},
 messages(){wx.navigateTo({url:'/pages/messages/index'})},settings(){wx.navigateTo({url:'/pages/notice-settings/index'})},login(){rememberAccountReturn('/pages/notice-test/index');wx.navigateTo({url:'/pages/login/index'})}
})
