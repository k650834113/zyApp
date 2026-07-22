import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import type { RefundSummary } from '@zyapp/contracts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeXml(value: string): string {
  return escapeHtml(value)
}

function formatFen(value: number): string {
  return (value / 100).toFixed(2)
}

function paymentLabel(refund: RefundSummary): string {
  return refund.paymentMethod === 'cash' ? '现金退款' : '退回原会员储值账户'
}

function evidenceHtml(refund: RefundSummary, storeName: string): string {
  const rows = refund.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.itemName)}</td>
          <td>${escapeHtml(item.itemType)}</td>
          <td class="number">${formatFen(item.unitRefundFen)}</td>
          <td class="number">${item.quantity}</td>
          <td class="number">${formatFen(item.lineRefundFen)}</td>
        </tr>`
    )
    .join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 18mm; }
    body { color: #202622; font-family: "Microsoft YaHei UI", "Microsoft YaHei", sans-serif; font-size: 12px; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    .store { color: #647067; font-size: 13px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 24px 0; }
    .meta div { border-bottom: 1px solid #d9dedb; padding: 7px 0; }
    .meta span { color: #6c756f; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border: 1px solid #d9dedb; padding: 9px; text-align: left; }
    th { background: #f0f3f1; }
    .number { text-align: right; }
    .total { margin-top: 18px; text-align: right; font-size: 18px; font-weight: 700; }
    .reason { margin-top: 22px; border: 1px solid #d9dedb; padding: 12px; line-height: 1.6; }
    .foot { margin-top: 28px; color: #737d76; font-size: 10px; }
  </style>
</head>
<body>
  <h1>退款凭证</h1>
  <div class="store">${escapeHtml(storeName)}</div>
  <section class="meta">
    <div><span>退款单号：</span>${escapeHtml(refund.refundNumber)}</div>
    <div><span>原订单号：</span>${escapeHtml(refund.orderNumber)}</div>
    <div><span>退款渠道：</span>${paymentLabel(refund)}</div>
    <div><span>完成时间：</span>${escapeHtml(refund.completedAt ?? '')}</div>
    <div><span>申请时间：</span>${escapeHtml(refund.requestedAt)}</div>
    <div><span>特殊商品退款：</span>${refund.specialProductOverride ? '是' : '否'}</div>
  </section>
  <table>
    <thead><tr><th>项目</th><th>类型</th><th>单价（元）</th><th>数量</th><th>退款（元）</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">退款合计：¥${formatFen(refund.totalFen)}</div>
  <div class="reason"><strong>退款说明：</strong>${escapeHtml(
    refund.completionReason ?? refund.requestReason ?? '无'
  )}</div>
  <div class="foot">本凭证由桌游吧管理收银系统生成。原订单和原支付记录保持不变。</div>
</body>
</html>`
}

function spreadsheetXml(refund: RefundSummary, storeName: string): string {
  const cell = (value: string, type = 'String'): string =>
    `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`
  const rows = refund.items
    .map(
      (item) =>
        `<Row>${cell(item.itemName)}${cell(item.itemType)}${cell(
          formatFen(item.unitRefundFen),
          'Number'
        )}${cell(String(item.quantity), 'Number')}${cell(
          formatFen(item.lineRefundFen),
          'Number'
        )}</Row>`
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
  <Style ss:ID="Money"><NumberFormat ss:Format="0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="退款凭证">
  <Table>
   <Row>${cell('门店')}${cell(storeName)}</Row>
   <Row>${cell('退款单号')}${cell(refund.refundNumber)}</Row>
   <Row>${cell('原订单号')}${cell(refund.orderNumber)}</Row>
   <Row>${cell('退款渠道')}${cell(paymentLabel(refund))}</Row>
   <Row>${cell('完成时间')}${cell(refund.completedAt ?? '')}</Row>
   <Row>${cell('退款说明')}${cell(
     refund.completionReason ?? refund.requestReason ?? '无'
   )}</Row>
   <Row ss:StyleID="Header">${cell('项目')}${cell('类型')}${cell('单价（元）')}${cell(
     '数量'
   )}${cell('退款（元）')}</Row>
   ${rows}
   <Row>${cell('退款合计')}${cell('')}${cell('')}${cell('')}${cell(
     formatFen(refund.totalFen),
     'Number'
   )}</Row>
  </Table>
 </Worksheet>
</Workbook>`
}

async function renderPdf(
  refund: RefundSummary,
  storeName: string,
  destinationPath: string
): Promise<void> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  try {
    const html = evidenceHtml(refund, storeName)
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const data = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    await writeFile(destinationPath, data)
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
  }
}

export async function exportRefundEvidenceFile(input: {
  refund: RefundSummary
  storeName: string
  evidenceType: 'pdf' | 'excel'
  destinationPath: string
}): Promise<{ fileName: string; fileSha256: string }> {
  if (input.evidenceType === 'pdf') {
    await renderPdf(input.refund, input.storeName, input.destinationPath)
  } else {
    const xml = `\uFEFF${spreadsheetXml(input.refund, input.storeName)}`
    await writeFile(input.destinationPath, xml, 'utf8')
  }
  const data = await readFile(input.destinationPath)
  return {
    fileName: basename(input.destinationPath),
    fileSha256: createHash('sha256').update(data).digest('hex')
  }
}
