import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AnnouncementSummary,
  BoardGameDifficulty,
  BoardGameSummary,
  CreateAnnouncementRequest,
  CreateBoardGameRequest,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type AnnouncementEditor = {
  current: AnnouncementSummary | null
  title: string
  content: string
  pinned: boolean
  visibleFrom: string
  visibleUntil: string
  reason: string
}

type BoardGameEditor = {
  current: BoardGameSummary | null
  name: string
  introduction: string
  categories: string
  minPlayers: string
  maxPlayers: string
  minMinutes: string
  maxMinutes: string
  difficulty: BoardGameDifficulty
  quantity: string
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  recommended: boolean
  imageUrl: string
  localImagePath: string
  imagePreview: string
  bggId: string
  customerNote: string
  internalNote: string
  consignorNickname: string
  missingParts: string
  reason: string
}

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

type StatusAction =
  | { type: 'announcement'; item: AnnouncementSummary }
  | { type: 'board-game'; item: BoardGameSummary }

const visibilityLabels: Record<AnnouncementSummary['visibility'], string> = {
  draft: '草稿',
  scheduled: '等待发布',
  active: '展示中',
  ended: '已结束',
  disabled: '已停用'
}

const difficultyLabels: Record<BoardGameDifficulty, string> = {
  light: '轻度',
  medium: '中度',
  heavy: '重度'
}

const boardGameNumberFields: Array<{
  label: string
  key: 'minPlayers' | 'maxPlayers' | 'minMinutes' | 'maxMinutes'
}> = [
  { label: '最少人数', key: 'minPlayers' },
  { label: '最多人数', key: 'maxPlayers' },
  { label: '最短分钟', key: 'minMinutes' },
  { label: '最长分钟', key: 'maxMinutes' }
]

const boardGameFlags: Array<{
  key:
    | 'available'
    | 'customerConsigned'
    | 'missingPieces'
    | 'private'
    | 'recommended'
  label: string
}> = [
  { key: 'available', label: '可用' },
  { key: 'customerConsigned', label: '顾客寄存' },
  { key: 'missingPieces', label: '缺件' },
  { key: 'private', label: '不公开' },
  { key: 'recommended', label: '推荐' }
]

const boardGameOperationFlags: Array<{
  key: 'available' | 'customerConsigned' | 'missingPieces' | 'private'
  label: string
}> = boardGameFlags.filter(
  (
    entry
  ): entry is {
    key: 'available' | 'customerConsigned' | 'missingPieces' | 'private'
    label: string
  } => entry.key !== 'recommended'
)

