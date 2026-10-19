import type {NoticeScene} from '@zyapp/contracts'
import {workspaceApi} from '../../services/workspace'
Page({
 data:{scenes:[] as NoticeScene[],key:'',title:'',description:'',templateId:'',fields:'{}',enabled:false,error:'',busy:false},
 onShow(){void this.load()},async load(){try{this.setData({scenes:await workspaceApi().scenes()})}catch(e){this.fail(e)}},fail(e:unknown){this.setData({error:e instanceof Error?e.message:'配置操作失败'})},
 select(e:{currentTarget:{dataset:{key:string}}}){const scene=this.data.scenes.find(s=>s.key===e.currentTarget.dataset.key);if(scene)this.setData({...scene,templateId:scene.templateId??'',fields:JSON.stringify(scene.fields,null,2),error:''})},
 input(e:WechatMiniprogram.Input){const key=e.currentTarget.dataset.key as string;if(['key','title','description','templateId','fields'].includes(key))this.setData({[key]:e.detail.value})},toggle(e:WechatMiniprogram.SwitchChange){this.setData({enabled:e.detail.value})},
 async save(){if(this.data.busy)return;this.setData({busy:true,error:''});try{const fields=JSON.parse(this.data.fields);await workspaceApi().saveScene({key:this.data.key,title:this.data.title,description:this.data.description,templateId:this.data.templateId.trim()||null,enabled:this.data.enabled,fields});await this.load();wx.showToast({title:'配置已保存',icon:'success'})}catch(e){this.fail(e)}finally{this.setData({busy:false})}}
})
