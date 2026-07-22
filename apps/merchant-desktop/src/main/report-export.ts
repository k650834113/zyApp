import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { BusinessReport } from '@zyapp/contracts'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatFen(value: number): string {
  return (value / 100).toFixed(2)
}

function spreadsheetXml(report: BusinessReport, storeName: string): string {
  const cell = (value: string, type = 'String', style?: string): string =>
    `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`
  const metric = (name: string, value: number, kind: 'money' | 'count' = 'money') =>
    `<Row>${cell(name)}${cell(
      kind === 'money' ? formatFen(value) : String(value),
      'Number',
      kind === 'money' ? 'Money' : undefined
    )}</Row>`
  const itemTypeLabel = {
    admission: '入场费',
    product: '商品',
    service: '服务',
    activity: '活动'
  } as const
  const itemRows = report.items
    .map(
      (item) =>
        `<Row>${cell(item.itemName)}${cell(itemTypeLabel[item.itemType])}${cell(
          String(item.soldQuantity),
          'Number'
        )}${cell(String(item.refundedQuantity), 'Number')}${cell(
          String(item.netQuantity),
          'Number'
        )}${cell(formatFen(item.grossSalesFen), 'Number', 'Money')}${cell(
          formatFen(item.refundFen),
          'Number',
          'Money'
        )}${cell(formatFen(item.netSalesFen), 'Number', 'Money')}</Row>`
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E6EEE8" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Section"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#34443C" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Money"><NumberFormat ss:Format="0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="营业汇总">
  <Table>
   <Row><Cell ss:MergeAcross="1" ss:StyleID="Section"><Data ss:Type="String">营业报表</Data></Cell></Row>
   <Row>${cell('门店')}${cell(storeName)}</Row>
   <Row>${cell('统计区间')}${cell(`${report.fromDate} 至 ${report.toDate}`)}</Row>
   <Row>${cell('生成时间')}${cell(report.generatedAt)}</Row>
   <Row><Cell ss:MergeAcross="1" ss:StyleID="Section"><Data ss:Type="String">订单与支付</Data></Cell></Row>
   ${metric('订单数', report.order.orderCount, 'count')}
   ${metric('订单销售', report.order.grossSalesFen)}
   ${metric('订单退款', report.order.refundFen)}
   ${metric('订单净销售', report.order.netSalesFen)}
   ${metric('平均客单', report.order.averageOrderFen)}
   ${metric('入场人次', report.order.admissionQuantity, 'count')}
   ${metric('现金订单净额', report.payment.cashNetFen)}
   ${metric('储值订单净额', report.payment.storedValueNetFen)}
   <Row><Cell ss:MergeAcross="1" ss:StyleID="Section"><Data ss:Type="String">储值</Data></Cell></Row>
   ${metric('充值笔数', report.wallet.rechargeCount, 'count')}
   ${metric('充值本金', report.wallet.rechargePrincipalFen)}
   ${metric('充值赠送', report.wallet.rechargeGiftFen)}
   ${metric('充值退款本金', report.wallet.rechargeRefundPrincipalFen)}
   ${metric('退款收回赠送', report.wallet.reclaimedGiftFen)}
   ${metric('储值消费', report.wallet.consumptionDebitFen)}
   ${metric('订单退款退回储值', report.wallet.orderRefundCreditFen)}
   <Row><Cell ss:MergeAcross="1" ss:StyleID="Section"><Data ss:Type="String">月卡</Data></Cell></Row>
   ${metric('月卡销售张数', report.monthlyCard.soldCount, 'count')}
   ${metric('月卡销售金额', report.monthlyCard.grossSalesFen)}
   ${metric('月卡退款金额', report.monthlyCard.refundFen)}
   ${metric('月卡净销售', report.monthlyCard.netSalesFen)}
   ${metric('月卡使用次数', report.monthlyCard.usageCount, 'count')}
   ${metric('当前有效及暂停月卡', report.monthlyCard.activeCount, 'count')}
   <Row><Cell ss:MergeAcross="1" ss:StyleID="Section"><Data ss:Type="String">现金实际净流入</Data></Cell></Row>
   ${metric('订单现金净额 + 充值本金净额 + 月卡净额', report.actualCashInflowFen)}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="项目明细">
  <Table>
   <Row ss:StyleID="Header">${cell('项目')}${cell('类型')}${cell('售出数量')}${cell(
     '退款数量'
   )}${cell('净数量')}${cell('销售金额（元）')}${cell('退款金额（元）')}${cell(
     '净销售（元）'
   )}</Row>
   ${itemRows}
  </Table>
 </Worksheet>
</Workbook>`
}

export async function exportBusinessReportFile(input: {
  report: BusinessReport
  storeName: string
  destinationPath: string
}): Promise<{ fileName: string; fileSha256: string }> {
  await writeFile(
    input.destinationPath,
    `\uFEFF${spreadsheetXml(input.report, input.storeName)}`,
    'utf8'
  )
  const data = await readFile(input.destinationPath)
  return {
    fileName: basename(input.destinationPath),
    fileSha256: createHash('sha256').update(data).digest('hex')
  }
}
