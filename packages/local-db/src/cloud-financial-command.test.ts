import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openLocalDatabase, bootstrapStore, getStoreContext, findEmployeeRecordById,
  createMember, cashRecharge, getWalletDetails, prepareCloudFinancialCommand, applySyncPushResult, readCloudFinancialConflict, resolveCloudFinancialConflict, listInboundSyncConflicts, applyCloudMirrorPage, createSalesOrder, directRefund, listRecentOrders, cacheCloudMirrorPage, queueFinancialReconciliation, purchaseMonthlyCard, useMonthlyCard, findEmployeeFinancialCommandExecution, readCloudFinancialCommandOutcome, readConfirmedFinancialResult } from './index'

it('durably queues a cloud command without changing the wallet, and reuses it after retry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-command-'))
  const database = openLocalDatabase(join(directory, 'test.db'))
  try {
    const setup = bootstrapStore(database.connection, { storeName:'Test', managerUsername:'manager', managerDisplayName:'Manager', managerPasswordHash:'test', deviceName:'PC' })
    const context = getStoreContext(database.connection)!
    const actor = findEmployeeRecordById(database.connection, context.tenantId, setup.managerId)!
    const member = createMember(database.connection, {...context,actor}, {phone:'13800138000',nickname:'Test',confirmedAtLeast14:true})
    const before = getWalletDetails(database.connection, context, member.id)
    const request = {requestId:'cloud-request-001',memberId:member.id,principalFen:10000,reason:'cash received'}
    const execute = () => cashRecharge(database.connection,{...context,actor},request)
    const result = prepareCloudFinancialCommand(database.connection,{...context,actor},'recharge',request,execute)
    expect(getWalletDetails(database.connection, context, member.id)).toEqual(before)
    expect(database.connection.prepare('SELECT COUNT(*) n FROM wallet_ledger').get()).toMatchObject({n:0})
    const pending = database.connection.prepare("SELECT payload_json FROM outbox_operation WHERE operation_type='wallet.cash_recharged'").all()
    expect(pending).toHaveLength(1)
    expect(JSON.parse(String(pending[0]!.payload_json)).atomicGroup.size).toBeGreaterThan(0)
    expect(prepareCloudFinancialCommand(database.connection,{...context,actor},'recharge',request,()=>{throw new Error('must not reexecute')})).toEqual(result)
    expect(()=>prepareCloudFinancialCommand(database.connection,{...context,actor},'recharge',{...request,principalFen:20000},execute)).toThrow('请求编号已使用')
    expect(database.connection.prepare('SELECT COUNT(*) n FROM cloud_financial_command').get()).toMatchObject({n:1})
  } finally { database.close(); rmSync(directory,{recursive:true,force:true}) }
})

