import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
Page({
  data: { rows: [] as {label:string,regular:string,member:string}[], extras: [] as {icon:string,label:string,value:string,note:string}[], memberNote:'', monthlyPrice:'—', monthlyDuration:'', unavailable:true, monthlyError:false },
  onShow() { void this.load() },
  async load() {
    const demo = getUiDemo()
    this.setData({rows:[],extras:[],memberNote:'',unavailable:true,monthlyError:false})
    try {
      const [home,publicPricing] = await Promise.all([getMiniappClient().getHome(),getMiniappClient().getPublicPricing()])
      const pricing = demo?.pricing || (home.content?.schemaVersion === 1 ? home.content.pricing : null)
      const rows=pricing ? pricing.rows : demo ? [] : publicPricing.rows.filter(row => row.label.trim() === '入场费')
      this.setData({rows,extras:pricing?.extras || [],memberNote:pricing?.memberNote || '',unavailable:rows.length===0,
        monthlyPrice:`${(publicPricing.monthlyCard.priceFen / 100).toFixed(2).replace(/\.00$/, '')}元`,monthlyDuration:`有效期${publicPricing.monthlyCard.durationDays}天`})
    } catch { /* Leave the explicit unavailable state; monthly-card API is independent. */ }
  },
  goRecharge() { wx.navigateTo({url:'/pages/recharge/index'}) },
  goAbout() { wx.navigateTo({url:'/pages/about/index'}) }
})
