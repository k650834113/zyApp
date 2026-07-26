import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
import { normalizeMemberNickname } from '../../services/member-login'
import { saveOptionalAvatarProfile } from '../../services/member-profile'

type ProfileMode = 'complete' | 'edit'

type LoadOptions = {
  mode?: string
}

type AvatarEvent = {
  detail: { avatarUrl?: string }
}

type InputEvent = {
  detail: { value?: string | number }
}

Page({
  data: {
    loading: true,
    saving: false,
    mode: 'edit' as ProfileMode,
    member: null as MemberSelfServiceSummary | null,
    nickname: '',
    localAvatarPath: '',
    avatarText: '会'
  },

  onLoad(options: LoadOptions) {
    this.setData({
      mode: options.mode === 'complete' ? 'complete' : 'edit'
    })
  },

  onShow() {
    void this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const member = await getMiniappClient().getMemberSummary()
      if (!member) {
        wx.reLaunch({ url: '/pages/home/index' })
        return
      }
      this.setData({
        member,
        nickname:
          member.nickname === '微信用户' ? '' : member.nickname,
        avatarText: Array.from(member.nickname)[0] ?? '会'
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '资料加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseAvatar(event: AvatarEvent) {
    const avatarUrl = event.detail.avatarUrl ?? ''
    if (avatarUrl) {
      this.setData({ localAvatarPath: avatarUrl })
    }
  },

  inputNickname(event: InputEvent) {
    this.setData({ nickname: String(event.detail.value ?? '') })
  },

  async saveProfile() {
    if (this.data.saving) return
    let nickname: string
    try {
      nickname = normalizeMemberNickname(this.data.nickname)
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '请填写会员名称',
        icon: 'none'
      })
      return
    }
    this.setData({ saving: true })
    try {
      const member = await saveOptionalAvatarProfile(
        getMiniappClient(),
        nickname,
        this.data.localAvatarPath,
        (error) =>
          new Promise<boolean>((resolve) => {
            if (this.data.mode !== 'complete') {
              resolve(false)
              return
            }
            wx.showModal({
              title: '头像暂未上传',
              content: `${error.message}。是否先使用默认头像完成注册？`,
              confirmText: '继续注册',
              cancelText: '返回重试',
              success: (result) => resolve(result.confirm),
              fail: () => resolve(false)
            })
          })
      )
      this.setData({
        member,
        nickname: member.nickname,
        localAvatarPath: '',
        avatarText: Array.from(member.nickname)[0] ?? '会'
      })
      if (this.data.mode === 'complete') {
        wx.reLaunch({ url: '/pages/home/index' })
        return
      }
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '资料保存失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ saving: false })
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' })
  },

  goProfile() {}
})
