import {consumeMeetupReturn} from '../../services/meetup-return'
import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
import { normalizeMemberNickname } from '../../services/member-login'
import { saveOptionalAvatarProfile } from '../../services/member-profile'
import { createShareAppMessage } from '../../services/share'

type ProfileMode = 'complete' | 'edit'

type LoadOptions = {
  mode?: string
}

type InputEvent = {
  detail: { value?: string | number }
}

function avatarSelectionError(errMsg: string): Error {
  const normalized = errMsg.toLowerCase()
  if (
    normalized.includes('api scope is not declared') ||
    normalized.includes('privacy api banned')
  ) {
    return new Error('头像图片权限尚未配置，请联系管理员')
  }
  if (
    normalized.includes('privacy') ||
    normalized.includes('errno: 103') ||
    normalized.includes('errno: 104')
  ) {
    return new Error('请同意隐私保护指引后再选择头像')
  }
  return new Error(errMsg || '头像选择失败')
}

function requireAvatarPrivacyAuthorization(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.requirePrivacyAuthorize({
      success: () => resolve(),
      fail: (error) => {
        console.warn('[member-avatar] privacy authorization failed', error.errMsg)
        reject(avatarSelectionError(error.errMsg))
      }
    })
  })
}

function chooseAvatarFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => resolve(result.tempFilePaths[0] ?? ''),
      fail: (error) => {
        console.warn('[member-avatar] image selection failed', error.errMsg)
        if (error.errMsg.includes('cancel')) {
          resolve('')
          return
        }
        reject(avatarSelectionError(error.errMsg))
      }
    })
  })
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('我的资料')
  },

  data: {
    loading: true,
    saving: false,
    avatarSaving: false,
    mode: 'edit' as ProfileMode,
    member: null as MemberSelfServiceSummary | null,
    favoriteCount: 0,
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
      const client = getMiniappClient()
      const member = await client.getMemberSummary()
      if (!member) {
        if (this.data.mode === 'complete') {
          wx.reLaunch({ url: consumeMeetupReturn() || '/pages/member/index' })
          return
        }
        let favoriteCount = 0
        try {
          favoriteCount = (await client.listFavoriteGames()).length
        } catch {}
        this.setData({ member: null, favoriteCount })
        return
      }
      let favoriteCount = this.data.favoriteCount
      try {
        favoriteCount = (await client.listFavoriteGames()).length
      } catch {}
      this.setData({
        member,
        favoriteCount,
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

  async chooseAvatar() {
    if (this.data.avatarSaving) return
    let avatarUrl: string
    try {
      await requireAvatarPrivacyAuthorization()
      avatarUrl = await chooseAvatarFile()
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '头像选择失败',
        icon: 'none',
        duration: 3000
      })
      return
    }
    if (!avatarUrl) return
    if (this.data.mode === 'complete') {
      this.setData({ localAvatarPath: avatarUrl })
      return
    }
    const member = this.data.member
    if (!member) return
    this.setData({ avatarSaving: true, localAvatarPath: avatarUrl })
    try {
      const updatedMember =
        await getMiniappClient().updateMemberProfileWithAvatar(
          member.nickname,
          avatarUrl
        )
      this.setData({
        member: updatedMember,
        localAvatarPath: '',
        avatarText: Array.from(updatedMember.nickname)[0] ?? '会'
      })
    } catch (error) {
      this.setData({ localAvatarPath: '' })
      wx.showToast({
        title: error instanceof Error ? error.message : '头像上传失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ avatarSaving: false })
    }
  },

  inputNickname(event: InputEvent) {
    this.setData({ nickname: String(event.detail.value ?? '') })
  },

  async saveProfile() {
    if (this.data.saving || this.data.avatarSaving) return
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
        wx.reLaunch({ url: consumeMeetupReturn() || '/pages/member/index' })
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
    wx.reLaunch({ url: consumeMeetupReturn() || '/pages/member/index' })
  },

  goHistory() {
    wx.reLaunch({ url: '/pages/history/index' })
  },

  goGames() {
    wx.reLaunch({ url: '/pages/games/index' })
  },

  goTools() {
    wx.reLaunch({ url: '/pages/tools/index' })
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/index' })
  },

  goProfile() {}
})
