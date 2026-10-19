import type { PublicStoreSummary, PublicMiniappContent } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
Page({
  data: { loading: true, store: null as PublicStoreSummary | null, errorMessage: '', content: null as PublicMiniappContent | null, contacts: [] as NonNullable<PublicMiniappContent['contacts']> },
  onShow() { void this.load() },
  async load() {
    this.setData({ loading: true, errorMessage: '' })
    try { const fetched = await getMiniappClient().getHome(); const home = getUiDemo()?.home || fetched; const content = home.content?.schemaVersion === 1 ? home.content : null; this.setData({ store: home.store, content, contacts: content?.contacts || [] }) }
    catch { this.setData({ store: null, content:null, contacts:[], errorMessage: '门店资料加载失败，请重试' }) }
    finally { this.setData({ loading: false }) }
  },
  copyAddress() {
    const location = this.data.content?.location
    if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180) {
      wx.openLocation({latitude:location.latitude,longitude:location.longitude,name:this.data.store?.name || '',address:this.data.store?.address || ''}); return
    }
    const address = this.data.store?.address
    if (address) wx.setClipboardData({ data: address }); else wx.showToast({title:'门店地址待补充',icon:'none'})
  },
  callStore() { const phone = this.data.store?.contactPhone; if (phone) wx.makePhoneCall({ phoneNumber: phone }); else wx.showToast({title:'门店联系电话待补充',icon:'none'}) },
  goPricing() { wx.navigateTo({url:'/pages/pricing/index'}) },
  copyContact(event: {currentTarget:{dataset:{value:string}}}) { const contact = this.data.contacts.find(item => item.value === event.currentTarget.dataset.value); if(!contact) return; if(contact.action === 'phone') wx.makePhoneCall({phoneNumber:contact.value}); else wx.setClipboardData({data:contact.value}) },
  photoError() { if(this.data.content) this.setData({content:{...this.data.content,storePhotoUrl:null}}) }
})
