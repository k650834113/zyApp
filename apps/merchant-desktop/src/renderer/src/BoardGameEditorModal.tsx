import { useEffect, useState, type FormEvent } from 'react'
import type {
  BoardGameCoverSource,
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
  coverCacheError: string | null
  onChange: (editor: BoardGameEditor) => void
  onCancel: () => void
  onImportImage: () => void
  onRetryCoverCache: () => void
  onUseDefaultCoverAndSubmit: () => void
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

const coverSourceLabels: Record<BoardGameCoverSource, string> = {
  none: '默认占位图',
  bgg: 'BGG 临时预览（保存时缓存）',
  local: '本地图片',
  external: '自定义网络图片',
  cached: 'ZyApp 服务器缓存'
}

function chineseAlternate(candidate: BoardGameMetadataCandidate): string {
  return candidate.alternateNames.find((name) =>
    /[\u3400-\u9fff\uf900-\ufaff]/.test(name)
  ) ?? '—'
}

export function BoardGameEditorModal({
  editor,
  busy,
  coverCacheError,
  onChange,
  onCancel,
  onImportImage,
  onRetryCoverCache,
  onUseDefaultCoverAndSubmit,
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
        if (active) {
          setMetadataMessage(`${readableError(error)}；可继续手工填写。`)
        }
      })
    return () => { active = false }
  }, [])

  async function loadDetails(externalId: string): Promise<void> {
    setMetadataBusy(true)
    setMetadataMessage(null)
    try {
      const details = await getDesktopApi().getBoardGameMetadataDetails({
        source: 'bgg',
        externalId
      })
      onChange(
        applyMetadataDetails(
          editor,
          details,
          metadataStatus?.imagesEnabled === true
        )
      )
      setCandidates([])
      setMetadataMessage(
        '已带入 BGG 结构化资料，请核对中文名称和中文简介后保存。'
      )
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
      if (result.length === 0) {
        setMetadataMessage('未找到匹配的 BGG 桌游。')
      }
    } catch (error) {
      setMetadataMessage(readableError(error))
    } finally {
      setMetadataBusy(false)
    }
  }

  function removeCover(): void {
    onChange({
      ...editor,
      imageUrl: '',
      localImagePath: '',
      imagePreview: '',
      coverSource: 'none'
    })
  }

  function changeImageUrl(value: string): void {
    onChange({
      ...editor,
      imageUrl: value,
      localImagePath: '',
      imagePreview: '',
      coverSource: value.trim() ? 'external' : 'none'
    })
  }

  function changeBggId(value: string): void {
    const hadBggCover = editor.coverSource === 'bgg'
    onChange({
      ...editor,
      bggId: value,
      metadataSource: '',
      metadataImportedAt: '',
      ...(hadBggCover
        ? {
            imageUrl: '',
            imagePreview: '',
            coverSource: 'none' as const
          }
        : {})
    })
  }

  const imported = editor.metadataSource === 'bgg'
  const preview = editor.imagePreview || editor.imageUrl

  return (
    <div className="modal-backdrop game-editor-backdrop">
      <form
        className="modal-card game-editor-shell"
        onSubmit={onSubmit}
      >
        <header className="game-editor-header">
          <div className="form-heading">
            <span>桌游资料</span>
            <h2>
              {editor.current ? `编辑 ${editor.current.name}` : '快速新增桌游'}
            </h2>
          </div>
          <button
            aria-label="关闭桌游编辑器"
            className="text-button"
            disabled={busy}
            type="button"
            onClick={onCancel}
          >
            关闭
          </button>
        </header>

        <div className="game-editor-body">
          <aside className="game-editor-source-pane">
            <section>
              <h3>BGG 快速查找</h3>
              <div className="metadata-search">
                <input
                  aria-label="BGG 桌游名称、ID 或链接"
                  placeholder="名称、BGG ID 或详情链接"
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
                  disabled={
                    busy || metadataBusy || metadataStatus?.enabled !== true
                  }
                  type="button"
                  onClick={() => void searchMetadata()}
                >
                  {metadataBusy ? '查询中…' : '搜索'}
                </button>
              </div>
              {metadataMessage ? (
                <p className="metadata-source-note">{metadataMessage}</p>
              ) : null}
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
              <p className="metadata-attribution">Powered by BGG</p>
            </section>

            <section className="game-cover-section">
              <div className="game-cover-heading">
                <h3>封面预览</h3>
                <span>{coverSourceLabels[editor.coverSource]}</span>
              </div>
              <div className="board-game-cover-preview">
                {preview ? (
                  <img alt="封面预览" src={preview} />
                ) : (
                  <div className="board-game-cover-placeholder">
                    <strong>暂无封面</strong>
                    <span>保存后由客户端显示默认占位图</span>
                  </div>
                )}
              </div>
              <div className="game-cover-source-id">
                {editor.bggId ? `BGG #${editor.bggId}` : '尚未关联 BGG'}
              </div>
              <div className="game-cover-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  type="button"
                  onClick={onImportImage}
                >
                  上传本地图片
                </button>
                <button
                  className="text-button"
                  disabled={busy || !preview}
                  type="button"
                  onClick={removeCover}
                >
                  移除 / 使用默认封面
                </button>
              </div>
            </section>

            {coverCacheError ? (
              <section className="cover-cache-error" role="alert">
                <strong>BGG 封面缓存失败</strong>
                <p>{coverCacheError}</p>
                <div className="cover-cache-error-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={onRetryCoverCache}
                  >
                    重试缓存
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={onImportImage}
                  >
                    上传本地图片
                  </button>
                  <button
                    className="danger-button"
                    disabled={busy}
                    type="button"
                    onClick={onUseDefaultCoverAndSubmit}
                  >
                    使用默认封面并保存
                  </button>
                </div>
              </section>
            ) : null}
          </aside>

          <div className="game-editor-fields-pane">
            <section>
              <h3>公开资料</h3>
              {imported ? (
                <p className="metadata-source-note">
                  来自 BGG，保存前请核对结构化字段；中文简介需由店方填写。
                </p>
              ) : null}
              <label>
                <span>中文名称</span>
                <input
                  required
                  maxLength={120}
                  value={editor.name}
                  onChange={(event) => onChange({
                    ...editor,
                    name: event.currentTarget.value
                  })}
                />
              </label>
              <label>
                <span>中文简介</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={5000}
                  value={editor.introduction}
                  onChange={(event) => onChange({
                    ...editor,
                    introduction: event.currentTarget.value
                  })}
                />
              </label>
              <label>
                <span>中文分类（逗号、顿号或换行分隔）</span>
                <input
                  required
                  value={editor.categories}
                  onChange={(event) => onChange({
                    ...editor,
                    categories: event.currentTarget.value
                  })}
                />
              </label>
              <div className="field-grid four-columns">
                {numberFields.map(({ label, key }) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      inputMode="numeric"
                      value={editor[key]}
                      onChange={(event) => onChange({
                        ...editor,
                        [key]: event.currentTarget.value
                      })}
                    />
                  </label>
                ))}
              </div>
              <div className="field-grid three-columns">
                <label>
                  <span>复杂度（0.0–5.0）</span>
                  <input
                    min="0"
                    max="5"
                    step="0.1"
                    type="number"
                    value={editor.complexityRating}
                    onChange={(event) => onChange({
                      ...editor,
                      complexityRating: event.currentTarget.value
                    })}
                  />
                </label>
                <label>
                  <span>BGG 编号</span>
                  <input
                    inputMode="numeric"
                    value={editor.bggId}
                    onChange={(event) => changeBggId(event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>网络图片 URL（选填）</span>
                  <input
                    value={editor.imageUrl}
                    onChange={(event) => changeImageUrl(event.currentTarget.value)}
                  />
                </label>
              </div>
            </section>

            <section>
              <h3>本店配置</h3>
              <label>
                <span>库存数量</span>
                <input
                  inputMode="numeric"
                  value={editor.quantity}
                  onChange={(event) => onChange({
                    ...editor,
                    quantity: event.currentTarget.value
                  })}
                />
              </label>
              <div className="content-checkbox-grid">
                {flags.map(({ key, label }) => (
                  <label className="checkbox-field" key={key}>
                    <input
                      checked={editor[key]}
                      type="checkbox"
                      onChange={(event) => onChange({
                        ...editor,
                        [key]: event.currentTarget.checked
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>寄存人昵称</span>
                  <input
                    value={editor.consignorNickname}
                    onChange={(event) => onChange({
                      ...editor,
                      consignorNickname: event.currentTarget.value
                    })}
                  />
                </label>
                <label>
                  <span>缺件（每行 名称:数量）</span>
                  <textarea
                    value={editor.missingParts}
                    onChange={(event) => onChange({
                      ...editor,
                      missingParts: event.currentTarget.value
                    })}
                  />
                </label>
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>顾客可见备注</span>
                  <textarea
                    value={editor.customerNote}
                    onChange={(event) => onChange({
                      ...editor,
                      customerNote: event.currentTarget.value
                    })}
                  />
                </label>
                <label>
                  <span>内部备注</span>
                  <textarea
                    value={editor.internalNote}
                    onChange={(event) => onChange({
                      ...editor,
                      internalNote: event.currentTarget.value
                    })}
                  />
                </label>
              </div>
              {editor.current ? (
                <label>
                  <span>修改原因</span>
                  <textarea
                    required
                    minLength={2}
                    maxLength={200}
                    value={editor.reason}
                    onChange={(event) => onChange({
                      ...editor,
                      reason: event.currentTarget.value
                    })}
                  />
                </label>
              ) : null}
            </section>
          </div>
        </div>

        <footer className="modal-actions game-editor-actions">
          <button
            className="secondary-button"
            disabled={busy}
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>
    </div>
  )
}
