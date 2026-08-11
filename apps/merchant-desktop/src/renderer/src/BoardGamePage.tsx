import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { BoardGameSummary, SessionUser } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { BoardGameEditorModal } from './BoardGameEditorModal'
import {
  boardGameEditorFor,
  boardGameRequest,
  defaultBoardGameEditor,
  findBoardGameByBggId,
  parseMissingParts,
  partsToText,
  type BoardGameEditor
} from './board-game-editor'

export type BoardGameFilterStatus =
  | 'all'
  | 'active'
  | 'disabled'
  | 'available'
  | 'sold-out'
  | 'missing-pieces'
  | 'private'
  | 'recommended'
  | 'customer-consigned'

type OperationEditor = {
  game: BoardGameSummary
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  customerNote: string
  internalNote: string
  consignorNickname: string
  missingParts: string
  reason: string
}

type BoardGameRowProps = {
  game: BoardGameSummary
  cover: string | null
  canManage: boolean
  canOperate: boolean
  onEdit: () => void
  onOperate: () => void
  onStatus: () => void
}

const filterStatusLabels: Record<BoardGameFilterStatus, string> = {
  all: '全部状态',
  active: '启用',
  disabled: '停用',
  available: '可用',
  'sold-out': '售罄',
  'missing-pieces': '缺件',
  private: '不公开',
  recommended: '推荐',
  'customer-consigned': '顾客寄存'
}

const operationFlags: Array<{
  key: 'available' | 'customerConsigned' | 'missingPieces' | 'private'
  label: string
}> = [
  { key: 'available', label: '可用' },
  { key: 'customerConsigned', label: '顾客寄存' },
  { key: 'missingPieces', label: '缺件' },
  { key: 'private', label: '不公开' }
]

export function filterBoardGames(
  games: readonly BoardGameSummary[],
  filters: {
    query: string
    status: BoardGameFilterStatus
    category: string
  }
): BoardGameSummary[] {
  const query = filters.query.trim().toLowerCase()
  return games.filter((game) => {
    const queryMatches = !query ||
      game.name.toLowerCase().includes(query) ||
      game.categories.some((category) =>
        category.toLowerCase().includes(query)
      ) ||
      String(game.bggId ?? '').includes(query)
    const categoryMatches = filters.category === 'all' ||
      game.categories.includes(filters.category)
    const statusMatches = filters.status === 'all' ||
      (filters.status === 'active' && game.recordStatus === 'active') ||
      (filters.status === 'disabled' && game.recordStatus === 'disabled') ||
      (filters.status === 'available' && game.available) ||
      (filters.status === 'sold-out' && !game.available) ||
      (filters.status === 'missing-pieces' && game.missingPieces) ||
      (filters.status === 'private' && game.private) ||
      (filters.status === 'recommended' && game.recommended) ||
      (filters.status === 'customer-consigned' && game.customerConsigned)
    return queryMatches && categoryMatches && statusMatches
  })
}

function timeLabel(game: BoardGameSummary): string {
  if (game.minMinutes === null && game.maxMinutes === null) {
    return '时长待补充'
  }
  if (game.minMinutes === game.maxMinutes || game.maxMinutes === null) {
    return `${game.minMinutes ?? game.maxMinutes} 分钟`
  }
  if (game.minMinutes === null) return `最多 ${game.maxMinutes} 分钟`
  return `${game.minMinutes}-${game.maxMinutes} 分钟`
}

