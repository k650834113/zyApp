import type {WorkspaceClient,RegistrationBatch,LotteryAdmission,NoticeScene,MemberNotice,StaffTransaction,MiniappIdentity} from '@zyapp/contracts'
/** Local UI fixtures only; this module is replaced by a throwing stub in production. */
export function createWorkspaceDemoClient(identity:()=>MiniappIdentity):WorkspaceClient{
 let batches:RegistrationBatch[]=[],registered=false
 const activityId='11111111-1111-4111-8111-111111111111',scene='l'+'1'.repeat(30)
 const scenes:NoticeScene[]=[{key:'lottery.result',title:'开奖结果提醒',description:'演示环境不发送微信消息。',templateId:null,enabled:false,fields:{}}]
 const notices:MemberNotice[]=[]
 const employee=()=>{if(!['staff','manager'].includes(identity().role))throw new Error('当前账号没有此员工操作权限')}
 const admission=():LotteryAdmission=>({activityId,title:'现场报名流程演示',rules:'仅为本机界面演示，不产生正式报名。',drawAt:'2030-11-01T12:00:00+08:00',expiresAt:new Date(Date.now()+600000).toISOString(),registered,result:null})
 return {
  activities:async()=>{employee();return [{id:activityId,title:'现场报名流程演示',drawAt:'2030-11-01T12:00:00+08:00'}]},
  batches:async()=>{employee();return batches},
  batchCode:async id=>{employee();const batch=batches.find(b=>b.id===id);if(!batch)throw new Error('报名码不存在');return batch},
  createBatch:async input=>{employee();batches=batches.map(b=>({...b,revoked:true}));const batch:RegistrationBatch={id:input.requestId,activityId,title:'现场报名流程演示',capacity:input.capacity,registered:0,reserved:0,expiresAt:new Date(Date.now()+1800000).toISOString(),revoked:false,scene,entries:[]};batches.unshift(batch);return batch},
  revokeBatch:async id=>{employee();batches=batches.map(b=>b.id===id?{...b,revoked:true}:b)},cancelEntry:async()=>{employee()},
  transactions:async()=>{employee();const items:StaffTransaction[]=[{id:'demo-order',kind:'consumption',memberName:'演示会员',memberNumber:'1001',occurredAt:new Date().toISOString(),title:'桌游畅玩 ×3',amountFen:12000,giftFen:0,status:'completed',businessNumber:'DEMO-001',details:'演示数据；实际交易以正式门店为准。'},{id:'demo-recharge',kind:'recharge',memberName:'演示会员',memberNumber:'1001',occurredAt:new Date().toISOString(),title:'微信充值',amountFen:50000,giftFen:5000,status:'settled',businessNumber:'DEMO-002',details:'演示数据'}];return {items,hasMore:false}},
  admit:async()=>admission(),register:async()=>{registered=true;return admission()},lotteryResult:async()=>admission(),
  scenes:async()=>scenes,saveScene:async s=>{if(identity().role!=='manager')throw new Error('仅店长可保存');scenes.splice(0,scenes.length,s)},
  prepareSubscription:async()=>null,recordSubscription:async()=>{},notices:async()=>({items:notices,hasMore:false}),readNotice:async id=>{const n=notices.find(n=>n.id===id);if(!n)throw new Error('消息不存在');return n}
 }
}
