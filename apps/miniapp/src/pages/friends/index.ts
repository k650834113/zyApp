import {communityApi,requireMember,operationKey,inviteEnvironment,writeInviteImage,scanCommunityInvite} from '../../services/social'
import type {CommunityMember,FriendRequest} from '@zyapp/contracts'
Page({
  data:{friends:[] as CommunityMember[],requests:[] as FriendRequest[],found:null as CommunityMember|null,self:null as CommunityMember|null,number:'',error:'',busy:false,pick:false,excluded:[] as string[],codePath:''},
  visible:false,sequence:0,selected:false,
  onLoad(options:{pick?:string}){this.setData({pick:options.pick==='1'});this.getOpenerEventChannel?.()?.on?.('exclude',(ids:string[])=>this.setData({excluded:ids}))},
  onShow(){this.visible=true;this.setData({friends:[],requests:[],self:null,found:null});void this.load()},onHide(){this.visible=false;this.sequence++},onUnload(){this.visible=false;this.sequence++;if(this.data.pick&&!this.selected)this.getOpenerEventChannel?.()?.emit?.('closed')},
  async load(){const sequence=++this.sequence;try{await requireMember();const [value,self]=await Promise.all([communityApi().friends(),communityApi().selfMember()]);if(this.visible&&sequence===this.sequence)this.setData({...value,self,error:''})}catch(e){if(this.visible&&sequence===this.sequence)this.setData({error:e instanceof Error?e.message:'加载失败'})}},
  inputNumber(e:WechatMiniprogram.Input){this.setData({number:e.detail.value,found:null})},
  async search(){await this.run(async()=>{this.setData({found:await communityApi().findMember(this.data.number)})})},
  async run(work:()=>Promise<void>){if(this.data.busy)return;this.setData({busy:true,error:''});try{await work()}catch(e){this.setData({error:e instanceof Error?e.message:'操作失败'})}finally{this.setData({busy:false})}},
  async act(e:{currentTarget:{dataset:{action:'request'|'accept'|'reject'|'remove';id?:string;memberId?:string}}}){
    const {action,id,memberId}=e.currentTarget.dataset
    if(action==='remove'){const confirmed=await new Promise<boolean>(resolve=>wx.showModal({title:'删除好友',content:'删除后不能直接将对方加入新的共享对局，已有记录保留。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!confirmed)return}
    await this.run(async()=>{await requireMember();await communityApi().friendCommand(action,{requestId:operationKey(),...(id?{id}:{}),...(memberId?{memberId}:{})});await this.load();wx.showToast({title:action==='request'?'申请已发送':'已处理',icon:'none'})})
  },
  select(e:{currentTarget:{dataset:{id:string}}}){if(!this.data.pick)return;const m=this.data.friends.find(m=>m.memberId===e.currentTarget.dataset.id);if(!m||this.data.excluded.includes(m.memberId)){wx.showToast({title:'该玩家已经在本局中',icon:'none'});return}this.selected=true;this.getOpenerEventChannel?.()?.emit?.('selected',m);wx.navigateBack()},
  async showCode(){await this.run(async()=>{await requireMember();const invite=await communityApi().createInvite({requestId:operationKey(),envVersion:inviteEnvironment()});this.setData({codePath:await writeInviteImage(invite.imageDataUrl)})})},
  hideCode(){this.setData({codePath:''})},scan:scanCommunityInvite
})
