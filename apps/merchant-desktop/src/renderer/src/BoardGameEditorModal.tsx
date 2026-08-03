import { useEffect, useState, type FormEvent } from 'react'
import type {
  BoardGameMetadataAvailability,
  BoardGameMetadataCandidate
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import {
  applyMetadataDetails,
  parseBggLookupInput,
  type BoardGameEditor
} from './board-game-editor'

type Props = {
  editor: BoardGameEditor
  busy: boolean
  onChange: (editor: BoardGameEditor) => void
  onCancel: () => void
  onImportImage: () => void
  onSubmit: (event: FormEvent) => void
}

const numberFields: Array<{
  label: string
  key: 'minPlayers' | 'maxPlayers' | 'minMinutes' | 'maxMinutes'
}> = [
  { label: '最少人数', key: 'minPlayers' },
  { label: '最多人数', key: 'maxPlayers' },
  { label: '最短分钟', key: 'minMinutes' },
  { label: '最长分钟', key: 'maxMinutes' }
]

const flags: Array<{
  key: 'available' | 'customerConsigned' | 'missingPieces' | 'private' | 'recommended'
  label: string
}> = [
  { key: 'available', label: '可用' },
  { key: 'private', label: '不公开' },
  { key: 'recommended', label: '推荐' },
  { key: 'customerConsigned', label: '顾客寄存' },
  { key: 'missingPieces', label: '缺件' }
]

function chineseAlternate(candidate: BoardGameMetadataCandidate): string {
  return candidate.alternateNames.find((name) =>
    /[\u3400-\u9fff\uf900-\ufaff]/.test(name)
  ) ?? '—'
}

export function BoardGameEditorModal({
  editor,
  busy,
  onChange,
  onCancel,
  onImportImage,
  onSubmit
}: Props): React.JSX.Element {
  const [lookup, setLookup] = useState('')
  const [metadataStatus, setMetadataStatus] =
    useState<BoardGameMetadataAvailability | null>(null)
  const [candidates, setCandidates] = useState<BoardGameMetadataCandidate[]>([])
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getDesktopApi().getBoardGameMetadataStatus()
      .then((status) => {
        if (!active) return
        setMetadataStatus(status)
        if (!status.enabled) {
          setMetadataMessage('BGG 快速录入暂未启用，可继续手工填写。')
        }
      })
      .catch((error: unknown) => {
        if (active) setMetadataMessage(`${readableError(error)}；可继续手工填写。`)
      })
    return () => { active = false }
  }, [])

  async function loadDetails(externalId: string): Promise<void> {
    setMetadataBusy(true)
    setMetadataMessage(null)
    try {
      const details = await getDesktopApi().getBoardGameMetadataDetails({
        source: 'bgg', externalId
      })
      onChange(
        applyMetadataDetails(editor, details, metadataStatus?.imagesEnabled === true)
      )
      setCandidates([])
      setMetadataMessage('已带入 BGG 结构化资料，请核对中文名称和中文简介后保存。')
    } catch (error) {
      setMetadataMessage(readableError(error))
    } finally {
      setMetadataBusy(false)
    }
  }

  async function searchMetadata(): Promise<void> {
    setMetadataBusy(true)
    setMetadataMessage(null)
    try {
      const parsed = parseBggLookupInput(lookup)
      if (parsed.kind === 'id') {
        setMetadataBusy(false)
        await loadDetails(parsed.externalId)
        return
      }
      const result = await getDesktopApi().searchBoardGameMetadata({
        query: parsed.query
      })
      setCandidates(result)
      if (result.length === 0) setMetadataMessage('未找到匹配的 BGG 桌游。')
    } catch (error) {
      setMetadataMessage(readableError(error))
    } finally {
      setMetadataBusy(false)
    }
  }

  const imported = editor.metadataSource === 'bgg'

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card content-editor game-editor"
        onSubmit={onSubmit}
      >
        <div className="form-heading">
          <span>桌游资料</span>
          <h2>{editor.current ? `编辑 ${editor.current.name}` : '快速新增桌游'}</h2>
        </div>
        <div className="activity-editor-scroll game-editor-sections">
          <section>
            <h3>BGG 快速查找</h3>
            <div className="metadata-search">
              <input
                aria-label="BGG 桌游名称、ID 或链接"
                placeholder="输入桌游名称、BGG ID 或详情链接"
                value={lookup}
                onChange={(event) => setLookup(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void searchMetadata()
                  }
                }}
              />
              <button
                className="secondary-button"
                disabled={busy || metadataBusy || metadataStatus?.enabled !== true}
                type="button"
                onClick={() => void searchMetadata()}
              >
                {metadataBusy ? '查询中…' : '搜索 BGG'}
              </button>
            </div>
            {metadataMessage ? <p className="metadata-source-note">{metadataMessage}</p> : null}
            {candidates.length > 0 ? (
              <div className="metadata-results">
                {candidates.map((candidate) => (
                  <button
                    className="metadata-result"
                    key={`${candidate.source}-${candidate.externalId}`}
                    type="button"
                    onClick={() => void loadDetails(candidate.externalId)}
                  >
                    <strong>{candidate.primaryName}</strong>
                    <span>{chineseAlternate(candidate)}</span>
                    <span>{candidate.yearPublished ?? '年份未知'}</span>
                    <span>BGG #{candidate.externalId}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <h3>公开资料</h3>
            {imported ? (
              <p className="metadata-source-note">来自 BGG，保存前请核对结构化字段；中文简介需由店方填写。</p>
            ) : null}
            <label>
              <span>中文名称</span>
              <input required maxLength={120} value={editor.name}
                onChange={(event) => onChange({ ...editor, name: event.currentTarget.value })} />
            </label>
            <label>
              <span>中文简介</span>
              <textarea required minLength={2} maxLength={5000}
                value={editor.introduction}
                onChange={(event) => onChange({ ...editor, introduction: event.currentTarget.value })} />
            </label>
            <label>
              <span>中文分类（逗号、顿号或换行分隔）</span>
              <input required value={editor.categories}
                onChange={(event) => onChange({ ...editor, categories: event.currentTarget.value })} />
            </label>
            <div className="field-grid four-columns">
              {numberFields.map(({ label, key }) => (
                <label key={key}>
                  <span>{label}</span>
                  <input inputMode="numeric" value={editor[key]}
                    onChange={(event) => onChange({ ...editor, [key]: event.currentTarget.value })} />
                </label>
              ))}
            </div>
            <div className="field-grid three-columns">
              <label>
                <span>复杂度（0.0–5.0）</span>
                <input min="0" max="5" step="0.1" type="number"
                  value={editor.complexityRating}
                  onChange={(event) => onChange({ ...editor, complexityRating: event.currentTarget.value })} />
              </label>
              <label>
                <span>BGG 编号</span>
                <input inputMode="numeric" value={editor.bggId}
                  onChange={(event) => onChange({
                    ...editor,
                    bggId: event.currentTarget.value,
                    metadataSource: '',
                    metadataImportedAt: ''
                  })} />
              </label>
              <label>
                <span>网络图片 URL（选填）</span>
                <input value={editor.imageUrl}
                  onChange={(event) => onChange({ ...editor, imageUrl: event.currentTarget.value })} />
              </label>
            </div>
            <div className="image-import-field">
              <span>本地图片</span>
              <button className="secondary-button" disabled={busy} type="button" onClick={onImportImage}>
                选择并导入图片
              </button>
            </div>
            {editor.imagePreview || editor.imageUrl ? (
              <img alt="封面预览" className="board-game-image-preview"
                src={editor.imagePreview || editor.imageUrl} />
            ) : null}
          </section>

          <section>
            <h3>本店配置</h3>
            <label>
              <span>库存数量</span>
              <input inputMode="numeric" value={editor.quantity}
                onChange={(event) => onChange({ ...editor, quantity: event.currentTarget.value })} />
            </label>
            <div className="content-checkbox-grid">
              {flags.map(({ key, label }) => (
                <label className="checkbox-field" key={key}>
                  <input checked={editor[key]} type="checkbox"
                    onChange={(event) => onChange({ ...editor, [key]: event.currentTarget.checked })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="field-grid two-columns">
              <label>
                <span>寄存人昵称</span>
                <input value={editor.consignorNickname}
                  onChange={(event) => onChange({ ...editor, consignorNickname: event.currentTarget.value })} />
              </label>
              <label>
                <span>缺件（每行 名称:数量）</span>
                <textarea value={editor.missingParts}
                  onChange={(event) => onChange({ ...editor, missingParts: event.currentTarget.value })} />
              </label>
            </div>
            <div className="field-grid two-columns">
              <label>
                <span>顾客可见备注</span>
                <textarea value={editor.customerNote}
                  onChange={(event) => onChange({ ...editor, customerNote: event.currentTarget.value })} />
              </label>
              <label>
                <span>内部备注</span>
                <textarea value={editor.internalNote}
                  onChange={(event) => onChange({ ...editor, internalNote: event.currentTarget.value })} />
              </label>
            </div>
            {editor.current ? (
              <label>
                <span>修改原因</span>
                <textarea required minLength={2} maxLength={200} value={editor.reason}
                  onChange={(event) => onChange({ ...editor, reason: event.currentTarget.value })} />
              </label>
            ) : null}
          </section>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>取消</button>
          <button className="primary-button" disabled={busy} type="submit">保存</button>
        </div>
      </form>
    </div>
  )
}
