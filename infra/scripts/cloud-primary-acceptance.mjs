import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

async function passwordHash(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  })
  return ['scrypt', 16_384, 8, 1, salt.toString('base64url'), derived.toString('base64url')].join('$')
}

const baseUrl = (process.env.ZYAPP_BASE_URL ?? '').replace(/\/$/, '')
const enrollmentSecret = process.env.ZYAPP_ENROLLMENT_SECRET ?? ''
const environment = process.env.ZYAPP_ENVIRONMENT === 'production' ? 'production' : 'test'

if (!baseUrl || enrollmentSecret.length < 32) {
  throw new Error('ZYAPP_BASE_URL and ZYAPP_ENROLLMENT_SECRET are required')
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(20_000)
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${body?.message ?? text}`)
  }
  return body
}

function auth(device) {
  return {
    authorization: `Bearer ${device.token}`,
    'content-type': 'application/json',
    'x-zyapp-device-id': device.deviceId
  }
}

function hashPayload(payloadJson) {
  return createHash('sha256').update(payloadJson).digest('hex')
}

const tenantId = randomUUID()
const storeId = randomUUID()
const managerId = randomUUID()
const epochId = randomUUID()
const storeName = `Cloud acceptance ${new Date().toISOString()}`
const managerPassword = 'AcceptancePass123'

async function enroll(deviceName) {
  const deviceId = randomUUID()
  return request('/v1/devices/enroll', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zyapp-enrollment-secret': enrollmentSecret
    },
    body: JSON.stringify({
      environment,
      tenantId,
      storeId,
      deviceId,
      storeName,
      deviceName
    })
  })
}

const primary = await enroll('Acceptance primary')
await request('/v1/desktop/mirror/epoch/empty', {
  method: 'POST',
  headers: auth(primary),
  body: JSON.stringify({
    epochId,
    archiveSha256: createHash('sha256').update('acceptance-empty-archive').digest('hex')
  })
})

const sequence = new Map([[primary.deviceId, 1]])
const submitted = []
const offlineQueue = []
let queueOffline = false

async function command(device, input) {
  const deviceSeq = sequence.get(device.deviceId) ?? 1
  sequence.set(device.deviceId, deviceSeq + 1)
  const payloadJson = JSON.stringify(input.payload)
  const operation = {
    protocolVersion: 2,
    operationId: input.operationId ?? randomUUID(),
    deviceId: device.deviceId,
    deviceSeq,
    tenantId,
    storeId,
    actorId: input.actorId === undefined ? managerId : input.actorId,
    operationType: input.operationType,
    aggregateId: input.aggregateId,
    baseVersion: input.baseVersion ?? null,
    changedFields: input.changedFields,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payloadJson,
    payloadHash: hashPayload(payloadJson)
  }
  if (queueOffline) {
    offlineQueue.push({ device, operation, input })
    return { outcome: { status: 'queued_offline', serverVersion: null } }
  }
  return submitOperation(device, operation, input)
}

async function submitOperation(device, operation, input) {
  const result = await request('/v1/sync/command', {
    method: 'POST',
    headers: auth(device),
    body: JSON.stringify({ protocolVersion: 2, operation })
  })
  if (result.outcome.status !== (input.expectedStatus ?? 'confirmed')) {
    throw new Error(`${input.operationType} returned ${result.outcome.status}`)
  }
  submitted.push({ device, operation, result })
  return result
}

async function flushOfflineQueue() {
  for (const queued of offlineQueue) {
    await submitOperation(queued.device, queued.operation, queued.input)
  }
}

const now = new Date().toISOString()
await command(primary, {
  operationType: 'employee.snapshot',
  aggregateId: managerId,
  actorId: managerId,
  changedFields: ['username', 'displayName', 'role', 'status'],
  payload: {
    action: 'employee.snapshot',
    aggregateId: managerId,
    before: null,
    after: {
      id: managerId,
      username: 'acceptance-manager',
      displayName: 'Acceptance Manager',
      role: 'manager',
      status: 'active',
      createdAt: now,
      updatedAt: now
    },
    reason: 'acceptance bootstrap'
  }
})
await command(primary, {
  operationType: 'employee.pc_credential.updated',
  aggregateId: managerId,
  actorId: managerId,
  payload: {
    action: 'employee.pc_credential.updated',
    aggregateId: managerId,
    before: null,
    after: {
      employeeId: managerId,
      passwordHash: await passwordHash(managerPassword),
      updatedAt: now
    },
    reason: 'acceptance desktop credential bootstrap'
  }
})

const pairing = await request('/v1/devices/pairing-codes', {
  method: 'POST',
  headers: auth(primary),
  body: JSON.stringify({ actorId: managerId })
})
const secondaryDeviceId = randomUUID()
const onboardingRequestId = randomUUID()
const secondary = await request('/v1/devices/enroll-paired', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    environment,
    pairingCode: pairing.code,
    deviceId: secondaryDeviceId,
    deviceName: 'Acceptance secondary',
    requestId: onboardingRequestId
  })
})
const desktopLogin = await request('/v1/desktop-auth/login', {
  method: 'POST',
  headers: auth(secondary),
  body: JSON.stringify({
    username: 'acceptance-manager',
    password: managerPassword
  })
})
if (
  desktopLogin.employee.id !== managerId ||
  Date.parse(desktopLogin.offlineValidUntil) - Date.parse(desktopLogin.serverTime) !== 30 * 86400_000
) {
  throw new Error('Desktop cloud login did not return the expected 30-day authorization')
}
sequence.set(secondary.deviceId, 1)
queueOffline = true

const members = []
const wallets = []
for (let index = 0; index < 20; index += 1) {
  const member = {
    id: randomUUID(),
    memberNumber: `A${String(index + 1).padStart(4, '0')}`,
    phone: `13988${String(index).padStart(6, '0')}`,
    nickname: `Acceptance ${index + 1}`,
    tier: 'ordinary',
    status: 'active',
    birthdayMonth: null,
    birthdayDay: null,
    birthdaySource: null,
    ageGate: 'confirmed_at_least_14',
    note: null,
    source: 'desktop',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  members.push(member)
  const device = index % 2 === 0 ? primary : secondary
  await command(device, {
    operationType: 'member.created',
    aggregateId: member.id,
    changedFields: ['memberNumber', 'phone', 'nickname', 'tier', 'status', 'ageGate'],
    payload: {
      action: 'member.created',
      aggregateId: member.id,
      before: null,
      after: member,
      reason: '100-operation acceptance'
    }
  })
}

for (let index = 0; index < members.length; index += 1) {
  const member = members[index]
  const wallet = {
    accountId: randomUUID(),
    memberId: member.id,
    status: 'active',
    principalBalanceFen: 10_000,
    giftBalanceFen: 1_000,
    totalBalanceFen: 11_000,
    updatedAt: new Date().toISOString()
  }
  wallets.push(wallet)
  const device = index % 2 === 0 ? secondary : primary
  await command(device, {
    operationType: 'wallet.cash_recharged',
    aggregateId: wallet.accountId,
    payload: {
      action: 'wallet.cash_recharged',
      aggregateId: wallet.accountId,
      before: null,
      after: {
        operationId: randomUUID(),
        wallet,
        principalDeltaFen: 10_000,
        giftDeltaFen: 1_000
      },
      reason: 'acceptance recharge'
    }
  })
}

for (let index = 0; index < wallets.length; index += 1) {
  const wallet = wallets[index]
  const before = { ...wallet }
  wallet.giftBalanceFen -= 500
  wallet.totalBalanceFen -= 500
  wallet.updatedAt = new Date().toISOString()
  const device = index % 2 === 0 ? primary : secondary
  await command(device, {
    operationType: 'wallet.debited',
    aggregateId: wallet.accountId,
    payload: {
      action: 'wallet.debited',
      aggregateId: wallet.accountId,
      before,
      after: {
        operationId: randomUUID(),
        wallet: { ...wallet },
        principalDeltaFen: 0,
        giftDeltaFen: -500
      },
      reason: 'acceptance debit'
    }
  })
}

const cards = []
for (let index = 0; index < 10; index += 1) {
  const purchasedAt = new Date()
  const card = {
    id: randomUUID(),
    memberId: members[index].id,
    planName: '30 天月卡',
    priceFen: 20_000,
    paymentMethod: 'cash',
    status: 'active',
    purchasedAt: purchasedAt.toISOString(),
    startsAt: purchasedAt.toISOString(),
    expiresAt: new Date(purchasedAt.getTime() + 30 * 86400_000).toISOString(),
    pausedAt: null,
    usageCount: 0
  }
  cards.push(card)
  await command(index % 2 === 0 ? primary : secondary, {
    operationType: 'monthly_card.purchased',
    aggregateId: card.id,
    payload: {
      action: 'monthly_card.purchased',
      cardId: card.id,
      before: null,
      after: card,
      reason: 'acceptance monthly card'
    }
  })
}

for (let index = 0; index < cards.length; index += 1) {
  const before = { ...cards[index] }
  cards[index].usageCount += 1
  await command(index % 2 === 0 ? secondary : primary, {
    operationType: 'monthly_card.used',
    aggregateId: cards[index].id,
    payload: {
      action: 'monthly_card.used',
      cardId: cards[index].id,
      before,
      after: { ...cards[index] },
      reason: 'acceptance use'
    }
  })
}

const orders = []
for (let index = 0; index < 10; index += 1) {
  const order = {
    id: randomUUID(),
    orderNumber: `OA-${Date.now()}-${index}`,
    visitBatchId: randomUUID(),
    customerMemberId: members[index].id,
    paymentMethod: 'cash',
    walletMemberId: null,
    status: 'completed',
    totalFen: 4_000,
    note: null,
    completedAt: new Date().toISOString(),
    items: [{
      id: randomUUID(),
      catalogItemId: randomUUID(),
      itemName: '入场费',
      itemType: 'admission',
      regularPriceFen: 4_000,
      advancedPriceFen: 3_000,
      appliedUnitPriceFen: 4_000,
      pricingTier: 'regular',
      quantity: 1,
      lineTotalFen: 4_000,
      benefitType: 'none',
      beneficiaryMemberId: null
    }]
  }
  orders.push(order)
  await command(index % 2 === 0 ? primary : secondary, {
    operationType: 'order.completed',
    aggregateId: order.id,
    payload: order
  })
}

const refunds = []
for (let index = 0; index < 5; index += 1) {
  const order = orders[index]
  const refund = {
    id: randomUUID(),
    refundNumber: `RA-${Date.now()}-${index}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    paymentMethod: 'cash',
    walletMemberId: null,
    status: 'pending',
    totalFen: 4_000,
    requestedBy: managerId,
    requestedAt: new Date().toISOString(),
    requestReason: 'acceptance refund',
    approvedBy: null,
    approvedAt: null,
    specialProductOverride: false,
    completionReason: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    completedAt: null,
    items: [{
      id: randomUUID(),
      orderItemId: order.items[0].id,
      itemName: order.items[0].itemName,
      itemType: order.items[0].itemType,
      unitRefundFen: 4_000,
      quantity: 1,
      lineRefundFen: 4_000
    }],
    evidence: []
  }
  refunds.push(refund)
  await command(index % 2 === 0 ? secondary : primary, {
    operationType: 'refund.requested',
    aggregateId: refund.id,
    payload: {
      action: 'refund.requested',
      refundId: refund.id,
      before: null,
      after: refund,
      reason: 'acceptance refund'
    }
  })
}