function toInputDateTime(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatTime(value: string | null): string {
  if (!value) return '长期有效'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function defaultAnnouncementEditor(): AnnouncementEditor {
  const now = new Date()
  now.setSeconds(0, 0)
  return {
    current: null,
    title: '',
    content: '',
    pinned: false,
    visibleFrom: toInputDateTime(now.toISOString()),
    visibleUntil: '',
    reason: ''
  }
}

function announcementEditorFor(
  announcement: AnnouncementSummary
): AnnouncementEditor {
  return {
    current: announcement,
    title: announcement.title,
    content: announcement.content,
    pinned: announcement.pinned,
    visibleFrom: toInputDateTime(announcement.visibleFrom),
    visibleUntil: announcement.visibleUntil
      ? toInputDateTime(announcement.visibleUntil)
      : '',
    reason: ''
  }
}

function partsToText(game: BoardGameSummary): string {
  return game.missingParts
    .map((part) => `${part.name}:${part.quantity}`)
    .join('\n')
}

function defaultBoardGameEditor(): BoardGameEditor {
  return {
    current: null,
    name: '',
    introduction: '',
    categories: '',
    minPlayers: '1',
    maxPlayers: '4',
    minMinutes: '',
    maxMinutes: '',
    difficulty: 'light',
    quantity: '1',
    available: true,
    customerConsigned: false,
    missingPieces: false,
    private: false,
    recommended: false,
    imageUrl: '',
    localImagePath: '',
    imagePreview: '',
    bggId: '',
    customerNote: '',
    internalNote: '',
    consignorNickname: '',
    missingParts: '',
    reason: ''
  }
}

function boardGameEditorFor(
  game: BoardGameSummary,
  imagePreview = ''
): BoardGameEditor {
  return {
    current: game,
    name: game.name,
    introduction: game.introduction,
    categories: game.categories.join('、'),
    minPlayers: String(game.minPlayers),
    maxPlayers: String(game.maxPlayers),
    minMinutes: game.minMinutes === null ? '' : String(game.minMinutes),
    maxMinutes: game.maxMinutes === null ? '' : String(game.maxMinutes),
    difficulty: game.difficulty,
    quantity: String(game.quantity),
    available: game.available,
    customerConsigned: game.customerConsigned,
    missingPieces: game.missingPieces,
    private: game.private,
    recommended: game.recommended,
    imageUrl: game.imageUrl ?? '',
    localImagePath: game.localImagePath ?? '',
    imagePreview,
    bggId: game.bggId === null ? '' : String(game.bggId),
    customerNote: game.customerNote ?? '',
    internalNote: game.internalNote ?? '',
    consignorNickname: game.consignorNickname ?? '',
    missingParts: partsToText(game),
    reason: ''
  }
}

function parseInteger(value: string, label: string, optional = false): number | undefined {
  const normalized = value.trim()
  if (optional && !normalized) return undefined
  if (!/^\d+$/.test(normalized)) throw new Error(`${label}必须是整数`)
  const number = Number(normalized)
  if (!Number.isSafeInteger(number)) throw new Error(`${label}超出范围`)
  return number
}

function parseMissingParts(
  value: string
): Array<{ name: string; quantity: number }> {
  if (!value.trim()) return []
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.+?)\s*[:：]\s*(\d+)$/.exec(line)
      if (!match) throw new Error(`缺件“${line}”请使用 名称:数量`)
      return { name: match[1]?.trim() ?? '', quantity: Number(match[2]) }
    })
}

function announcementRequest(
  editor: AnnouncementEditor
): CreateAnnouncementRequest {
  return {
    title: editor.title,
    content: editor.content,
    pinned: editor.pinned,
    visibleFrom: new Date(editor.visibleFrom).toISOString(),
    ...(editor.visibleUntil
      ? { visibleUntil: new Date(editor.visibleUntil).toISOString() }
      : {})
  }
}

