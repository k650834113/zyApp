import {communityApi,requireMember,operationKey} from '../../services/social'
import type {CommunityMember} from '@zyapp/contracts'
Page({
  data:{member:null as CommunityMember|null,kind:'table' as 'table'|'friend',busy:false,error:'',done:false},token:'',requestId:'',
  onLoad(options:{scene?:string}){try{this.token=decodeURIComponent(options.scene??'')}catch{this.token=''}this.requestId=operationKey()},
  onShow(){void this.load()},
  async load(){try{await requireMember();const value=await communityApi().previewInvite(this.token);this.setData({...value,error:''})}catch(e){this.setData({error:e instanceof Error?e.message:'邀请不可用'})}},
  async confirm(){if(this.data.busy||this.data.done||!this.data.member)return;this.setData({busy:true,error:''});try{
    if(this.data.kind==='table')await communityApi().joinInvite(this.token,this.requestId)
    else await communityApi().friendCommand('request',{requestId:this.requestId,memberId:this.data.member.memberId})
    this.setData({done:true})
  }catch(e){this.setData({error:e instanceof Error?e.message:'操作失败，请重试'})}finally{this.setData({busy:false})}}
})