for (let index = 0; index < refunds.length; index += 1) {
  const before = { ...refunds[index] }
  refunds[index] = {
    ...refunds[index],
    status: 'completed',
    approvedBy: managerId,
    approvedAt: new Date().toISOString(),
    completionReason: 'acceptance approved',
    completedAt: new Date().toISOString()
  }
  await command(index % 2 === 0 ? primary : secondary, {
    operationType: 'refund.completed',
    aggregateId: refunds[index].id,
    payload: {
      action: 'refund.completed',
      refundId: refunds[index].id,
      before,
      after: refunds[index],
      reason: 'acceptance approved'
    }
  })
}

queueOffline = false
await flushOfflineQueue()

const businessOperations = submitted.filter((entry) =>
  !['employee.snapshot', 'employee.pc_credential.updated'].includes(entry.operation.operationType)
)
if (businessOperations.length !== 100) {
  throw new Error(`Expected 100 business operations, received ${businessOperations.length}`)
}

const initialMemberEntry = businessOperations.find(
  (entry) => entry.operation.aggregateId === members[0].id
)
if (!initialMemberEntry?.result.outcome.serverVersion) {
  throw new Error('Initial member server version is missing')
}
const initialMemberVersion = initialMemberEntry.result.outcome.serverVersion
const memberBeforeUpdate = { ...members[0] }
members[0] = {
  ...members[0],
  nickname: 'First concurrent edit',
  updatedAt: new Date().toISOString()
}
await command(primary, {
  operationType: 'member.updated',
  aggregateId: members[0].id,
  baseVersion: initialMemberVersion,
  changedFields: ['nickname'],
  payload: {
    action: 'member.updated',
    aggregateId: members[0].id,
    before: memberBeforeUpdate,
    after: members[0],
    reason: 'acceptance first concurrent edit'
  }
})
const overlapResult = await command(secondary, {
  operationType: 'member.updated',
  aggregateId: members[0].id,
  baseVersion: initialMemberVersion,
  changedFields: ['nickname'],
  expectedStatus: 'conflict',
  payload: {
    action: 'member.updated',
    aggregateId: members[0].id,
    before: memberBeforeUpdate,
    after: {
      ...memberBeforeUpdate,
      nickname: 'Overlapping concurrent edit',
      updatedAt: new Date().toISOString()
    },
    reason: 'acceptance overlapping edit'
  }
})
if (overlapResult.outcome.conflictType !== 'member_version_mismatch') {
  throw new Error(`Unexpected overlap conflict type ${overlapResult.outcome.conflictType}`)
}

