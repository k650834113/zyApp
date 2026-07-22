import { useEffect, useState, type FormEvent } from 'react'
import type {
  CatalogItemSummary,
  CatalogItemType,
  CreateCatalogItemRequest,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Editor = {
  item: CatalogItemSummary | null
  name: string
  itemType: CatalogItemType
  regularYuan: string
  advancedYuan: string
  note: string
  reason: string
}

type ConfirmAction =
  | { type: 'status'; item: CatalogItemSummary }
  | { type: 'availability'; item: CatalogItemSummary }

const typeLabels: Record<CatalogItemType, string> = {
  admission: '入场费',
  product: '商品',
  service: '其他收费',
  activity: '活动'
}

function formatFen(value: number): string {
  return `¥${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function yuanToFen(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('价格格式不正确，最多保留两位小数')
  }
  const [yuanPart = '0', decimalPart = ''] = normalized.split('.')
  const fen = Number(yuanPart) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(fen) || fen < 0) throw new Error('价格不能小于 0')
  return fen
}

function emptyEditor(): Editor {
  return {
    item: null,
    name: '',
    itemType: 'product',
    regularYuan: '',
    advancedYuan: '',
    note: '',
    reason: ''
  }
}

function editorFor(item: CatalogItemSummary): Editor {
  return {
    item,
    name: item.name,
    itemType: item.itemType,
    regularYuan: String(item.regularPriceFen / 100),
    advancedYuan: String(item.advancedPriceFen / 100),
    note: item.note ?? '',
    reason: ''
  }
}

export function CatalogPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [items, setItems] = useState<CatalogItemSummary[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const canPrice = session.permissions.includes('catalog.pricing.manage')

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setItems(await getDesktopApi().listCatalogItems())
      setError(null)
    } catch (value) {
      setError(readableError(value))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function replaceItem(updated: CatalogItemSummary): void {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
  }

  async function submitEditor(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!editor || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const common: CreateCatalogItemRequest = {
        name: editor.name,
        itemType: editor.itemType,
        regularPriceFen: yuanToFen(editor.regularYuan),
        advancedPriceFen: yuanToFen(editor.advancedYuan),
        ...(editor.note.trim() ? { note: editor.note.trim() } : {})
      }
      if (editor.item) {
        const updated = await getDesktopApi().updateCatalogItem({
          itemId: editor.item.id,
          ...common,
          reason: editor.reason
        })
        replaceItem(updated)
        setNotice(`${updated.name} 已更新；已完成订单的价格快照不会改变`)
      } else {
        const created = await getDesktopApi().createCatalogItem(common)
        setItems((current) => [...current, created])
        setNotice(`${created.name} 已新增`)
      }
      setEditor(null)
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function submitConfirm(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!confirmAction || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated =
        confirmAction.type === 'status'
          ? await getDesktopApi().setCatalogItemStatus({
              itemId: confirmAction.item.id,
              status: confirmAction.item.status === 'active' ? 'disabled' : 'active',
              reason
            })
          : await getDesktopApi().setCatalogAvailability({
              itemId: confirmAction.item.id,
              availability:
                confirmAction.item.availability === 'available' ? 'sold_out' : 'available',
              reason
            })
      replaceItem(updated)
      setNotice(
        confirmAction.type === 'status'
          ? `${updated.name} 已${updated.status === 'active' ? '启用' : '停用'}`
          : `${updated.name} 已标记为${
              updated.availability === 'available' ? '在售' : '售罄'
            }`
      )
      setConfirmAction(null)
      setReason('')
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">普通价与高级会员价</p>
          <h1>收费目录</h1>
        </div>
        {canPrice ? (
          <button className="primary-button" type="button" onClick={() => setEditor(emptyEditor())}>
            新增项目
          </button>
        ) : (
          <div className="release-tag">店员可调整在售状态</div>
        )}
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="catalog-grid">
        {loading ? <div className="empty-row">正在读取收费目录...</div> : null}
        {!loading && items.length === 0 ? <div className="empty-row">暂无收费项目</div> : null}
        {items.map((item) => (
          <article className={`catalog-card ${item.status}`} key={item.id}>
            <div className="catalog-card-head">
              <span>{typeLabels[item.itemType]}</span>
              <div>
                <em className={`availability-dot ${item.availability}`}>
                  {item.availability === 'available' ? '在售' : '售罄'}
                </em>
                {item.status === 'disabled' ? <em className="disabled-label">已停用</em> : null}
              </div>
            </div>
            <h2>{item.name}</h2>
            <small>{item.code}</small>
            <div className="catalog-prices">
              <div><span>普通价</span><strong>{formatFen(item.regularPriceFen)}</strong></div>
              <div><span>高级会员价</span><strong>{formatFen(item.advancedPriceFen)}</strong></div>
            </div>
            {item.note ? <p>{item.note}</p> : null}
            <div className="catalog-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => setConfirmAction({ type: 'availability', item })}
              >
                标记{item.availability === 'available' ? '售罄' : '在售'}
              </button>
              {canPrice ? (
                <>
                  <button className="text-button" type="button" onClick={() => setEditor(editorFor(item))}>
                    编辑价格
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setConfirmAction({ type: 'status', item })}
                  >
                    {item.status === 'active' ? '停用' : '启用'}
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {editor ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card catalog-editor" onSubmit={(event) => void submitEditor(event)}>
            <div className="form-heading">
              <span>店长配置</span>
              <h2>{editor.item ? `编辑 ${editor.item.name}` : '新增收费项目'}</h2>
              <p>价格以元输入，保存时按整数分记账。</p>
            </div>
            <label>
              <span>项目名称</span>
              <input
                required
                maxLength={80}
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>项目类型</span>
              <select
                value={editor.itemType}
                onChange={(event) =>
                  setEditor({ ...editor, itemType: event.currentTarget.value as CatalogItemType })
                }
              >
                <option value="admission">入场费</option>
                <option value="product">商品</option>
                <option value="service">其他收费</option>
                <option value="activity">活动</option>
              </select>
            </label>
            <div className="field-grid two-columns">
              <label>
                <span>普通价（元）</span>
                <input
                  required
                  inputMode="decimal"
                  value={editor.regularYuan}
                  onChange={(event) =>
                    setEditor({ ...editor, regularYuan: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>高级会员价（元）</span>
                <input
                  required
                  inputMode="decimal"
                  value={editor.advancedYuan}
                  onChange={(event) =>
                    setEditor({ ...editor, advancedYuan: event.currentTarget.value })
                  }
                />
              </label>
            </div>
            <label>
              <span>备注（选填）</span>
              <textarea
                maxLength={500}
                value={editor.note}
                onChange={(event) => setEditor({ ...editor, note: event.currentTarget.value })}
              />
            </label>
            {editor.item ? (
              <label>
                <span>修改原因</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={200}
                  value={editor.reason}
                  onChange={(event) => setEditor({ ...editor, reason: event.currentTarget.value })}
                />
              </label>
            ) : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditor(null)}>
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={(event) => void submitConfirm(event)}>
            <div className="form-heading">
              <span>操作留痕</span>
              <h2>
                {confirmAction.type === 'status'
                  ? `${confirmAction.item.status === 'active' ? '停用' : '启用'} ${confirmAction.item.name}`
                  : `标记${confirmAction.item.availability === 'available' ? '售罄' : '在售'} ${confirmAction.item.name}`}
              </h2>
            </div>
            <label>
              <span>操作原因</span>
              <textarea
                required
                autoFocus
                minLength={2}
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setConfirmAction(null)}>
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">确认</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
