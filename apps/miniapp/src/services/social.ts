import { getMiniappClient } from './client'
import type { CommunityMember } from '@zyapp/contracts'
export function communityApi(){const api=getMiniappClient().community;if(!api)throw new Error('云端服务暂不可用');return api}
export function operationKey(){return 'social-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
export async function requireMember(){
  const m=await getMiniappClient().getMemberSummary()
  if(!m){wx.navigateTo({url:'/pages/login/index'});throw new Error('请登录后继续')}
  return m
}
export async function chooseFriend(excluded:string[]):Promise<CommunityMember|null> {
  await requireMember()
  const list=(await communityApi().friends()).friends.filter(m=>!excluded.includes(m.memberId))
  if(!list.length){wx.showToast({title:'没有可添加的好友',icon:'none'});return null}
  // Native action sheets support at most six items. A dedicated picker supports the full list.
  return new Promise(resolve=>wx.navigateTo({url:'/pages/friends/index?pick=1',events:{selected:(m:CommunityMember)=>resolve(m),closed:()=>resolve(null)},
    success:r=>r.eventChannel.emit('exclude',excluded),fail:()=>resolve(null)}))
}
export function inviteEnvironment():'release'|'trial'|'develop' {
  return wx.getAccountInfoSync().miniProgram.envVersion
}
export function writeInviteImage(dataUrl:string):Promise<string> {
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if(!match)throw new Error('小程序码图片无效')
  const path=wx.env.USER_DATA_PATH+'/community-invite-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.'+(match[1]==='png'?'png':'jpg')
  return new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:match[2]!,encoding:'base64',success:()=>resolve(path),fail:()=>reject(new Error('无法保存小程序码图片'))}))
}
export function scanCommunityInvite(){wx.scanCode({onlyFromCamera:false,scanType:['qrCode','wxCode'],success:r=>{
  const scene=r.path?.match(/(?:\?|&)scene=([a-f0-9]{32})(?:&|$)/)?.[1]
  const token=scene??(/^[a-f0-9]{32}$/.test(r.result)?r.result:'')
  if(!token){wx.showToast({title:'请扫描本店好友码或同桌码',icon:'none'});return}
  wx.navigateTo({url:'/pages/community-invite/index?scene='+token})
},fail:e=>{if(!e.errMsg.includes('cancel'))wx.showToast({title:'扫码失败，请重试',icon:'none'})}})}