const duplicateMemberId = randomUUID()
const duplicatePhoneResult = await command(secondary, {
  operationType: 'member.created',
  aggregateId: duplicateMemberId,
  changedFields: ['memberNumber', 'phone', 'nickname', 'status'],
  expectedStatus: 'conflict',
  payload: {
    action: 'member.created',
    aggregateId: duplicateMemberId,
    before: null,
    after: {
      ...memberBeforeUpdate,
      id: duplicateMemberId,
      memberNumber: 'A-DUPLICATE',
      nickname: 'Duplicate phone',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    reason: 'acceptance duplicate phone'
  }
})
if (duplicatePhoneResult.outcome.conflictType !== 'member_phone_duplicate') {
  throw new Error(`Unexpected duplicate conflict type ${duplicatePhoneResult.outcome.conflictType}`)
}

const claimedPrimaryLease = await request('/v1/devices/offline-writer-lease/claim', {
  method: 'POST',
  headers: auth(primary),
  body: JSON.stringify({ actorId: managerId })
})
if (!claimedPrimaryLease.currentDeviceOwnsLease) {
  throw new Error('Primary device did not receive its offline finance lease')
}
const secondaryLeaseView = await request('/v1/devices/offline-writer-lease', {
  headers: auth(secondary)
})
if (secondaryLeaseView.ownerDeviceId !== primary.deviceId || secondaryLeaseView.currentDeviceOwnsLease) {
  throw new Error('Secondary device saw an invalid primary lease state')
}
const transferredLease = await request('/v1/devices/offline-writer-lease/claim', {
  method: 'POST',
  headers: auth(secondary),
  body: JSON.stringify({ actorId: managerId })
})
if (!transferredLease.currentDeviceOwnsLease || transferredLease.ownerDeviceId !== secondary.deviceId) {
  throw new Error('Offline finance lease did not transfer to the secondary device')
}

async function readSseCursor(device) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${baseUrl}/v1/sync/stream`, {
      headers: { ...auth(device), accept: 'text/event-stream' },
      signal: controller.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`SSE returned HTTP ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let value = ''
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const chunk = await reader.read()
      if (chunk.done) break
      value += decoder.decode(chunk.value, { stream: true })
      const match = value.match(/"cursor"\s*:\s*"(\d+)"/)
      if (match) {
        await reader.cancel()
        return match[1]
      }
    }
    await reader.cancel()
    throw new Error('SSE cursor was not received')
  } finally {
    clearTimeout(timer)
  }
}
const firstSseCursor = await readSseCursor(primary)
const resumedSseCursor = await readSseCursor(primary)
if (BigInt(resumedSseCursor) < BigInt(firstSseCursor)) {
  throw new Error('SSE cursor moved backwards after reconnect')
}

