import type { PoolClient } from 'pg'
import type { ReceivedOperation } from './sync-operation-handler'

type Mobile = { kind: 'mobile_cashier' | 'mobile_financial'; commandId:string; localOrderId?:string; result:Record<string,unknown> }
export async function lockMobileFinancialCommand(client:PoolClient, operation:ReceivedOperation):Promise<Mobile|null> {
  const mobile=operation.payload_json.mobileCommand as Mobile|undefined
  if(!mobile) return null
  if(!['mobile_cashier','mobile_financial'].includes(mobile.kind) || !/^[0-9a-f-]{36}$/i.test(mobile.commandId)) {
    throw Object.assign(new Error('移动端业务编号无效'),{code:'22023'})
  }
  const table=mobile.kind==='mobile_cashier'?'cashier_command':'employee_financial_command'
  const selected=await client.query<{status:string;claimed_by_device:string;requested_by:string;command_type?:string}>(
    `SELECT * FROM ${table} WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
    [mobile.commandId,operation.tenant_id,operation.store_id])
  const row=selected.rows[0]
  // Hold this row lock until both financial writes and completion commit. A
  // different till cannot reclaim a timed-out phone command and execute it twice.
  if(!row || row.status!=='claimed' || row.claimed_by_device!==operation.device_id || row.requested_by!==operation.actor_id ||
    (mobile.kind==='mobile_financial' && row.command_type!==mobile.result?.type)) {
    throw Object.assign(new Error('移动端业务已处理或领取设备已变化，请先核对原业务'),{code:'22023',mobileClaimChanged:true})
  }
  return mobile
}

export async function completeMobileFinancialGroup(client:PoolClient, operation:ReceivedOperation, mobile:Mobile):Promise<void> {
  const result=structuredClone(mobile.result)
  if(mobile.kind==='mobile_financial' && result.type==='cash_recharge') {
    const preview=result.wallet as Record<string,unknown>
    const actual=await client.query<Record<string,unknown>>(`SELECT ledger.principal_delta_fen,ledger.gift_delta_fen,account.*
      FROM cloud_wallet_ledger ledger JOIN cloud_wallet_account account ON account.id=ledger.wallet_account_id
      WHERE ledger.tenant_id=$1 AND ledger.source_operation_id=$2`,[operation.tenant_id,preview.operationId])
    const row=actual.rows[0]
    if(!row) throw new Error('Confirmed mobile recharge is missing its cloud ledger')
    result.wallet={...preview,principalDeltaFen:Number(row.principal_delta_fen),giftDeltaFen:Number(row.gift_delta_fen),
      wallet:{accountId:row.id,memberId:row.member_id,principalBalanceFen:Number(row.principal_balance_fen),giftBalanceFen:Number(row.gift_balance_fen),
        totalBalanceFen:Number(row.principal_balance_fen)+Number(row.gift_balance_fen),status:row.status,updatedAt:row.updated_at}}
  } else if(mobile.kind==='mobile_financial' && result.monthlyCard) {
    const card=result.monthlyCard as Record<string,unknown>
    const actual=await client.query<Record<string,unknown>>('SELECT * FROM cloud_monthly_card WHERE id=$1 AND tenant_id=$2',[card.id,operation.tenant_id])
    const row=actual.rows[0]
    if(!row) throw new Error('Confirmed mobile card is missing its cloud record')
    result.monthlyCard={...card,status:row.status,usageCount:Number(row.usage_count),expiresAt:row.expires_at,pausedAt:row.paused_at}
  }
  if(mobile.kind==='mobile_cashier') {
    await client.query(`UPDATE cashier_command SET status='completed',local_order_id=$2,result_json=$3::jsonb,error_message=NULL,
      completed_at=CURRENT_TIMESTAMP,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[mobile.commandId,mobile.localOrderId,JSON.stringify(result)])
  } else {
    await client.query(`UPDATE employee_financial_command SET status='completed',result_json=$2::jsonb,error_message=NULL,
      completed_at=CURRENT_TIMESTAMP,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[mobile.commandId,JSON.stringify(result)])
  }
}

export async function failMobileFinancialGroup(client:PoolClient, operation:ReceivedOperation):Promise<void> {
  const mobile=operation.payload_json.mobileCommand as Mobile|undefined
  if(!mobile || !['mobile_cashier','mobile_financial'].includes(mobile.kind) || !/^[0-9a-f-]{36}$/i.test(mobile.commandId)) return
  const table=mobile.kind==='mobile_cashier'?'cashier_command':'employee_financial_command'
  await client.query(`UPDATE ${table} SET status='failed',result_json=NULL,error_message=$5,
    completed_at=CURRENT_TIMESTAMP,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND claimed_by_device=$4 AND status='claimed'`,
    [mobile.commandId,operation.tenant_id,operation.store_id,operation.device_id,'云端未执行本笔业务，请由店长在 PC 端核对差异后处理'])
}
