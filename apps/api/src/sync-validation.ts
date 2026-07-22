import { createHash } from 'node:crypto'
import type {
  SyncCommandRequest,
  SyncOperation,
  SyncPushBatch
} from '@zyapp/sync-protocol'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_PATTERN = /^[0-9a-f]{64}$/i

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
  options: { min: number; max: number }
): string {
  if (typeof value !== 'string') throw new Error(`${name} must be text`)
  if (value.length < options.min || value.length > options.max) {
    throw new Error(
      `${name} must contain ${options.min} to ${options.max} characters`
    )
  }
  return value
}

function uuid(value: unknown, name: string): string {
  const result = text(value, name, { min: 36, max: 36 }).toLowerCase()
  if (!UUID_PATTERN.test(result)) throw new Error(`${name} must be a UUID`)
  return result
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return Number(value)
}

function nullableInteger(value: unknown, name: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return Number(value)
}

function timestamp(value: unknown, name: string): string {
  const result = text(value, name, { min: 20, max: 40 })
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`${name} must be an ISO timestamp`)
  }
  return result
}

function operation(value: unknown, index: number): SyncOperation {
  const input = record(value, `operations[${index}]`)
  const payloadJson = text(input.payloadJson, 'payloadJson', {
    min: 2,
    max: 2_000_000
  })
  try {
    JSON.parse(payloadJson)
  } catch {
    throw new Error(`operations[${index}].payloadJson must contain JSON`)
  }
  const payloadHash = text(input.payloadHash, 'payloadHash', {
    min: 64,
    max: 64
  }).toLowerCase()
  if (!HASH_PATTERN.test(payloadHash)) {
    throw new Error(`operations[${index}].payloadHash must be SHA-256`)
  }
  const actualHash = createHash('sha256').update(payloadJson).digest('hex')
  if (actualHash !== payloadHash) {
    throw new Error(`operations[${index}] payload hash does not match`)
  }
  let changedFields: string[] | undefined
  if (input.changedFields !== undefined) {
    if (!Array.isArray(input.changedFields) || input.changedFields.length > 100) {
      throw new Error(`operations[${index}].changedFields must be an array`)
    }
    changedFields = input.changedFields.map((field, fieldIndex) =>
      text(field, `changedFields[${fieldIndex}]`, { min: 1, max: 120 })
    )
    if (new Set(changedFields).size !== changedFields.length) {
      throw new Error(`operations[${index}].changedFields must be unique`)
    }
  }
  const protocolVersion =
    input.protocolVersion === undefined ? undefined : input.protocolVersion
  if (
    protocolVersion !== undefined &&
    protocolVersion !== 1 &&
    protocolVersion !== 2
  ) {
    throw new Error(`operations[${index}].protocolVersion is unsupported`)
  }
  return {
    operationId: uuid(input.operationId, 'operationId'),
    deviceId: uuid(input.deviceId, 'deviceId'),
    deviceSeq: positiveInteger(input.deviceSeq, 'deviceSeq'),
    tenantId: uuid(input.tenantId, 'tenantId'),
    storeId: uuid(input.storeId, 'storeId'),
    actorId:
      input.actorId === null ? null : uuid(input.actorId, 'actorId'),
    operationType: text(input.operationType, 'operationType', {
      min: 3,
      max: 120
    }),
    aggregateId: text(input.aggregateId, 'aggregateId', {
      min: 1,
      max: 120
    }),
    baseVersion: nullableInteger(input.baseVersion, 'baseVersion'),
    occurredAt: timestamp(input.occurredAt, 'occurredAt'),
    payloadJson,
    payloadHash,
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    ...(changedFields === undefined ? {} : { changedFields })
  }
}

export function validateSyncPushBatch(value: unknown): SyncPushBatch {
  const input = record(value, 'sync batch')
  if (input.protocolVersion !== 1 && input.protocolVersion !== 2) {
    throw new Error('Unsupported sync protocol version')
  }
  if (!Array.isArray(input.operations)) {
    throw new Error('operations must be an array')
  }
  if (input.operations.length < 1 || input.operations.length > 500) {
    throw new Error('operations must contain 1 to 500 items')
  }
  const operations = input.operations.map(operation)
  const deviceId = uuid(input.deviceId, 'deviceId')
  const firstDeviceSeq = positiveInteger(
    input.firstDeviceSeq,
    'firstDeviceSeq'
  )
  const lastDeviceSeq = positiveInteger(input.lastDeviceSeq, 'lastDeviceSeq')
  const operationIds = new Set<string>()
  const sequences = new Set<number>()
  let previousSequence = 0
  for (const item of operations) {
    if (item.deviceId !== deviceId) {
      throw new Error('Batch contains an operation from another device')
    }
    if (operationIds.has(item.operationId)) {
      throw new Error('Batch contains a duplicate operation id')
    }
    if (sequences.has(item.deviceSeq)) {
      throw new Error('Batch contains a duplicate device sequence')
    }
    if (item.deviceSeq <= previousSequence) {
      throw new Error('Batch operations must be ordered by device sequence')
    }
    operationIds.add(item.operationId)
    sequences.add(item.deviceSeq)
    previousSequence = item.deviceSeq
  }
  if (
    operations[0]?.deviceSeq !== firstDeviceSeq ||
    operations.at(-1)?.deviceSeq !== lastDeviceSeq
  ) {
    throw new Error('Batch sequence bounds do not match its operations')
  }
  return {
    protocolVersion: input.protocolVersion,
    deviceId,
    firstDeviceSeq,
    lastDeviceSeq,
    operations
  }
}

export function validateSyncCommand(value: unknown): SyncCommandRequest {
  const input = record(value, 'sync command')
  if (input.protocolVersion !== 2) {
    throw new Error('Sync commands require protocol version 2')
  }
  const parsed = operation(input.operation, 0)
  return {
    protocolVersion: 2,
    operation: {
      ...parsed,
      protocolVersion: 2
    }
  }
}