for (const entry of businessOperations.slice(0, 10)) {
  const repeated = await request('/v1/sync/command', {
    method: 'POST',
    headers: auth(entry.device),
    body: JSON.stringify({ protocolVersion: 2, operation: entry.operation })
  })
  if (repeated.outcome.status !== 'confirmed') {
    throw new Error('Idempotent retry did not remain confirmed')
  }
}

async function mirrorCount(resource) {
  const page = await request(`/v1/desktop/mirror/${resource}?limit=500`, {
    headers: auth(secondary)
  })
  return page.rows.length
}

const counts = {
  members: await mirrorCount('members'),
  walletAccounts: await mirrorCount('wallet_accounts'),
  walletLedger: await mirrorCount('wallet_ledger'),
  monthlyCards: await mirrorCount('monthly_cards'),
  monthlyCardEvents: await mirrorCount('monthly_card_events'),
  orders: await mirrorCount('orders'),
  orderItems: await mirrorCount('order_items'),
  refunds: await mirrorCount('refunds'),
  refundEvents: await mirrorCount('refund_events')
}

const expected = {
  members: 20,
  walletAccounts: 20,
  walletLedger: 40,
  monthlyCards: 10,
  monthlyCardEvents: 20,
  orders: 10,
  orderItems: 10,
  refunds: 5,
  refundEvents: 10
}
for (const [key, value] of Object.entries(expected)) {
  if (counts[key] !== value) {
    throw new Error(`Mirror count ${key} expected ${value}, received ${counts[key]}`)
  }
}

