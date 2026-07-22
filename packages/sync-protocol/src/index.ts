export type SyncOperation = {
  operationId: string
  deviceId: string
  deviceSeq: number
  tenantId: string
  storeId: string
  actorId: string | null
  operationType: string
  aggregateId: string
  baseVersion: number | null
  occurredAt: string
  payloadJson: string
  payloadHash: string
  protocolVersion?: 1 | 2
  changedFields?: string[]
}

export type SyncPushBatch = {
  protocolVersion: 1 | 2
  deviceId: string
  firstDeviceSeq: number
  lastDeviceSeq: number
  operations: SyncOperation[]
}

export type SyncCommandRequest = {
  protocolVersion: 2
  operation: SyncOperation & { protocolVersion: 2 }
}

export type SyncOperationOutcome =
  | {
      operationId: string
      status: 'received' | 'processing'
      serverVersion: null
      conflictType: null
      serverPayloadJson: null
      resultJson: string | null
    }
  | {
      operationId: string
      status: 'confirmed'
      serverVersion: number | null
      conflictType: null
      serverPayloadJson: null
      resultJson: string | null
    }
  | {
      operationId: string
      status: 'conflict'
      serverVersion: number | null
      conflictType: SyncConflictType
      serverPayloadJson: string | null
      resultJson: string | null
    }

export type SyncCommandResult = {
  protocolVersion: 2
  deviceId: string
  outcome: SyncOperationOutcome
  serverTime: string
}

export type SyncConflictType =
  | 'member_phone_duplicate'
  | 'member_version_mismatch'
  | 'wallet_authority_conflict'
  | 'monthly_card_state_conflict'
  | 'catalog_version_mismatch'
  | 'unknown'

export type SyncReceipt =
  | {
      operationId: string
      status: 'confirmed'
      serverVersion: number | null
    }
  | {
      operationId: string
      status: 'conflict'
      conflictType: SyncConflictType
      serverPayloadJson: string | null
    }

export type SyncPushResult = {
  protocolVersion: 1
  deviceId: string
  receipts: SyncReceipt[]
  serverTime: string
}

export type SyncReceiveReceipt = {
  operationId: string
  status: 'accepted' | 'already_received'
}

export type SyncReceiveResult = {
  protocolVersion: 1
  deviceId: string
  receipts: SyncReceiveReceipt[]
  serverTime: string
}

export type SyncPullEvent = {
  sequence: string
  eventId: string
  tenantId: string
  storeId: string
  originDeviceId: string | null
  aggregateType: string
  aggregateId: string
  eventType: string
  payloadJson: string
  occurredAt: string
}

export type SyncPullResult = {
  protocolVersion: 1
  deviceId: string
  afterCursor: string | null
  nextCursor: string | null
  hasMore: boolean
  events: SyncPullEvent[]
  serverTime: string
}

export function buildSyncPushBatch(
  operations: SyncOperation[],
  protocolVersion: 1 | 2 = 1
): SyncPushBatch | null {
  if (operations.length === 0) return null
  const sorted = [...operations].sort(
    (left, right) => left.deviceSeq - right.deviceSeq
  )
  const first = sorted[0]
  const last = sorted.at(-1)
  if (!first || !last) return null
  const operationIds = new Set<string>()
  const deviceSequences = new Set<number>()
  for (const operation of sorted) {
    if (operation.deviceId !== first.deviceId) {
      throw new Error('A sync batch cannot contain operations from multiple devices')
    }
    if (!Number.isSafeInteger(operation.deviceSeq) || operation.deviceSeq < 1) {
      throw new Error('Sync device sequence must be a positive safe integer')
    }
    if (operationIds.has(operation.operationId)) {
      throw new Error('Sync operation ids must be unique within a batch')
    }
    if (deviceSequences.has(operation.deviceSeq)) {
      throw new Error('Sync device sequences must be unique within a batch')
    }
    operationIds.add(operation.operationId)
    deviceSequences.add(operation.deviceSeq)
  }
  return {
    protocolVersion,
    deviceId: first.deviceId,
    firstDeviceSeq: first.deviceSeq,
    lastDeviceSeq: last.deviceSeq,
    operations: sorted
  }
}
