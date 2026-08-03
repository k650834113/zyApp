import type {
  BoardGameMetadataDetails,
  BoardGameSummary,
  CreateBoardGameRequest
} from '@zyapp/contracts'

export type BoardGameEditor = {
  current: BoardGameSummary | null
  name: string
  introduction: string
  categories: string
  minPlayers: string
  maxPlayers: string
  minMinutes: string
  maxMinutes: string
  complexityRating: string
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
  metadataSource: 'bgg' | ''
  metadataImportedAt: string
  customerNote: string
  internalNote: string
  consignorNickname: string
  missingParts: string
  reason: string
}

export type BggLookupInput =
  | { kind: 'id'; externalId: string }
  | { kind: 'query'; query: string }

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/

export function parseBggLookupInput(value: string): BggLookupInput {
  const normalized = value.trim()
  if (/^[1-9]\d*$/.test(normalized)) {
    return { kind: 'id', externalId: normalized }
  }
  if (/^https?:\/\//i.test(normalized)) {
    let url: URL
    try {
      url = new URL(normalized)
    } catch {
      throw new Error('请输入有效的 BGG 链接')
    }
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const match = /^\/boardgame\/([1-9]\d+)(?:\/|$)/.exec(url.pathname)
    if (hostname !== 'boardgamegeek.com' || !match?.[1]) {
      throw new Error('仅支持 BGG 桌游详情链接')
    }
    return { kind: 'id', externalId: match[1] }
  }
  if (!normalized) throw new Error('请输入桌游名称、BGG ID 或链接')
  return { kind: 'query', query: normalized }
}

export function partsToText(game: BoardGameSummary): string {
  return game.missingParts
    .map((part) => `${part.name}:${part.quantity}`)
    .join('\n')
}

export function findBoardGameByBggId<
  T extends Pick<BoardGameSummary, 'bggId'>
>(games: readonly T[], bggId: number | undefined): T | null {
  if (bggId === undefined) return null
  return games.find((game) => game.bggId === bggId) ?? null
}

export function defaultBoardGameEditor(): BoardGameEditor {
  return {
    current: null,
    name: '',
    introduction: '',
    categories: '',
    minPlayers: '1',
    maxPlayers: '4',
    minMinutes: '',
    maxMinutes: '',
    complexityRating: '',
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
    metadataSource: '',
    metadataImportedAt: '',
    customerNote: '',
    internalNote: '',
    consignorNickname: '',
    missingParts: '',
    reason: ''
  }
}

export function boardGameEditorFor(
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
    complexityRating:
      game.complexityRating === null ? '' : String(game.complexityRating),
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
    metadataSource: game.metadataSource ?? '',
    metadataImportedAt: game.metadataImportedAt ?? '',
    customerNote: game.customerNote ?? '',
    internalNote: game.internalNote ?? '',
    consignorNickname: game.consignorNickname ?? '',
    missingParts: partsToText(game),
    reason: ''
  }
}

export function applyMetadataDetails(
  editor: BoardGameEditor,
  details: BoardGameMetadataDetails,
  imagesEnabled: boolean
): BoardGameEditor {
  const chineseAlternate = details.alternateNames.find((name) =>
    CJK_PATTERN.test(name)
  )
  const name = chineseAlternate ?? (CJK_PATTERN.test(editor.name)
    ? editor.name
    : '')
  return {
    ...editor,
    name,
    categories: details.categories.join('、'),
    minPlayers: String(details.minPlayers),
    maxPlayers: String(details.maxPlayers),
    minMinutes:
      details.minMinutes === null ? '' : String(details.minMinutes),
    maxMinutes:
      details.maxMinutes === null ? '' : String(details.maxMinutes),
    complexityRating:
      details.complexityRating === null
        ? ''
        : String(details.complexityRating),
    imageUrl: imagesEnabled
      ? details.imageUrl ?? details.thumbnailUrl ?? editor.imageUrl
      : editor.imageUrl,
    bggId: details.externalId,
    metadataSource: details.source,
    metadataImportedAt: details.fetchedAt
  }
}

function parseInteger(
  value: string,
  label: string,
  optional = false
): number | undefined {
  const normalized = value.trim()
  if (optional && !normalized) return undefined
  if (!/^\d+$/.test(normalized)) throw new Error(`${label}必须是整数`)
  const result = Number(normalized)
  if (!Number.isSafeInteger(result)) throw new Error(`${label}超出范围`)
  return result
}

function parseComplexity(value: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^(?:[0-4](?:\.\d)?|5(?:\.0)?)$/.test(normalized)) {
    throw new Error('复杂度必须是 0.0–5.0，且最多一位小数')
  }
  return Number(normalized)
}

export function parseMissingParts(
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

export function boardGameRequest(
  editor: BoardGameEditor
): CreateBoardGameRequest {
  const minMinutes = parseInteger(editor.minMinutes, '最短时长', true)
  const maxMinutes = parseInteger(editor.maxMinutes, '最长时长', true)
  const bggId = parseInteger(editor.bggId, 'BGG 编号', true)
  const complexityRating = parseComplexity(editor.complexityRating)
  const quantity = parseInteger(editor.quantity, '库存数量') ?? 0
  const missingParts = parseMissingParts(editor.missingParts)
  if (editor.missingPieces && missingParts.length === 0) {
    throw new Error('勾选缺件后，请填写至少一条缺件名称和数量')
  }
  if (!editor.private && editor.available && quantity > 0 && complexityRating === undefined) {
    throw new Error('公开且可用的桌游必须填写复杂度')
  }
  const hasImportedMetadata =
    bggId !== undefined &&
    editor.metadataSource === 'bgg' &&
    Number.isFinite(Date.parse(editor.metadataImportedAt))
  return {
    name: editor.name,
    introduction: editor.introduction,
    categories: editor.categories
      .split(/[、，,\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    minPlayers: parseInteger(editor.minPlayers, '最少人数') ?? 1,
    maxPlayers: parseInteger(editor.maxPlayers, '最多人数') ?? 1,
    ...(minMinutes === undefined ? {} : { minMinutes }),
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    ...(complexityRating === undefined ? {} : { complexityRating }),
    quantity,
    available: editor.available,
    customerConsigned: editor.customerConsigned,
    missingPieces: editor.missingPieces,
    private: editor.private,
    recommended: editor.recommended,
    ...(editor.imageUrl.trim() ? { imageUrl: editor.imageUrl.trim() } : {}),
    ...(editor.localImagePath ? { localImagePath: editor.localImagePath } : {}),
    ...(bggId === undefined ? {} : { bggId }),
    ...(hasImportedMetadata
      ? {
          metadataSource: 'bgg' as const,
          metadataImportedAt: new Date(editor.metadataImportedAt).toISOString()
        }
      : {}),
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