const replayDeviceId = randomUUID()
const idempotentReplay = await request('/v1/devices/enroll-paired', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    environment,
    pairingCode: pairing.code,
    deviceId: secondaryDeviceId,
    deviceName: 'Acceptance secondary resumed',
    requestId: onboardingRequestId
  })
})
if (idempotentReplay.deviceId !== secondaryDeviceId) {
  throw new Error('Idempotent pairing replay returned a different device')
}
let pairingReplayStatus = 0
const replayResponse = await fetch(`${baseUrl}/v1/devices/enroll-paired`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    environment,
    pairingCode: pairing.code,
    deviceId: replayDeviceId,
    deviceName: 'Pairing replay'
  })
})
pairingReplayStatus = replayResponse.status
if (pairingReplayStatus !== 401) {
  throw new Error(`Consumed pairing code returned HTTP ${pairingReplayStatus}`)
}

console.log(JSON.stringify({
  ok: true,
  environment,
  tenantId,
  storeId,
  epochId,
  primaryDeviceId: primary.deviceId,
  secondaryDeviceId: secondary.deviceId,
  businessOperations: businessOperations.length,
  offlineQueuedBeforeReconnect: offlineQueue.length,
  idempotentRetries: 10,
  conflictChecks: {
    overlappingField: overlapResult.outcome.conflictType,
    duplicatePhone: duplicatePhoneResult.outcome.conflictType
  },
  offlineLeaseTransferredTo: transferredLease.ownerDeviceId,
  sseReconnect: { firstSseCursor, resumedSseCursor },
  pairingReplayStatus,
  desktopLogin: {
    employeeId: desktopLogin.employee.id,
    credentialVersion: desktopLogin.credentialVersion,
    offlineValidUntil: desktopLogin.offlineValidUntil
  },
  idempotentPairingReplay: true,
  counts
}, null, 2))
