import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** Rebuild disposable lot/allocation indexes from immutable cloud ledger facts.
 * Must run inside cloud_preview: none of these derived writes are committed. */
export function prepareWalletAccountingPreview(db: DatabaseSync, tenantId: string, memberId?: string): void {
  const accounts = db.prepare(`SELECT * FROM wallet_account WHERE tenant_id=? AND (? IS NULL OR member_id=?)
    AND EXISTS (SELECT 1 FROM wallet_ledger ledger WHERE ledger.wallet_account_id=wallet_account.id AND ledger.request_id LIKE 'cloud:%')`)
    .all(tenantId,memberId??null,memberId??null)
  for (const account of accounts) {
    const ledgers=db.prepare('SELECT * FROM wallet_ledger WHERE wallet_account_id=? ORDER BY occurred_at, rowid').all(account.id!)
    type Lot={id:string;source:string;kind:string;p:number;g:number;op:number;og:number;at:string}
    type Allocation={ledger:string;lot:Lot;p:number;g:number;rp:number;rg:number;at:string}
    const lots:Lot[]=[]
    const allocations:Allocation[]=[]
    const refunds:Array<{ledger:string;original:string;payment:string;lot:Lot;p:number;g:number;at:string}>=[]
    const addLot=(source:string,kind:string,p:number,g:number,at:string)=>{
      // Several ledger facts can refer to the same business source. Keep one
      // derived lot per schema key, preserving every delta and allocation link.
      const existing=lots.find(lot=>lot.source===source && lot.kind===kind)
      if(existing) {
        existing.p+=p;existing.g+=g;existing.op+=p;existing.og+=g
        return existing
      }
      const lot={id:randomUUID(),source,kind,p,g,op:p,og:g,at};lots.push(lot);return lot
    }
    const consume=(p:number,g:number,at:string,ledger?:string,source?:string)=>{
      for (const lot of source?lots.filter(l=>l.source===source):lots) {
        const usedP=Math.min(lot.p,p), usedG=Math.min(lot.g,g)
        lot.p-=usedP;lot.g-=usedG;p-=usedP;g-=usedG
        if(ledger && usedP+usedG>0) allocations.push({ledger,lot,p:usedP,g:usedG,rp:0,rg:0,at})
      }
      // Historic opening balances may predate available cloud ledger history.
      if(p+g>0) {
        const lot=addLot(`cloud-history:${randomUUID()}`,'adjustment',p,g,at)
        lot.p=0;lot.g=0
        if(ledger) allocations.push({ledger,lot,p,g,rp:0,rg:0,at})
      }
    }
    for(const row of ledgers) {
      const p=Number(row.principal_delta_fen),g=Number(row.gift_delta_fen),at=String(row.occurred_at)
      const raw=JSON.parse(String(row.metadata_json))
      const metadata=raw.after?.metadata??raw
      if(row.entry_type==='consumption_debit') consume(-p,-g,at,String(row.id))
      else if(row.entry_type==='cash_recharge_reversal') consume(-p,-g,at,undefined,metadata.rechargeId)
      else if(row.entry_type==='order_refund_credit') {
        const original=ledgers.find(item=>metadata.originalDebitSourceId ? item.source_id===metadata.originalDebitSourceId : item.id===(metadata.originalDebitLedgerId??row.related_ledger_id))
        let remainingP=p,remainingG=g
        const payment=metadata.refundId ? db.prepare('SELECT id FROM refund_payment WHERE refund_id=?').get(metadata.refundId):null
        for(const allocation of allocations.filter(item=>item.ledger===original?.id)) {
          const restoreP=Math.min(remainingP,allocation.p-allocation.rp),restoreG=Math.min(remainingG,allocation.g-allocation.rg)
          allocation.rp+=restoreP;allocation.rg+=restoreG
          allocation.lot.p+=restoreP;allocation.lot.g+=restoreG
          remainingP-=restoreP;remainingG-=restoreG
          if(payment && restoreP+restoreG>0) refunds.push({ledger:String(row.id),original:String(original!.id),payment:String(payment.id),lot:allocation.lot,p:restoreP,g:restoreG,at})
        }
        if(remainingP+remainingG>0) addLot(String(row.source_id),'adjustment',remainingP,remainingG,at)
      } else if(p>=0 && g>=0) addLot(String(row.source_id),String(row.entry_type).includes('recharge')?'recharge':'adjustment',p,g,at)
      else consume(Math.max(0,-p),Math.max(0,-g),at)
    }
    const sumP=lots.reduce((sum,lot)=>sum+lot.p,0),sumG=lots.reduce((sum,lot)=>sum+lot.g,0)
    const targetP=Number(account.principal_balance_fen),targetG=Number(account.gift_balance_fen)
    consume(Math.max(0,sumP-targetP),Math.max(0,sumG-targetG),String(account.updated_at))
    if(targetP>sumP || targetG>sumG) addLot(`cloud-opening:${account.id}`,'adjustment',Math.max(0,targetP-sumP),Math.max(0,targetG-sumG),String(account.created_at))
    db.prepare('DELETE FROM wallet_refund_allocation WHERE lot_id IN (SELECT id FROM wallet_lot WHERE wallet_account_id=?)').run(account.id!)
    db.prepare('DELETE FROM wallet_ledger_allocation WHERE lot_id IN (SELECT id FROM wallet_lot WHERE wallet_account_id=?)').run(account.id!)
    db.prepare('DELETE FROM wallet_lot WHERE wallet_account_id=?').run(account.id!)
    for(const lot of lots) db.prepare(`INSERT INTO wallet_lot
      (id,tenant_id,store_id,wallet_account_id,member_id,source_type,source_id,original_principal_fen,original_gift_fen,remaining_principal_fen,remaining_gift_fen,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(lot.id,tenantId,account.store_id!,account.id!,account.member_id!,lot.kind,lot.source,lot.op,lot.og,lot.p,lot.g,lot.at,lot.at)
    for(const item of allocations) db.prepare('INSERT INTO wallet_ledger_allocation (id,tenant_id,ledger_id,lot_id,principal_fen,gift_fen,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(),tenantId,item.ledger,item.lot.id,item.p,item.g,item.at)
    for(const item of refunds) db.prepare(`INSERT INTO wallet_refund_allocation
      (id,tenant_id,refund_payment_id,refund_ledger_id,original_debit_ledger_id,lot_id,principal_fen,gift_fen,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(),tenantId,item.payment,item.ledger,item.original,item.lot.id,item.p,item.g,item.at)
  }
}