function boardGameRequest(editor: BoardGameEditor): CreateBoardGameRequest {
  const minMinutes = parseInteger(editor.minMinutes, '最短时长', true)
  const maxMinutes = parseInteger(editor.maxMinutes, '最长时长', true)
  const bggId = parseInteger(editor.bggId, 'BGG 编号', true)
  const missingParts = parseMissingParts(editor.missingParts)
  if (editor.missingPieces && missingParts.length === 0) {
    throw new Error('勾选缺件后，请填写至少一条缺件名称和数量')
  }
  return {
    name: editor.name,
    introduction: editor.introduction,
    categories: editor.categories
      .split(/[、,，\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    minPlayers: parseInteger(editor.minPlayers, '最少人数') ?? 1,
    maxPlayers: parseInteger(editor.maxPlayers, '最多人数') ?? 1,
    ...(minMinutes === undefined ? {} : { minMinutes }),
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    difficulty: editor.difficulty,
    quantity: parseInteger(editor.quantity, '库存数量') ?? 0,
    available: editor.available,
    customerConsigned: editor.customerConsigned,
    missingPieces: editor.missingPieces,
    private: editor.private,
    recommended: editor.recommended,
    ...(editor.imageUrl.trim() ? { imageUrl: editor.imageUrl.trim() } : {}),
    ...(editor.localImagePath
      ? { localImagePath: editor.localImagePath }
      : {}),
    ...(bggId === undefined ? {} : { bggId }),
    ...(editor.customerNote.trim()
      ? { customerNote: editor.customerNote.trim() }
      : {}),
    ...(editor.internalNote.trim()
      ? { internalNote: editor.internalNote.trim() }
      : {}),
    ...(editor.consignorNickname.trim()
      ? { consignorNickname: editor.consignorNickname.trim() }
      : {}),
    missingParts
  }
}

export function ContentPage({
  session
}: {
  session: SessionUser
}): React.JSX.Element {
  const [tab, setTab] = useState<'announcements' | 'games'>('announcements')
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([])
  const [games, setGames] = useState<BoardGameSummary[]>([])
  const [gameQuery, setGameQuery] = useState('')
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({})
  const [announcementEditor, setAnnouncementEditor] =
    useState<AnnouncementEditor | null>(null)
  const [gameEditor, setGameEditor] = useState<BoardGameEditor | null>(null)
  const [operationEditor, setOperationEditor] =
    useState<OperationEditor | null>(null)
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canManage = session.permissions.includes('content.manage')
  const canOperate = session.permissions.includes(
    'content.board-game.operations.manage'
  )

  async function load(): Promise<void> {
    try {
      const [nextAnnouncements, nextGames] = await Promise.all([
        getDesktopApi().listAnnouncements(),
        getDesktopApi().listBoardGames()
      ])
      setAnnouncements(nextAnnouncements)
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
      setImagePreviews(
        Object.fromEntries(
          previews.filter((entry): entry is readonly [string, string] =>
            Boolean(entry[1])
          )
        )
      )
      setError(null)
    } catch (value) {
      setError(readableError(value))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredGames = useMemo(() => {
    const query = gameQuery.trim().toLowerCase()
    if (!query) return games
    return games.filter(
      (game) =>
        game.name.toLowerCase().includes(query) ||
        game.categories.some((category) =>
          category.toLowerCase().includes(query)
        )
    )
  }, [gameQuery, games])

  async function saveAnnouncement(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!announcementEditor || busy) return
    setBusy(true)
    setError(null)
    try {
      const request = announcementRequest(announcementEditor)
      const saved = announcementEditor.current
        ? await getDesktopApi().updateAnnouncement({
            announcementId: announcementEditor.current.id,
            ...request,
            reason: announcementEditor.reason
          })
        : await getDesktopApi().createAnnouncement(request)
      setNotice(`${saved.title} 已保存`)
      setAnnouncementEditor(null)
      await load()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function saveBoardGame(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!gameEditor || busy) return
    setBusy(true)
    setError(null)
    try {
      const request = boardGameRequest(gameEditor)
      const saved = gameEditor.current
        ? await getDesktopApi().updateBoardGame({
            boardGameId: gameEditor.current.id,
            ...request,
            reason: gameEditor.reason
          })
        : await getDesktopApi().createBoardGame(request)
      setNotice(`${saved.name} 已保存`)
      setGameEditor(null)
      await load()
    } catch (value) {
      setError(readableError(value))
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
          localImagePath: result.managedPath,
          imagePreview: result.previewDataUrl
        })
      }
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
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
      if (statusAction.type === 'announcement') {
        await getDesktopApi().setAnnouncementStatus({
          announcementId: statusAction.item.id,
          status:
            statusAction.item.status === 'published' ? 'disabled' : 'published',
          reason: statusReason
        })
      } else {
        await getDesktopApi().setBoardGameRecordStatus({
          boardGameId: statusAction.item.id,
          status:
            statusAction.item.recordStatus === 'active' ? 'disabled' : 'active',
          reason: statusReason
        })
      }
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
          <p className="eyebrow">顾客公开内容与门店桌游资料</p>
          <h1>内容管理</h1>
        </div>
        {canManage ? (
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              tab === 'announcements'
                ? setAnnouncementEditor(defaultAnnouncementEditor())
                : setGameEditor(defaultBoardGameEditor())
            }
          >
            {tab === 'announcements' ? '新增公告' : '新增桌游'}
          </button>
        ) : (
          <div className="release-tag">店员仅维护桌游状态</div>
        )}
      </header>

      <div className="content-tabs">
        <button
          className={tab === 'announcements' ? 'active' : ''}
          type="button"
          onClick={() => setTab('announcements')}
        >
          公告
        </button>
        <button
          className={tab === 'games' ? 'active' : ''}
          type="button"
          onClick={() => setTab('games')}
        >
          桌游资料
        </button>
      </div>
      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      {tab === 'announcements' ? (
        <section className="content-card-grid">
          {announcements.length === 0 ? (
            <div className="empty-row">暂无公告</div>
          ) : null}
          {announcements.map((announcement) => (
            <article className="content-card" key={announcement.id}>
              <div className="content-card-head">
                <div className="activity-tags">
                  {announcement.pinned ? <span>置顶</span> : null}
                </div>
                <em className={`activity-visibility ${announcement.visibility}`}>
                  {visibilityLabels[announcement.visibility]}
                </em>
              </div>
              <h2>{announcement.title}</h2>
              <p>{announcement.content}</p>
              <small>
                {formatTime(announcement.visibleFrom)} 至{' '}
                {formatTime(announcement.visibleUntil)}
              </small>
              {canManage ? (
                <div className="activity-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setAnnouncementEditor(
                        announcementEditorFor(announcement)
                      )
                    }
                  >
                    编辑
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setStatusAction({ type: 'announcement', item: announcement })
                    }
                  >
                    {announcement.status === 'published' ? '停用' : '发布'}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : (
        <>
          <div className="content-toolbar">
            <input
              placeholder="按桌游名称或分类搜索"
              value={gameQuery}
              onChange={(event) => setGameQuery(event.currentTarget.value)}
            />
            <span>顾客端只展示是否售罄，不展示准确数量和内部信息。</span>
          </div>
          <section className="board-game-grid">
            {filteredGames.length === 0 ? (
              <div className="empty-row">暂无匹配的桌游资料</div>
            ) : null}
            {filteredGames.map((game) => {
              const cover = imagePreviews[game.id] || game.imageUrl
              return (
                <article
                  className={`board-game-card ${
                    game.recordStatus === 'disabled' ? 'disabled' : ''
                  }`}
                  key={game.id}
                >
                  {cover ? <img alt={game.name} src={cover} /> : null}
                  <div className="board-game-copy">
                    <div className="content-card-head">
                      <div className="activity-tags">
                        {game.available ? <span>可用</span> : <span>售罄</span>}
                        {game.customerConsigned ? <span>顾客寄存</span> : null}
                        {game.missingPieces ? <span>缺件</span> : null}
                        {game.private ? <span>不公开</span> : null}
                        {game.recommended ? <span>推荐</span> : null}
                      </div>
                      <span className={`status-pill ${game.recordStatus}`}>
                        {game.recordStatus === 'active' ? '启用' : '停用'}
                      </span>
                    </div>
                    <h2>{game.name}</h2>
                    <p>{game.introduction}</p>
                    <div className="board-game-meta">
                      <span>
                        {game.minPlayers}-{game.maxPlayers} 人
                      </span>
                      <span>{difficultyLabels[game.difficulty]}</span>
                      <span>内部数量 {game.quantity}</span>
                    </div>
                    <div className="activity-tags">
                      {game.categories.map((category) => (
                        <span key={category}>{category}</span>
                      ))}
                    </div>
                    {game.missingParts.length > 0 ? (
                      <p className="board-game-warning">
                        缺件：
                        {game.missingParts
                          .map((part) => `${part.name} × ${part.quantity}`)
                          .join('、')}
                      </p>
                    ) : null}
                    {game.customerConsigned ? (
                      <p>寄存人：{game.consignorNickname}</p>
                    ) : null}
                    <div className="activity-actions">
                      {canOperate ? (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
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
                        >
                          状态与备注
                        </button>
                      ) : null}
                      {canManage ? (
                        <>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() =>
                              setGameEditor(
                                boardGameEditorFor(
                                  game,
                                  imagePreviews[game.id] ?? ''
                                )
                              )
                            }
                          >
                            编辑资料
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() =>
                              setStatusAction({ type: 'board-game', item: game })
                            }
                          >
                            {game.recordStatus === 'active' ? '停用' : '启用'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </section>
        </>
      )}

      {announcementEditor ? (
        <div className="modal-backdrop">
          <form
            className="modal-card content-editor"
            onSubmit={(event) => void saveAnnouncement(event)}
          >
            <div className="form-heading">
              <span>公告</span>
              <h2>{announcementEditor.current ? '编辑公告' : '新增公告草稿'}</h2>
            </div>
            <label>
              <span>标题</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={announcementEditor.title}
                onChange={(event) =>
                  setAnnouncementEditor({
                    ...announcementEditor,
                    title: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>内容</span>
              <textarea
                required
                minLength={2}
                maxLength={5000}
                value={announcementEditor.content}
                onChange={(event) =>
                  setAnnouncementEditor({
                    ...announcementEditor,
                    content: event.currentTarget.value
                  })
                }
              />
            </label>
            <div className="field-grid two-columns">
              <label>
                <span>开始显示</span>
                <input
                  required
                  type="datetime-local"
                  value={announcementEditor.visibleFrom}
                  onChange={(event) =>
                    setAnnouncementEditor({
                      ...announcementEditor,
                      visibleFrom: event.currentTarget.value
                    })
                  }
                />
              </label>
              <label>
                <span>结束显示（选填）</span>
                <input
                  type="datetime-local"
                  value={announcementEditor.visibleUntil}
                  onChange={(event) =>
                    setAnnouncementEditor({
                      ...announcementEditor,
                      visibleUntil: event.currentTarget.value
                    })
                  }
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input
                checked={announcementEditor.pinned}
                type="checkbox"
                onChange={(event) =>
                  setAnnouncementEditor({
                    ...announcementEditor,
                    pinned: event.currentTarget.checked
                  })
                }
              />
              <span>置顶</span>
            </label>
            {announcementEditor.current ? (
              <label>
                <span>修改原因</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={200}
                  value={announcementEditor.reason}
                  onChange={(event) =>
                    setAnnouncementEditor({
                      ...announcementEditor,
                      reason: event.currentTarget.value
                    })
                  }
                />
              </label>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setAnnouncementEditor(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                保存草稿
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {gameEditor ? (
        <div className="modal-backdrop">
          <form
            className="modal-card content-editor game-editor"
            onSubmit={(event) => void saveBoardGame(event)}
          >
            <div className="form-heading">
              <span>桌游资料</span>
              <h2>{gameEditor.current ? `编辑 ${gameEditor.current.name}` : '新增桌游'}</h2>
            </div>
            <div className="activity-editor-scroll">
              <label>
                <span>名称</span>
                <input
                  required
                  maxLength={120}
                  value={gameEditor.name}
                  onChange={(event) =>
                    setGameEditor({ ...gameEditor, name: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>简介</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={5000}
                  value={gameEditor.introduction}
                  onChange={(event) =>
                    setGameEditor({
                      ...gameEditor,
                      introduction: event.currentTarget.value
                    })
                  }
                />
              </label>
              <label>
                <span>分类（用逗号或顿号分隔）</span>
                <input
                  required
                  value={gameEditor.categories}
                  onChange={(event) =>
                    setGameEditor({
                      ...gameEditor,
                      categories: event.currentTarget.value
                    })
                  }
                />
              </label>
              <div className="field-grid four-columns">
                {boardGameNumberFields.map(({ label, key }) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      inputMode="numeric"
                      value={gameEditor[key as keyof BoardGameEditor] as string}
                      onChange={(event) =>
                        setGameEditor({
                          ...gameEditor,
                          [key]: event.currentTarget.value
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="field-grid three-columns">
                <label>
                  <span>难度</span>
                  <select
                    value={gameEditor.difficulty}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        difficulty: event.currentTarget
                          .value as BoardGameDifficulty
                      })
                    }
                  >
                    <option value="light">轻度</option>
                    <option value="medium">中度</option>
                    <option value="heavy">重度</option>
                  </select>
                </label>
                <label>
                  <span>内部库存数量</span>
                  <input
                    inputMode="numeric"
                    value={gameEditor.quantity}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        quantity: event.currentTarget.value
                      })
                    }
                  />
                </label>
                <label>
                  <span>BGG 编号（选填）</span>
                  <input
                    inputMode="numeric"
                    value={gameEditor.bggId}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        bggId: event.currentTarget.value
                      })
                    }
                  />
                </label>
              </div>
              <div className="content-checkbox-grid">
                {boardGameFlags.map(({ key, label }) => (
                  <label className="checkbox-field" key={key}>
                    <input
                      checked={gameEditor[key as keyof BoardGameEditor] as boolean}
                      type="checkbox"
                      onChange={(event) =>
                        setGameEditor({
                          ...gameEditor,
                          [key]: event.currentTarget.checked
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>网络图片 URL（选填）</span>
                  <input
                    value={gameEditor.imageUrl}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        imageUrl: event.currentTarget.value
                      })
                    }
                  />
                </label>
                <div className="image-import-field">
                  <span>本地图片</span>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void importImage()}
                  >
                    选择并导入图片
                  </button>
                </div>
              </div>
              {gameEditor.imagePreview || gameEditor.imageUrl ? (
                <img
                  alt="封面预览"
                  className="board-game-image-preview"
                  src={gameEditor.imagePreview || gameEditor.imageUrl}
                />
              ) : null}
              <div className="field-grid two-columns">
                <label>
                  <span>寄存人昵称</span>
                  <input
                    value={gameEditor.consignorNickname}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        consignorNickname: event.currentTarget.value
                      })
                    }
                  />
                </label>
                <label>
                  <span>缺件（每行 名称:数量）</span>
                  <textarea
                    value={gameEditor.missingParts}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        missingParts: event.currentTarget.value
                      })
                    }
                  />
                </label>
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>顾客可见备注</span>
                  <textarea
                    value={gameEditor.customerNote}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        customerNote: event.currentTarget.value
                      })
                    }
                  />
                </label>
                <label>
                  <span>内部备注</span>
                  <textarea
                    value={gameEditor.internalNote}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        internalNote: event.currentTarget.value
                      })
                    }
                  />
                </label>
              </div>
              {gameEditor.current ? (
                <label>
                  <span>修改原因</span>
                  <textarea
                    required
                    minLength={2}
                    maxLength={200}
                    value={gameEditor.reason}
                    onChange={(event) =>
                      setGameEditor({
                        ...gameEditor,
                        reason: event.currentTarget.value
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setGameEditor(null)}
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
              {boardGameOperationFlags.map(({ key, label }) => (
                <label className="checkbox-field" key={key}>
                  <input
                    checked={
                      operationEditor[key as keyof OperationEditor] as boolean
                    }
                    type="checkbox"
                    onChange={(event) =>
                      setOperationEditor({
                        ...operationEditor,
                        [key]: event.currentTarget.checked
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label>
              <span>寄存人昵称</span>
              <input
                value={operationEditor.consignorNickname}
                onChange={(event) =>
                  setOperationEditor({
                    ...operationEditor,
                    consignorNickname: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>缺件（每行 名称:数量）</span>
              <textarea
                value={operationEditor.missingParts}
                onChange={(event) =>
                  setOperationEditor({
                    ...operationEditor,
                    missingParts: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>顾客可见备注</span>
              <textarea
                value={operationEditor.customerNote}
                onChange={(event) =>
                  setOperationEditor({
                    ...operationEditor,
                    customerNote: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>内部备注</span>
              <textarea
                value={operationEditor.internalNote}
                onChange={(event) =>
                  setOperationEditor({
                    ...operationEditor,
                    internalNote: event.currentTarget.value
                  })
                }
              />
            </label>
            <label>
              <span>修改原因</span>
              <textarea
                required
                minLength={2}
                maxLength={200}
                value={operationEditor.reason}
                onChange={(event) =>
                  setOperationEditor({
                    ...operationEditor,
                    reason: event.currentTarget.value
                  })
                }
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
              <h2>
                {statusAction.type === 'announcement'
                  ? statusAction.item.title
                  : statusAction.item.name}
              </h2>
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
