import { beforeEach, describe, expect, it } from 'vitest'
import { MockMiniappClient, activeActivities } from './mock-client'

describe('miniapp mock client', () => {
  let client: MockMiniappClient

  beforeEach(() => {
    client = new MockMiniappClient()
  })

  it('exposes active recharge gift tiers for client previews', async () => {
    await expect(client.getRechargeConfiguration()).resolves.toEqual({
      providerMode: 'mock',
      giftTiers: [
        { principalFen: 30_000, giftFen: 2_000 },
        { principalFen: 50_000, giftFen: 5_000 },
        { principalFen: 100_000, giftFen: 20_000 }
      ]
    })
  })

  it('only exposes active public activities', () => {
    expect(activeActivities(new Date('2025-01-01T00:00:00.000Z'))).toEqual([])
    expect(activeActivities(new Date('2026-07-01T00:00:00.000Z'))).toHaveLength(1)
  })

  it('applies AND categories and complete player coverage to playable games', async () => {
    await expect(
      client.listGames({ categories: ['德式', '策略'] })
    ).resolves.toEqual([
      expect.objectContaining({ name: '璀璨宝石' })
    ])
    await expect(
      client.listGames({ minPlayers: 3, maxPlayers: 6 })
    ).resolves.toEqual([
      expect.objectContaining({ name: '妙语说书人' })
    ])
  })

  it('uses time overlap and closed numeric complexity ranges', async () => {
    const result = await client.listGames({
      minMinutes: 40,
      maxMinutes: 60,
      minComplexity: 2,
      maxComplexity: 2.5
    })
    expect(result.map((game) => game.name)).toEqual(['璀璨宝石'])
  })

  it('keeps repeated likes idempotent and removes unliked favorites', async () => {
    const splendor = (await client.listGames({ query: '璀璨宝石' }))[0]
    if (!splendor) throw new Error('Missing mock Splendor')

    await expect(
      client.setGameLiked(splendor.id, {
        liked: true,
        requestId: 'like-request-001'
      })
    ).resolves.toMatchObject({
      likedByViewer: true,
      likeCount: splendor.likeCount + 1
    })
    await expect(
      client.setGameLiked(splendor.id, {
        liked: true,
        requestId: 'like-request-001'
      })
    ).resolves.toMatchObject({
      likedByViewer: true,
      likeCount: splendor.likeCount + 1
    })
    await expect(client.listFavoriteGames()).resolves.toEqual([
      expect.objectContaining({ id: splendor.id, likedByViewer: true })
    ])

    await client.setGameLiked(splendor.id, {
      liked: false,
      requestId: 'unlike-request-001'
    })
    await expect(client.listFavoriteGames()).resolves.toEqual([])
  })

  it('logs in with a mock WeChat phone code and stores profile fields', async () => {
    const member = await client.loginWithWechatProfile({
      requestId: 'wechat-login-request-1',
      phoneCode: 'mock-phone:13800138000',
      nickname: '微信玩家',
      avatarUrl: 'wxfile://avatar',
      confirmedAtLeast14: true
    })

    expect(member).toMatchObject({
      nickname: '微信玩家',
      avatarUrl: 'wxfile://avatar',
      phoneMasked: '138****8000',
      ageGate: 'confirmed_at_least_14'
    })
    await expect(client.getIdentity()).resolves.toMatchObject({
      role: 'member',
      nickname: '微信玩家'
    })

    await expect(
      client.updateMemberProfileWithAvatar('林小满', 'wxfile://new-avatar')
    ).resolves.toMatchObject({
      nickname: '林小满',
      avatarUrl: 'wxfile://new-avatar',
      profileCompleted: true
    })
  })

  it('blocks stored-value recharge when age confirmation was declined', async () => {
    const challenge = await client.requestPhoneVerification('13800138000')
    await client.registerMember({
      requestId: 'register-request-1',
      challengeId: challenge.challengeId,
      verificationCode: challenge.mockCode ?? '',
      phone: '13800138000',
      nickname: 'Member',
      confirmedAtLeast14: false
    })
    await expect(
      client.createRechargeOrder({
        requestId: 'recharge-request-disabled',
        principalFen: 30_000
      })
    ).rejects.toThrow('暂不能储值')
  })

  it('uses the repeated highest recharge tier and upgrades at 500 yuan', async () => {
    const challenge = await client.requestPhoneVerification('13800138000')
    await client.registerMember({
      requestId: 'register-request-2',
      challengeId: challenge.challengeId,
      verificationCode: challenge.mockCode ?? '',
      phone: '13800138000',
      nickname: 'Member',
      confirmedAtLeast14: true
    })
    const order = await client.createRechargeOrder({
      requestId: 'recharge-request-1300',
      principalFen: 130_000
    })
    expect(order).toMatchObject({
      status: 'pending_payment',
      principalFen: 130_000,
      giftFen: 22_000
    })
    expect((await client.getMemberSummary())?.principalBalanceFen).toBe(0)
    await client.settleMockRechargeOrder(order.orderId)
    const member = await client.getMemberSummary()
    if (!member) throw new Error('Missing member')
    expect(member.principalBalanceFen).toBe(130_000)
    expect(member.giftBalanceFen).toBe(22_000)
    expect(member.tier).toBe('advanced')
    const history = await client.getMemberHistory()
    expect(history.activities[0]).toMatchObject({
      kind: 'recharge',
      title: '微信充值',
      amountFen: 152_000,
      status: 'settled'
    })
    expect(history.walletEntries[0]).toMatchObject({
      principalDeltaFen: 130_000,
      giftDeltaFen: 22_000
    })
  })

  it('requires a matching phone verification challenge', async () => {
    const challenge = await client.requestPhoneVerification('13800138000')
    await expect(
      client.registerMember({
        requestId: 'register-request-3',
        challengeId: challenge.challengeId,
        verificationCode: '654321',
        phone: '13800138000',
        nickname: 'Member',
        confirmedAtLeast14: true
      })
    ).rejects.toThrow('验证码不正确')
  })

  it('allows birthday month and day to be filled only once', async () => {
    const challenge = await client.requestPhoneVerification('13800138000')
    await client.registerMember({
      requestId: 'register-request-4',
      challengeId: challenge.challengeId,
      verificationCode: challenge.mockCode ?? '',
      phone: '13800138000',
      nickname: 'Member',
      confirmedAtLeast14: true
    })
    const member = await client.fillBirthday(2, 29)
    expect(member).toMatchObject({
      birthdayMonth: 2,
      birthdayDay: 29,
      birthdayCanBeFilled: false
    })
    await expect(client.fillBirthday(3, 1)).rejects.toThrow('不能再次修改')
  })

  it('keeps mobile cashier pending until the PC-style executor completes it', async () => {
    await client.enterStaffMode('manager', 'Password123!')
    const catalog = await client.listEmployeeCashierCatalog()
    const admission = catalog[0]
    if (!admission) throw new Error('Missing mock catalog')
    const command = await client.createEmployeeCashierCommand({
      requestId: 'mobile-cashier-test-1',
      paymentMethod: 'cash',
      lines: [
        {
          catalogItemId: admission.id,
          quantity: 1,
          pricingTier: 'regular'
        }
      ]
    })
    expect(command.status).toBe('pending')

    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeCashierCommand(command.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: { totalFen: admission.regularPriceFen }
    })
  })

  it('keeps employee finance pending and applies PC-style recharge and card actions', async () => {
    await client.enterStaffMode('manager', 'Password123!')
    const selected = (await client.searchEmployeeMembers('13800138000'))[0]
    if (!selected || !selected.monthlyCardId) {
      throw new Error('Missing mock employee member')
    }
    const recharge = await client.createEmployeeFinancialCommand({
      requestId: 'mobile-finance-test-1',
      type: 'cash_recharge',
      memberId: selected.memberId,
      principalFen: 50_000
    })
    expect(recharge.status).toBe('pending')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeFinancialCommand(recharge.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: {
        type: 'cash_recharge',
        wallet: { principalDeltaFen: 50_000, giftDeltaFen: 5_000 }
      }
    })

    const reloaded = await client.getEmployeeMember(selected.memberId)
    expect(reloaded.principalBalanceFen).toBe(
      selected.principalBalanceFen + 50_000
    )
    const paused = await client.createEmployeeFinancialCommand({
      requestId: 'mobile-finance-test-2',
      type: 'monthly_card_pause',
      cardId: selected.monthlyCardId,
      reason: 'Customer requested pause'
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeFinancialCommand(paused.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: {
        type: 'monthly_card_pause',
        monthlyCard: { status: 'paused' }
      }
    })
  })

  it('keeps activity publishing separate from recharge-rule activation and shows manager reports', async () => {
    await client.enterStaffMode('manager', 'Password123!')
    const created = await client.createEmployeeActivity({
      requestId: 'manager-activity-test-1',
      title: 'Holiday campaign',
      summary: 'Holiday recharge promotion',
      content: 'Promotion copy for the customer activity page.',
      activityType: 'recharge',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-12-31T16:00:00.000Z',
      pinned: true,
      allowStoredValue: false,
      allowWechat: true,
      rechargeTiers: [{ principalFen: 50000, giftFen: 8000 }]
    })
    expect(created.status).toBe('draft')

    const published = await client.setEmployeeActivityStatus({
      requestId: 'manager-activity-test-2',
      activityId: created.id,
      status: 'published',
      reason: 'Approved for publication'
    })
    expect(published).toMatchObject({
      status: 'published',
      rechargeTiers: [{ principalFen: 50000, giftFen: 8000 }]
    })

    const selected = (await client.searchEmployeeMembers('13800138000'))[0]
    if (!selected) throw new Error('Missing mock employee member')
    const beforeApply = await client.createEmployeeFinancialCommand({
      requestId: 'manager-activity-test-3',
      type: 'cash_recharge',
      memberId: selected.memberId,
      principalFen: 50_000
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeFinancialCommand(beforeApply.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: {
        type: 'cash_recharge',
        wallet: { giftDeltaFen: 5_000 }
      }
    })

    const apply = await client.createEmployeeFinancialCommand({
      requestId: 'manager-activity-test-4',
      type: 'apply_activity_recharge_tiers',
      activityId: created.id,
      reason: 'Apply approved holiday recharge tiers'
    })
    expect(apply.status).toBe('pending')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeFinancialCommand(apply.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: {
        type: 'apply_activity_recharge_tiers',
        rechargeGiftTiers: [
          { principalFen: 50_000, giftFen: 8_000, active: true }
        ]
      }
    })

    const afterApply = await client.createEmployeeFinancialCommand({
      requestId: 'manager-activity-test-5',
      type: 'cash_recharge',
      memberId: selected.memberId,
      principalFen: 50_000
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(
      client.getEmployeeFinancialCommand(afterApply.commandId)
    ).resolves.toMatchObject({
      status: 'completed',
      result: {
        type: 'cash_recharge',
        wallet: { giftDeltaFen: 8_000 }
      }
    })

    const report = await client.getEmployeeBusinessReport({
      fromDate: '2026-06-01',
      toDate: '2026-06-14'
    })
    expect(report).toMatchObject({
      order: { orderCount: 12 },
      wallet: { rechargePrincipalFen: 130000 },
      monthlyCard: { activeCount: 8 }
    })
  })

  it('reflects mobile announcements, store status, and board-game operations on public pages', async () => {
    await client.enterStaffMode('manager', 'Password123!')
    const announcement = await client.createEmployeeAnnouncement({
      requestId: 'content-announcement-1',
      title: 'Temporary closure',
      content: 'The store is closed tonight for a private event.',
      pinned: true,
      visibleFrom: '2026-01-01T00:00:00.000Z',
      visibleUntil: '2030-01-01T00:00:00.000Z'
    })
    await client.setEmployeeAnnouncementStatus({
      requestId: 'content-announcement-2',
      announcementId: announcement.id,
      status: 'published',
      reason: 'Publish temporary closure notice'
    })
    await client.updateEmployeeStoreStatus({
      requestId: 'content-store-1',
      statusOverride: 'closed',
      customStatusText: '今晚包场暂停接待',
      reason: 'Private event'
    })

    const boardGame = (await client.listEmployeeBoardGames())[0]
    if (!boardGame) throw new Error('Missing mock board game')
    await client.updateEmployeeBoardGameOperations({
      requestId: 'content-board-1',
      boardGameId: boardGame.id,
      available: true,
      customerConsigned: false,
      missingPieces: false,
      private: true,
      customerNote: 'Temporarily hidden',
      internalNote: 'Used for a private event',
      consignorNickname: '',
      missingParts: [],
      reason: 'Hide during private event'
    })

    const home = await client.getHome()
    expect(home.store).toMatchObject({
      isOpen: false,
      statusText: '今晚包场暂停接待'
    })
    expect(home.announcements[0]).toMatchObject({
      id: announcement.id,
      title: 'Temporary closure'
    })
    expect((await client.listGames()).some((game) => game.id === boardGame.id))
      .toBe(false)

    await client.updateEmployeeBoardGameOperations({
      requestId: 'content-board-2',
      boardGameId: boardGame.id,
      available: false,
      customerConsigned: false,
      missingPieces: false,
      private: false,
      customerNote: 'Currently unavailable',
      internalNote: '',
      consignorNickname: '',
      missingParts: [],
      reason: 'Mark unavailable after inspection'
    })
    expect(
      (await client.listGames()).find((game) => game.id === boardGame.id)
    ).toBeUndefined()
  })
})