export function BoardGameRow({
  game,
  cover,
  canManage,
  canOperate,
  onEdit,
  onOperate,
  onStatus
}: BoardGameRowProps): React.JSX.Element {
  return (
    <article className={`board-game-row ${game.recordStatus}`}>
      <div className="board-game-row-cover">
        {cover ? (
          <img alt={game.name} src={cover} />
        ) : (
          <div className="board-game-cover-placeholder">
            <span>暂无封面</span>
          </div>
        )}
      </div>
      <div className="board-game-row-summary">
        <h2>{game.name}</h2>
        <p>{game.introduction}</p>
        <div className="activity-tags board-game-row-categories">
          {game.categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
      </div>
      <div className="board-game-row-facts">
        <span>{game.minPlayers}-{game.maxPlayers} 人</span>
        <span>{timeLabel(game)}</span>
        <span>
          复杂度 {game.complexityRating === null
            ? '待补充'
            : game.complexityRating.toFixed(1)}
        </span>
        <span>内部数量 {game.quantity}</span>
      </div>
      <div className="board-game-row-statuses">
        <div className="activity-tags">
          <span>{game.available ? '可用' : '售罄'}</span>
          {game.private ? <span>不公开</span> : <span>公开</span>}
          {game.recommended ? <span>推荐</span> : null}
          {game.customerConsigned ? <span>顾客寄存</span> : null}
          {game.missingPieces ? <span className="warning">缺件</span> : null}
        </div>
        <span className={`status-pill ${game.recordStatus}`}>
          {game.recordStatus === 'active' ? '启用' : '停用'}
        </span>
        <small>{game.bggId ? `BGG #${game.bggId}` : '无 BGG ID'}</small>
      </div>
      <div className="board-game-row-actions">
        {canManage ? (
          <button className="text-button" type="button" onClick={onEdit}>
            编辑资料
          </button>
        ) : null}
        {canOperate ? (
          <button className="text-button" type="button" onClick={onOperate}>
            状态与备注
          </button>
        ) : null}
        {canManage ? (
          <button className="text-button" type="button" onClick={onStatus}>
            {game.recordStatus === 'active' ? '停用' : '启用'}
          </button>
        ) : null}
      </div>
    </article>
  )
}

export function BoardGamePage({
  session
}: {
  session: SessionUser
}): React.JSX.Element {
  const [games, setGames] = useState<BoardGameSummary[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<BoardGameFilterStatus>('all')
  const [category, setCategory] = useState('all')
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})
  const [gameEditor, setGameEditor] = useState<BoardGameEditor | null>(null)
  const [operationEditor, setOperationEditor] =
    useState<OperationEditor | null>(null)
  const [statusAction, setStatusAction] = useState<BoardGameSummary | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [coverCacheError, setCoverCacheError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canManage = session.permissions.includes('content.manage')
  const canOperate = session.permissions.includes(
    'content.board-game.operations.manage'
  )

  async function load(): Promise<void> {
    try {
      const nextGames = await getDesktopApi().listBoardGames()
      setGames(nextGames)
      const previews = await Promise.all(
        nextGames
          .filter((game) => game.localImagePath)
          .map(async (game) => [
            game.id,
            await getDesktopApi().readBoardGameImage({
              managedPath: game.localImagePath ?? ''
            })
          ] as const)
      )
      setImagePreviews(Object.fromEntries(
        previews.filter((entry): entry is readonly [string, string] =>
          Boolean(entry[1])
        )
      ))
      setError(null)
    } catch (value) {
      setError(readableError(value))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const categories = useMemo(() => [
    ...new Set(games.flatMap((game) => game.categories))
  ].sort((left, right) => left.localeCompare(right, 'zh-CN')), [games])

  const filteredGames = useMemo(() => filterBoardGames(games, {
    query,
    status,
    category
  }), [category, games, query, status])

  function openNewEditor(): void {
    setCoverCacheError(null)
    setError(null)
    setGameEditor(defaultBoardGameEditor())
  }

  function openEditor(game: BoardGameSummary): void {
    setCoverCacheError(null)
    setError(null)
    setGameEditor(boardGameEditorFor(
      game,
      imagePreviews[game.id] ?? ''
    ))
  }

  async function saveBoardGame(
    editorToSave: BoardGameEditor | null = gameEditor
  ): Promise<void> {
    if (!editorToSave || busy) return
    setBusy(true)
    setError(null)
    setCoverCacheError(null)
    let attemptedBggId: number | undefined
    try {
      const request = boardGameRequest(editorToSave)
      attemptedBggId = request.bggId
      if (!editorToSave.current) {
        const existing = findBoardGameByBggId(games, request.bggId)
        if (existing) {
          openEditor(existing)
          setNotice(`BGG #${request.bggId} 已存在，已打开 ${existing.name}`)
          return
        }
      }
      const saved = editorToSave.current
        ? await getDesktopApi().updateBoardGame({
            boardGameId: editorToSave.current.id,
            ...request,
            reason: editorToSave.reason
          })
        : await getDesktopApi().createBoardGame(request)
      setNotice(`${saved.name} 已保存`)
      setGameEditor(null)
      await load()
    } catch (value) {
      if (!editorToSave.current && attemptedBggId !== undefined) {
        try {
          const refreshedGames = await getDesktopApi().listBoardGames()
          const existing = findBoardGameByBggId(
            refreshedGames,
            attemptedBggId
          )
          if (existing) {
            setGames(refreshedGames)
            openEditor(existing)
            setNotice(`BGG #${attemptedBggId} 已存在，已打开 ${existing.name}`)
            return
          }
        } catch {
          // Keep the original save error when duplicate recovery cannot load.
        }
      }
      const message = readableError(value)
      if (editorToSave.coverSource === 'bgg') {
        setCoverCacheError(message)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function importImage(): Promise<void> {
    if (!gameEditor || busy) return
    setBusy(true)
    try {
      const result = await getDesktopApi().importBoardGameImage()
      if (!result.canceled && result.managedPath && result.previewDataUrl) {
        setGameEditor({
          ...gameEditor,
          imageUrl: '',
          localImagePath: result.managedPath,
          imagePreview: result.previewDataUrl,
          coverSource: 'local'
        })
        setCoverCacheError(null)
      }
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  function useDefaultCoverAndSave(): void {
    if (!gameEditor || busy) return
    const withoutCover: BoardGameEditor = {
      ...gameEditor,
      imageUrl: '',
      localImagePath: '',
      imagePreview: '',
      coverSource: 'none'
    }
    setGameEditor(withoutCover)
    setCoverCacheError(null)
    void saveBoardGame(withoutCover)
  }

  function editOperations(game: BoardGameSummary): void {
    setOperationEditor({
      game,
      available: game.available,
      customerConsigned: game.customerConsigned,
      missingPieces: game.missingPieces,
      private: game.private,
      customerNote: game.customerNote ?? '',
      internalNote: game.internalNote ?? '',
      consignorNickname: game.consignorNickname ?? '',
      missingParts: partsToText(game),
      reason: ''
    })
  }

  async function saveOperations(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!operationEditor || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await getDesktopApi().updateBoardGameOperations({
        boardGameId: operationEditor.game.id,
        available: operationEditor.available,
        customerConsigned: operationEditor.customerConsigned,
        missingPieces: operationEditor.missingPieces,
        private: operationEditor.private,
        ...(operationEditor.customerNote.trim()
          ? { customerNote: operationEditor.customerNote.trim() }
          : {}),
        ...(operationEditor.internalNote.trim()
          ? { internalNote: operationEditor.internalNote.trim() }
          : {}),
        ...(operationEditor.consignorNickname.trim()
          ? { consignorNickname: operationEditor.consignorNickname.trim() }
          : {}),
        missingParts: parseMissingParts(operationEditor.missingParts),
        reason: operationEditor.reason
      })
      setNotice(`${saved.name} 的状态和备注已更新`)
      setOperationEditor(null)
      await load()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!statusAction || busy) return
    setBusy(true)
    setError(null)
    try {
      await getDesktopApi().setBoardGameRecordStatus({
        boardGameId: statusAction.id,
        status: statusAction.recordStatus === 'active' ? 'disabled' : 'active',
        reason: statusReason
      })
      setStatusAction(null)
      setStatusReason('')
      await load()
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
          <p className="eyebrow">门店桌游资料与运营状态</p>
          <h1>桌游管理</h1>
        </div>
        {canManage ? (
          <button className="primary-button" type="button" onClick={openNewEditor}>
            新增桌游
          </button>
        ) : (
          <div className="release-tag">店员仅维护桌游状态</div>
        )}
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="board-game-toolbar" aria-label="桌游筛选">
        <input
          aria-label="搜索桌游"
          placeholder="按名称、分类或 BGG ID 搜索"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <select
          aria-label="状态筛选"
          value={status}
          onChange={(event) => setStatus(
            event.currentTarget.value as BoardGameFilterStatus
          )}
        >
          {Object.entries(filterStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          aria-label="分类筛选"
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value)}
        >
          <option value="all">全部分类</option>
          {categories.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <span>
          共 {games.length} 款 · 当前 {filteredGames.length} 款
        </span>
      </section>

      <section className="board-game-list">
        {filteredGames.length === 0 ? (
          <div className="empty-row">暂无匹配的桌游资料</div>
        ) : null}
        {filteredGames.map((game) => (
          <BoardGameRow
            canManage={canManage}
            canOperate={canOperate}
            cover={imagePreviews[game.id] || game.imageUrl}
            game={game}
            key={game.id}
            onEdit={() => openEditor(game)}
            onOperate={() => editOperations(game)}
            onStatus={() => {
              setStatusReason('')
              setStatusAction(game)
            }}
          />
        ))}
      </section>

      {gameEditor ? (
        <BoardGameEditorModal
          busy={busy}
          coverCacheError={coverCacheError}
          editor={gameEditor}
          onCancel={() => {
            setCoverCacheError(null)
            setGameEditor(null)
          }}
          onChange={(next) => {
            setGameEditor(next)
            if (next.coverSource !== 'bgg') setCoverCacheError(null)
          }}
          onImportImage={() => void importImage()}
          onRetryCoverCache={() => void saveBoardGame()}
          onSubmit={(event) => {
            event.preventDefault()
            void saveBoardGame()
          }}
          onUseDefaultCoverAndSubmit={useDefaultCoverAndSave}
        />
      ) : null}

      {operationEditor ? (
        <div className="modal-backdrop">
          <form
            className="modal-card content-editor"
            onSubmit={(event) => void saveOperations(event)}
          >
            <div className="form-heading">
              <span>桌游状态与备注</span>
              <h2>{operationEditor.game.name}</h2>
            </div>
            <div className="content-checkbox-grid">
              {operationFlags.map(({ key, label }) => (
                <label className="checkbox-field" key={key}>
                  <input
                    checked={operationEditor[key]}
                    type="checkbox"
                    onChange={(event) => setOperationEditor({
                      ...operationEditor,
                      [key]: event.currentTarget.checked
                    })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label>
              <span>寄存人昵称</span>
              <input
                value={operationEditor.consignorNickname}
                onChange={(event) => setOperationEditor({
                  ...operationEditor,
                  consignorNickname: event.currentTarget.value
                })}
              />
            </label>
            <label>
              <span>缺件（每行 名称:数量）</span>
              <textarea
                value={operationEditor.missingParts}
                onChange={(event) => setOperationEditor({
                  ...operationEditor,
                  missingParts: event.currentTarget.value
                })}
              />
            </label>
            <label>
              <span>顾客可见备注</span>
              <textarea
                value={operationEditor.customerNote}
                onChange={(event) => setOperationEditor({
                  ...operationEditor,
                  customerNote: event.currentTarget.value
                })}
              />
            </label>
            <label>
              <span>内部备注</span>
              <textarea
                value={operationEditor.internalNote}
                onChange={(event) => setOperationEditor({
                  ...operationEditor,
                  internalNote: event.currentTarget.value
                })}
              />
            </label>
            <label>
              <span>修改原因</span>
              <textarea
                required
                minLength={2}
                maxLength={200}
                value={operationEditor.reason}
                onChange={(event) => setOperationEditor({
                  ...operationEditor,
                  reason: event.currentTarget.value
                })}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setOperationEditor(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {statusAction ? (
        <div className="modal-backdrop">
          <form
            className="modal-card"
            onSubmit={(event) => void changeStatus(event)}
          >
            <div className="form-heading">
              <span>店长确认</span>
              <h2>{statusAction.name}</h2>
            </div>
            <label>
              <span>操作原因</span>
              <textarea
                required
                minLength={2}
                maxLength={200}
                value={statusReason}
                onChange={(event) => setStatusReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStatusAction(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                确认
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
