import type {SubscriptionTicket} from '@zyapp/contracts'
import {workspaceApi} from '../../services/workspace'
import {requestNoticeSubscription} from '../../services/notice-subscription'
Component({
  properties:{scene:{type:String,value:''},businessId:{type:String,value:''},label:{type:String,value:'开启微信提醒'},disabled:{type:Boolean,value:false}},
  data:{ticket:null as SubscriptionTicket|null,busy:false,ready:false,hint:''},
  observers:{'scene,businessId'(){void this.prepare()}},
  methods:{
    async prepare(){const scene=this.data.scene,business=this.data.businessId;this.setData({ready:false,ticket:null});if(!scene)return
      try{const ticket=await workspaceApi().prepareSubscription(scene,business||undefined);if(scene===this.data.scene&&business===this.data.businessId)this.setData({ticket,ready:true})}catch{this.setData({ready:true})}},
    async subscribe(){if(this.data.busy||this.data.disabled||!this.data.ready)return;this.setData({busy:true,hint:''})
      try{const result=await requestNoticeSubscription(this.data.ticket,(id,value)=>workspaceApi().recordSubscription(id,value))
        this.setData({hint:result==='accept'?'已申请微信提醒，实际送达以微信为准。':result==='record_failed'?'提醒记录保存失败，可稍后重试；不影响当前业务操作。':'未开启微信提醒，可在消息中心查看结果。',ticket:null});this.triggerEvent('complete',{result})
      }finally{this.setData({busy:false});void this.prepare()}}
  }
})