for (const resolution of ['apply_cloud','keep_local'] as const) {
  it(`resolves a rejected command with ${resolution} without changing financial ledgers`, () => {
    const directory=mkdtempSync(join(tmpdir(),'zyapp-financial-review-'))
    const database=openLocalDatabase(join(directory,'test.db'))
    try {
      const setup=bootstrapStore(database.connection,{storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
      const context=getStoreContext(database.connection)!
      const actor=findEmployeeRecordById(database.connection,context.tenantId,setup.managerId)!
      const member=createMember(database.connection,{...context,actor},{phone:'13800138001',nickname:'Test',confirmedAtLeast14:true})
      const request={requestId:'review-command-01',memberId:member.id,principalFen:10000,reason:'cash'}
      prepareCloudFinancialCommand(database.connection,{...context,actor},'recharge',request,()=>cashRecharge(database.connection,{...context,actor},request))
      const rows=database.connection.prepare("SELECT operation_id FROM outbox_operation WHERE json_extract(payload_json,'$.atomicGroup.id') IS NOT NULL").all()
      applySyncPushResult(database.connection,context,{protocolVersion:1,deviceId:context.deviceId,serverTime:new Date().toISOString(),receipts:rows.map(row=>({operationId:String(row.operation_id),status:'conflict' as const,conflictType:'atomic_group_rejected' as const,serverPayloadJson:'{}'}))})
      const review=readCloudFinancialConflict(database.connection,context,String(rows[0]!.operation_id))!
      expect(review).not.toBeNull()
      expect(listInboundSyncConflicts(database.connection,context)).toHaveLength(1)
      const choice={sequence:`outbound:${rows[0]!.operation_id}`,resolution,reason:'已核对交易',reviewToken:review.reviewToken}
      expect(()=>resolveCloudFinancialConflict(database.connection,{...context,actor},{...choice,reviewToken:'stale'},()=>{})).toThrow('重新核对')
      resolveCloudFinancialConflict(database.connection,{...context,actor},choice,(channel,next)=>{
        prepareCloudFinancialCommand(database.connection,{...context,actor},channel,next,()=>cashRecharge(database.connection,{...context,actor},next as typeof request))
      })
      expect(database.connection.prepare('SELECT COUNT(*) n FROM wallet_ledger').get()).toMatchObject({n:0})
      expect(listInboundSyncConflicts(database.connection,context)).toHaveLength(0)
      expect(database.connection.prepare('SELECT COUNT(*) n FROM cloud_financial_command').get()).toMatchObject({n:resolution==='keep_local'?2:1})
      expect(()=>prepareCloudFinancialCommand(database.connection,{...context,actor},'recharge',request,()=>null)).toThrow('原业务已')
      expect(()=>resolveCloudFinancialConflict(database.connection,{...context,actor},choice,()=>{})).toThrow('重新核对')
    } finally {database.close();rmSync(directory,{recursive:true,force:true})}
  })
}

it('can refund a stored-value order after authoritative cloud mirrors restore its payment and allocation history',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zyapp-command-lifecycle-'))
  const database=openLocalDatabase(join(directory,'test.db'))
  try {
    const db=database.connection
    const setup=bootstrapStore(db,{storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
    const context=getStoreContext(db)!
    const actor=findEmployeeRecordById(db,context.tenantId,setup.managerId)!
    const member=createMember(db,{...context,actor},{phone:'13800138002',nickname:'Lifecycle',confirmedAtLeast14:true})
    db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
    let version=0
    const mirror=(resource: Parameters<typeof applyCloudMirrorPage>[2]['resource'], id:string, payload:Record<string,unknown>)=>{
      applyCloudMirrorPage(db,context,{resource,rows:[{id,payload}],eventCursor:String(++version),nextCursor:null,serverTime:new Date().toISOString()})
    }
    const confirm=()=>{
      const rows=db.prepare("SELECT * FROM outbox_operation WHERE sync_status='pending' ORDER BY device_seq").all()
      db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
      for(const row of rows) {
        const payload=JSON.parse(String(row.payload_json)), after=payload.after
        if(String(row.operation_type).startsWith('wallet.')) {
          const wallet=after.wallet
          mirror('wallet_accounts',wallet.accountId,{id:wallet.accountId,store_id:context.storeId,member_id:member.id,status:'active',principal_balance_fen:wallet.principalBalanceFen,gift_balance_fen:wallet.giftBalanceFen,created_at:wallet.updatedAt,updated_at:wallet.updatedAt})
          mirror('wallet_ledger',String(row.operation_id),{operation_id:row.operation_id,store_id:context.storeId,wallet_account_id:wallet.accountId,member_id:member.id,event_type:row.operation_type,source_operation_id:after.operationId,principal_delta_fen:after.principalDeltaFen,gift_delta_fen:after.giftDeltaFen,principal_balance_after_fen:wallet.principalBalanceFen,gift_balance_after_fen:wallet.giftBalanceFen,reason:'test',payload_json:payload,occurred_at:row.occurred_at})
        } else if(row.operation_type==='order.completed') {
          mirror('orders',String(row.aggregate_id),{id:row.aggregate_id,store_id:context.storeId,order_number:payload.orderNumber,visit_batch_id:payload.visitBatchId,customer_member_id:payload.customerMemberId,payment_method:payload.paymentMethod,wallet_member_id:payload.walletMemberId,total_fen:payload.totalFen,completed_at:payload.completedAt,payload_json:payload})
        }
      }
    }
    const recharge={requestId:'life-recharge-01',memberId:member.id,principalFen:10000,reason:'cash'}
    const predicted=prepareCloudFinancialCommand(db,{...context,actor},'recharge',recharge,()=>cashRecharge(db,{...context,actor},recharge)) as Record<string,unknown>
    expect(()=>readConfirmedFinancialResult(db,context,predicted)).toThrow('资金流水仍在刷新')
    confirm()
    expect(readConfirmedFinancialResult(db,context,{...predicted,principalDeltaFen:1,wallet:{...(predicted.wallet as object),totalBalanceFen:1}}))
      .toMatchObject({principalDeltaFen:10000,wallet:{totalBalanceFen:10000}})
    const sale={requestId:'life-sale-01',paymentMethod:'stored_value' as const,walletMemberId:member.id,lines:[{customName:'服务',customUnitPriceFen:1000,quantity:1,pricingTier:'regular' as const}]}
    prepareCloudFinancialCommand(db,{...context,actor},'sale',sale,()=>createSalesOrder(db,{...context,actor},sale))
    expect(listRecentOrders(db,context,10)).toHaveLength(0)
    confirm()
    const order=listRecentOrders(db,context,10)[0]!
    expect(order.items).toHaveLength(1)
    const before=getWalletDetails(db,context,member.id)
    const refund={requestId:'life-refund-01',orderId:order.id,items:[{orderItemId:order.items[0]!.id,quantity:1}],reason:'退款核对'}
    expect(()=>prepareCloudFinancialCommand(db,{...context,actor},'refund',refund,()=>directRefund(db,{...context,actor},refund))).not.toThrow()
    expect(getWalletDetails(db,context,member.id)).toEqual(before)
  } finally {database.close();rmSync(directory,{recursive:true,force:true})}
})

for (const resolution of ['apply_cloud','keep_local'] as const) {
  it(`reconciles a legacy wallet conflict with ${resolution} through an append-only correction`,()=>{
    const directory=mkdtempSync(join(tmpdir(),'zyapp-legacy-review-'))
    const database=openLocalDatabase(join(directory,'test.db'))
    try {
      const db=database.connection
      const setup=bootstrapStore(db,{storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
      const context=getStoreContext(db)!
      const actor=findEmployeeRecordById(db,context.tenantId,setup.managerId)!
      const member=createMember(db,{...context,actor},{phone:'13800138003',nickname:'Legacy',confirmedAtLeast14:true})
      db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
      cashRecharge(db,{...context,actor},{requestId:'legacy-recharge',memberId:member.id,principalFen:10000,reason:'cash'})
      const source=db.prepare("SELECT * FROM outbox_operation WHERE operation_type='wallet.cash_recharged'").get()!
      const receipt={protocolVersion:1 as const,deviceId:context.deviceId,serverTime:new Date().toISOString(),receipts:[{operationId:String(source.operation_id),status:'conflict' as const,conflictType:'unknown' as const,serverPayloadJson:'{}'}]}
      applySyncPushResult(db,context,receipt)
      const original=db.prepare('SELECT * FROM wallet_ledger').get()!
      const cloud={id:String(source.aggregate_id),store_id:context.storeId,member_id:member.id,status:'active',principal_balance_fen:5000,gift_balance_fen:0,server_version:9,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
      cacheCloudMirrorPage(db,context,{resource:'wallet_accounts',rows:[{id:cloud.id,payload:cloud}],eventCursor:'9',nextCursor:null,serverTime:new Date().toISOString()})
      const review=listInboundSyncConflicts(db,context)[0]!
      expect(review.resolutionMode).toBe('financial_balance')
      const choice={sequence:review.sequence,resolution,reason:'已核对原始凭证',reviewToken:review.reviewToken!}
      expect(()=>queueFinancialReconciliation(db,{...context,actor},{...choice,reviewToken:'stale'})).toThrow('重新核对')
      queueFinancialReconciliation(db,{...context,actor},choice)
      expect(db.prepare('SELECT * FROM wallet_ledger WHERE id=?').get(original.id!)).toEqual(original)
      expect(db.prepare("SELECT principal_delta_fen FROM wallet_ledger WHERE entry_type='manual_adjustment'").get()).toMatchObject({principal_delta_fen:-10000})
      const correction=db.prepare("SELECT payload_json FROM outbox_operation WHERE operation_type='wallet.reconciled'").get()!
      const payload=JSON.parse(String(correction.payload_json))
      expect(payload.after.principalDeltaFen).toBe(resolution==='keep_local'?5000:0)
      expect(payload.rejectedOperationId).toBe(source.operation_id)
      expect(payload.atomicGroup.size).toBe(1)
      applySyncPushResult(db,context,receipt)
      expect(listInboundSyncConflicts(db,context)).toHaveLength(0)
      expect(()=>queueFinancialReconciliation(db,{...context,actor},choice)).toThrow('已处理')
    } finally {database.close();rmSync(directory,{recursive:true,force:true})}
  })
}

it('keeps immutable purchase data when reconciling a legacy monthly-card usage difference',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zyapp-card-review-'))
  const database=openLocalDatabase(join(directory,'test.db'))
  try {
    const db=database.connection
    const setup=bootstrapStore(db,{storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
    const context=getStoreContext(db)!
    const actor=findEmployeeRecordById(db,context.tenantId,setup.managerId)!
    const member=createMember(db,{...context,actor},{phone:'13800138004',nickname:'Card',confirmedAtLeast14:true})
    const card=purchaseMonthlyCard(db,{...context,actor},{requestId:'legacy-purchase',memberId:member.id,reason:'现金购买'})
    db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
    useMonthlyCard(db,{...context,actor},{requestId:'legacy-use',cardId:card.id,reason:'入场'})
    const source=db.prepare("SELECT * FROM outbox_operation WHERE operation_type='monthly_card.used'").get()!
    applySyncPushResult(db,context,{protocolVersion:1,deviceId:context.deviceId,serverTime:new Date().toISOString(),receipts:[{operationId:String(source.operation_id),status:'conflict',conflictType:'unknown',serverPayloadJson:'{}'}]})
    const cloud={id:card.id,store_id:context.storeId,member_id:member.id,plan_name:card.planName,price_fen:card.priceFen,payment_method:card.paymentMethod,status:card.status,purchased_at:card.purchasedAt,starts_at:card.startsAt,expires_at:card.expiresAt,paused_at:null,usage_count:2,scope_type:'store',server_version:9,updated_at:card.purchasedAt}
    cacheCloudMirrorPage(db,context,{resource:'monthly_cards',rows:[{id:card.id,payload:cloud}],eventCursor:'9',nextCursor:null,serverTime:new Date().toISOString()})
    const review=listInboundSyncConflicts(db,context)[0]!
    expect(review.resolutionMode).toBe('financial_balance')
    queueFinancialReconciliation(db,{...context,actor},{sequence:review.sequence,resolution:'keep_local',reason:'核对月卡次数',reviewToken:review.reviewToken!})
    const correction=db.prepare("SELECT payload_json FROM outbox_operation WHERE operation_type='monthly_card.reconciled'").get()!
    const after=JSON.parse(String(correction.payload_json)).after
    expect(after.usageCount).toBe(1)
    expect(after.priceFen).toBe(card.priceFen)
    expect(after.issuingStoreId).toBe(context.storeId)
    expect(db.prepare('SELECT COUNT(*) n FROM monthly_card_event').get()).toMatchObject({n:2})
  } finally {database.close();rmSync(directory,{recursive:true,force:true})}
})

it('keeps a mobile recharge pending until the cloud confirms, and survives an ambiguous retry without local credit',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zyapp-phone-command-'))
  const database=openLocalDatabase(join(directory,'test.db'))
  try {
    const db=database.connection
    const setup=bootstrapStore(db,{storeName:'Test',managerUsername:'manager',managerDisplayName:'Manager',managerPasswordHash:'test',deviceName:'PC'})
    const context=getStoreContext(db)!
    const actor=findEmployeeRecordById(db,context.tenantId,setup.managerId)!
    const member=createMember(db,{...context,actor},{phone:'13800138005',nickname:'Phone',confirmedAtLeast14:true})
    db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
    const request={requestId:'phone-command-001',memberId:member.id,principalFen:10000,reason:'现金充值',sourceFinancialCommand:{commandId:'phone-command-001',requestedByEmployeeId:actor.id}}
    const result=prepareCloudFinancialCommand(db,{...context,actor},'mobile_financial',request,()=>{
      cashRecharge(db,{...context,actor},request)
      return findEmployeeFinancialCommandExecution(db,context,request.requestId)
    })
    expect(result).toMatchObject({status:'completed',commandId:request.requestId})
    expect(findEmployeeFinancialCommandExecution(db,context,request.requestId)).toBeNull()
    expect(getWalletDetails(db,context,member.id).wallet.totalBalanceFen).toBe(0)
    const journal=db.prepare('SELECT * FROM cloud_financial_command').get()!
    expect(readCloudFinancialCommandOutcome(db,context.deviceId,String(journal.group_id))).toBe('pending')
    expect(prepareCloudFinancialCommand(db,{...context,actor},'mobile_financial',request,()=>{throw new Error('duplicate')})).toEqual(result)
    const rows=db.prepare("SELECT operation_id FROM outbox_operation WHERE sync_status='pending'").all()
    applySyncPushResult(db,context,{protocolVersion:1,deviceId:context.deviceId,serverTime:new Date().toISOString(),receipts:rows.map(row=>({operationId:String(row.operation_id),status:'confirmed' as const,serverVersion:1}))})
    expect(readCloudFinancialCommandOutcome(db,context.deviceId,String(journal.group_id))).toBe('confirmed')
    expect(db.prepare('SELECT COUNT(*) n FROM wallet_ledger').get()).toMatchObject({n:0})
  } finally {database.close();rmSync(directory,{recursive:true,force:true})}
})
