import { createShareAppMessage } from '../../services/share'

type ToolItem = {
  title: string
  glyph: string
  tone: string
  path: string
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('桌游工具箱')
  },

  data: {
    tools: [
      { title: '先手玩家', glyph: 'first', tone: 'mint', path: '/pages/tool-first-player/index' },
      { title: '玩家分队', glyph: 'teams', tone: 'amber', path: '/pages/tool-teams/index' },
      { title: '快速骰子', glyph: 'dice', tone: 'blue', path: '/pages/tool-dice/index' },
      { title: '抛硬币', glyph: 'coin', tone: 'gold', path: '/pages/tool-coin/index' },
      { title: '计分器', glyph: 'score', tone: 'rose', path: '/pages/tool-score/index' }
    ] as ToolItem[]
  },

  openTool(event: { currentTarget: { dataset: { path?: string } } }) {
    const path = event.currentTarget.dataset.path
    if (path) wx.navigateTo({ url: path })
  },

  goHome() { wx.reLaunch({ url: '/pages/home/index' }) },
  goGames() { wx.reLaunch({ url: '/pages/games/index' }) },
  goTools() {},
  goHistory() { wx.reLaunch({ url: '/pages/history/index' }) },
  goProfile() { wx.reLaunch({ url: '/pages/member/index?mode=edit' }) }
})
