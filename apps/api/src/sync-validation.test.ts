import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  validateSyncCommand,
  validateSyncPushBatch
} from './sync-validation'

function operation(deviceId: string, deviceSeq: number) {
  const payloadJson = JSON.stringify({ memberId: randomUUID() })
  return {
    operationId: randomUUID(),
    deviceId,
    deviceSeq,
    tenantId: randomUUID(),
    storeId: randomUUID(),
    actorId: null,
    operationType: 'member.created',
    aggregateId: randomUUID(),
    baseVersion: null,
    occurredAt: new Date().toISOString(),
    payloadJson,
    payloadHash: createHash('sha256').update(payloadJson).digest('hex')
  }
}

describe('sync batch validation', () => {
  it('accepts an ordered batch whose payload hashes match', () => {
    const deviceId = randomUUID()
    const operations = [operation(deviceId, 2), operation(deviceId, 5)]
    expect(
      validateSyncPushBatch({
        protocolVersion: 1,
        deviceId,
        firstDeviceSeq: 2,
        lastDeviceSeq: 5,
        operations
      })
    ).toMatchObject({ deviceId, firstDeviceSeq: 2, lastDeviceSeq: 5 })
  })

  it('rejects changed payloads, duplicate sequences, and wrong bounds', () => {
    const deviceId = randomUUID()
    const first = operation(deviceId, 1)
    expect(() =>
      validateSyncPushBatch({
        protocolVersion: 1,
        deviceId,
        firstDeviceSeq: 1,
        lastDeviceSeq: 1,
        operations: [{ ...first, payloadJson: '{"changed":true}' }]
      })
    ).toThrow('hash')
    expect(() =>
      validateSyncPushBatch({
        protocolVersion: 1,
        deviceId,
        firstDeviceSeq: 1,
        lastDeviceSeq: 1,
        operations: [first, { ...operation(deviceId, 2), deviceSeq: 1 }]
      })
    ).toThrow('duplicate device sequence')
    expect(() =>
      validateSyncPushBatch({
        protocolVersion: 1,
        deviceId,
        firstDeviceSeq: 99,
        lastDeviceSeq: 99,
        operations: [first]
      })
    ).toThrow('bounds')
  })

  it('accepts protocol v2 commands with unique changed fields', () => {
    const deviceId = randomUUID()
    const input = {
      ...operation(deviceId, 1),
      protocolVersion: 2 as const,
      changedFields: ['nickname', 'note']
    }
    expect(
      validateSyncCommand({ protocolVersion: 2, operation: input })
    ).toMatchObject({
      protocolVersion: 2,
      operation: { protocolVersion: 2, changedFields: ['nickname', 'note'] }
    })
    expect(() =>
      validateSyncCommand({
        protocolVersion: 2,
        operation: { ...input, changedFields: ['nickname', 'nickname'] }
      })
    ).toThrow('unique')
  })
})
