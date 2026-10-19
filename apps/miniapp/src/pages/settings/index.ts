import type { PublicMiniappContent } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
type Document = NonNullable<PublicMiniappContent['documents']>[number]
Page({
  data:{documents:[] as Document[], selected:null as Document|null, version:'', member:false},
  onShow(){void this.load()},
  async load(){
    this.setData({documents:[],selected:null})
    try { const home=await getMiniappClient().getHome(); this.setData({documents:home.content?.schemaVersion===1 ? home.content.documents ?? [] : []}) } catch {}
    try {this.setData({member:Boolean(await getMiniappClient().getMemberSummary())})}catch{this.setData({member:false})}
    const info=wx.getAccountInfoSync()
    this.setData({version:info.miniProgram.version || '开发版'})
  },
  openDocument(event:{currentTarget:{dataset:{key?:string}}}){
    const selected=this.data.documents.find(item=>item.key===event.currentTarget.dataset.key)
    if(selected){this.setData({selected});return}
    wx.showModal({title:'内容待发布',content:'门店尚未发布此内容，请联系门店。',showCancel:false})
  },
  closeDocument(){this.setData({selected:null})},
  staffLogin(){wx.navigateTo({url:'/pages/staff-workbench/index'})},
  openPermissions(){wx.openSetting({fail:()=>wx.showToast({title:'暂时无法打开授权设置',icon:'none'})})},
  async logout(){
    try {await getMiniappClient().logout();this.setData({member:false});wx.reLaunch({url:'/pages/member/index'})}
    catch {wx.showToast({title:'退出失败，请重试',icon:'none'})}
  }
})
