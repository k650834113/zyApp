import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openLocalDatabase, bootstrapStore, getStoreContext, findEmployeeRecordById, createAnnouncement,
  listAnnouncements, applySyncPushResult, cacheCloudMirrorPage, listInboundSyncConflicts, resolveInboundSyncConflict } from './index'

for (const choice of ['apply_cloud','keep_local'] as const) {
  it(`resolves ${choice} with a fresh review, retains audit and ignores old rejected receipts`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-review-'))
    const database = openLocalDatabase(join(directory,'test.db'))
    try {
      const setup = bootstrapStore(database.connection, {storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
      const context = getStoreContext(database.connection)!
      const actor = findEmployeeRecordById(database.connection, context.tenantId, setup.managerId)!
      const local = createAnnouncement(database.connection,{...context,actor},{title:'本机标题',content:'公告正文',pinned:false,visibleFrom:'2026-09-01T00:00:00.000Z'})
      const op = database.connection.prepare('SELECT operation_id FROM outbox_operation WHERE aggregate_id=?').get(local.id) as {operation_id:string}
      const receipt = { protocolVersion:1 as const, deviceId:context.deviceId, serverTime:new Date().toISOString(),
        receipts:[{operationId:op.operation_id,status:'conflict' as const,conflictType:'unknown' as const,serverPayloadJson:'{}'}] }
      applySyncPushResult(database.connection,context,receipt)
      const cloud = {id:local.id,title:'云端标题',content:'公告正文',status:'draft',pinned:false,visible_from:local.visibleFrom,
        visible_until:null,published_at:null,created_at:local.createdAt,updated_at:local.updatedAt,server_version:9}
      cacheCloudMirrorPage(database.connection,context,{resource:'announcements',rows:[{id:local.id,payload:cloud}],eventCursor:'9',nextCursor:null,serverTime:new Date().toISOString()})
      const review = listInboundSyncConflicts(database.connection,context).find(row=>row.direction==='outbound')!
      expect(review.localSnapshot?.title).toBe('本机标题')
      expect(review.cloudSnapshot?.title).toBe('云端标题')
      expect(() => resolveInboundSyncConflict(database.connection,{...context,actor},{sequence:review.sequence,resolution:choice,reason:'已核对',reviewToken:'stale'})).toThrow('资料已变化')
      resolveInboundSyncConflict(database.connection,{...context,actor},{sequence:review.sequence,resolution:choice,reason:'已核对',reviewToken:review.reviewToken!})
      expect(listInboundSyncConflicts(database.connection,context)).toHaveLength(0)
      applySyncPushResult(database.connection,context,receipt)
      expect(listInboundSyncConflicts(database.connection,context)).toHaveLength(0)
      if(choice==='apply_cloud') expect(listAnnouncements(database.connection,context)[0]?.title).toBe('云端标题')
      else {
        const pending=database.connection.prepare("SELECT payload_json,base_version FROM outbox_operation WHERE aggregate_id=? AND sync_status='pending'").get(local.id) as {payload_json:string;base_version:number}
        expect(JSON.parse(pending.payload_json).after.title).toBe('本机标题')
        expect(pending.base_version).toBe(9)
      }
      expect(database.connection.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='sync.conflict.resolved'").get()).toMatchObject({n:1})
    } finally { database.close(); rmSync(directory,{recursive:true,force:true}) }
  })
}
