import { openCommunityPage } from '../../services/community-page'
Component({
  properties: { active: { type: String, value: 'home' } },
  data: { items: [
    {key:'home',label:'首页',icon:'home'}, {key:'games',label:'桌游库',icon:'games'},
    {key:'meetups',label:'约局',icon:'people'}, {key:'tools',label:'工具',icon:'tools'},
    {key:'member',label:'我的',icon:'user'}
  ] },
  methods: {
    async go(event: {currentTarget:{dataset:{key:string}}}) {
      const key = event.currentTarget.dataset.key
      if(key === this.data.active) return
      if(key === 'meetups') {
        await openCommunityPage('meetups')
        return
      }
      wx.reLaunch({url:'/pages/' + key + '/index'})
    }
  }
})
