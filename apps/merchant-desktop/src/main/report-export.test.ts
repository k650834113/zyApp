import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BusinessReport } from '@zyapp/contracts'
import { exportBusinessReportFile } from './report-export'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('business report Excel export', () => {
  it('writes an Excel-compatible workbook with summary and item sheets', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-report-export-'))
    temporaryDirectories.push(directory)
    const destinationPath = join(directory, '营业报表.xls')
    const report: BusinessReport = {
      fromDate: '2026-06-10',
      toDate: '2026-06-10',
      generatedAt: '2026-06-10T12:00:00.000Z',
      order: {
        orderCount: 1,
        grossSalesFen: 4000,
        refundCount: 0,
        refundFen: 0,
        netSalesFen: 4000,
        averageOrderFen: 4000,
        admissionQuantity: 1
      },
      payment: {
        cashSalesFen: 4000,
        cashRefundFen: 0,
        cashNetFen: 4000,
        storedValueSalesFen: 0,
        storedValueRefundFen: 0,
        storedValueNetFen: 0
      },
      wallet: {
        rechargeCount: 0,
        rechargePrincipalFen: 0,
        rechargeGiftFen: 0,
        rechargeRefundCount: 0,
        rechargeRefundPrincipalFen: 0,
        reclaimedGiftFen: 0,
        consumptionDebitFen: 0,
        orderRefundCreditFen: 0
      },
      monthlyCard: {
        soldCount: 0,
        grossSalesFen: 0,
        refundCount: 0,
        refundFen: 0,
        netSalesFen: 0,
        usageCount: 0,
        activeCount: 0
      },
      actualCashInflowFen: 4000,
      items: [
        {
          itemName: '入场费',
          itemType: 'admission',
          soldQuantity: 1,
          refundedQuantity: 0,
          netQuantity: 1,
          grossSalesFen: 4000,
          refundFen: 0,
          netSalesFen: 4000
        }
      ]
    }

    const result = await exportBusinessReportFile({
      report,
      storeName: '测试门店',
      destinationPath
    })
    const content = readFileSync(destinationPath, 'utf8')

    expect(result.fileName).toBe('营业报表.xls')
    expect(result.fileSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(content).toContain('<Worksheet ss:Name="营业汇总">')
    expect(content).toContain('<Worksheet ss:Name="项目明细">')
    expect(content).toContain('现金实际净流入')
    expect(content).toContain('入场费')
  })
})
