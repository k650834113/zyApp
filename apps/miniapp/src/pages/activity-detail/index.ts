import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
import { publicActivityView, type PublicActivityView } from '../../services/public-content-display'
import { createShareAppMessage } from '../../services/share'
Page({
  data: { id: '', loading: true, demo: false, poster: '', activity: null as PublicActivityView | null, errorMessage: '', unavailable: false },
  onLoad(options: { id?: string }) { this.setData({ id: options.id || '' }) },
  onShow() { void this.load() },
  onShareAppMessage() {
    return { ...createShareAppMessage(this.data.activity?.title || '近期活动'), path: this.data.activity ? '/pages/activity-detail/index?id=' + encodeURIComponent(this.data.id) : '/pages/activities/index' }
  },
  async load() {
    this.setData({ loading: true, activity: null, unavailable: false, errorMessage: '' })
    try {
      const fetched = await getMiniappClient().listActivities()
      const demo = getUiDemo()
      const activity = (demo ? [...demo.home.activities,...demo.extraActivities] : fetched).find(item => item.id === this.data.id)
      this.setData({ activity: activity ? publicActivityView(activity) : null, unavailable: !activity, demo: !!demo, poster: demo ? '/assets/images/activity-illustration-v1.png' : activity?.posterUrl || '' })
    } catch { this.setData({ errorMessage: '活动详情加载失败，请重试' }) }
    finally { this.setData({ loading: false }) }
  },
  goActivities() { wx.redirectTo({ url: '/pages/activities/index' }) },
  goAbout() { wx.navigateTo({ url: '/pages/about/index' }) },
  posterError() { this.setData({poster:''}) }
})
