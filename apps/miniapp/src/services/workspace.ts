import {getMiniappClient} from './client'
export function workspaceApi(){const api=getMiniappClient().workspace;if(!api)throw new Error('当前服务暂不可用，请稍后重试');return api}
export function workspaceRequestId(){return 'workspace-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
export function beijingTime(value:string){return new Date(Date.parse(value)+8*3600000).toISOString().replace('T',' ').slice(0,19)}
export function scanRegistration(){wx.scanCode({scanType:['wxCode','qrCode'],success:r=>{
  const match=r.path?.match(/^pages\/lottery-register\/index\?scene=(l[a-f0-9]{30})(?:&|$)/)
  const scene=match?.[1]??(/^l[a-f0-9]{30}$/.test(r.result)?r.result:'')
  if(!scene){wx.showToast({title:'请扫描活动现场报名码',icon:'none'});return}
  wx.navigateTo({url:'/pages/lottery-register/index?scene='+scene})
},fail:e=>{if(!e.errMsg.includes('cancel'))wx.showToast({title:'扫码失败，请重试',icon:'none'})}})}
