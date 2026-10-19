import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
import { publicActivityView, type PublicActivityView } from '../../services/public-content-display'

type ActivityView = PublicActivityView & { tierTexts: string[]; timeText: string; location: string; tags: string[] }
Page({
  data: { loading: true, errorMessage: '', tab: 'all', allActivities: [] as ActivityView[], activities: [] as ActivityView[] },
  onShow() { void this.load() },
  selectTab(event: {currentTarget:{dataset:{tab:string}}}) { this.setData({tab:event.currentTarget.dataset.tab}); this.applyTab() },
  applyTab() {
    this.setData({ activities: this.data.allActivities.filter(activity => this.data.tab === 'upcoming' ? activity.statusText === '活动预告' : this.data.tab === 'ended' ? activity.statusText === '已结束' : true) })
  },
  goActivity(event: {currentTarget:{dataset:{id?:string}}}) {
    if (event.currentTarget.dataset.id) wx.navigateTo({url:'/pages/activity-detail/index?id=' + encodeURIComponent(event.currentTarget.dataset.id)})
  },
  async load() {
    this.setData({loading:true,errorMessage:'',activities:[],allActivities:[]})
    try {
      const fetched = await getMiniappClient().listActivities()
      const demo = getUiDemo()
      const activities = demo ? [...demo.home.activities,...demo.extraActivities] : fetched
      this.setData({allActivities:activities.map(activity => ({
        ...publicActivityView(activity),
        timeText: publicActivityView(activity).startsAtText.slice(5) + ' – ' + publicActivityView(activity).endsAtText.slice(activity.startsAt.slice(0,10) === activity.endsAt.slice(0,10) ? 11 : 5),
        tierTexts:activity.rechargeTiers.map(tier => `充 ¥${(tier.principalFen / 100).toFixed(2)} 赠 ¥${(tier.giftFen / 100).toFixed(2)}`),
        location:demo ? '据点桌游 · 主桌区' : activity.locationText || '',
        tags:demo ? ['新手友好','轻松欢乐','店内活动'] : activity.tags || []
      }))}); this.applyTab()
    } catch(error) { this.setData({errorMessage:error instanceof Error ? error.message : '活动加载失败，请重试'}) }
    finally { this.setData({loading:false}) }
  }
})
