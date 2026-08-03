import { XMLParser } from 'fast-xml-parser'
import type {
  BoardGameMetadataCandidate,
  BoardGameMetadataDetails
} from '@zyapp/contracts'
import { localizeBggLabel } from './category-map'

type JsonObject = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true
})

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`BGG ${name} is malformed`)
  }
  return value as JsonObject
}

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`BGG ${name} is invalid`)
  }
  return parsed
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function nullableDuration(value: unknown): number | null {
  const parsed = nullableInteger(value)
  return parsed === null || parsed === 0 ? null : parsed
}

function attribute(objectValue: JsonObject, name: string): unknown {
  return objectValue[`@_${name}`]
}

function valueAttribute(parent: JsonObject, key: string): unknown {
  const child = parent[key]
  return child && typeof child === 'object' && !Array.isArray(child)
    ? attribute(child as JsonObject, 'value')
    : undefined
}

function boundedText(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`BGG ${name} is missing`)
  }
  return value.trim().slice(0, maximum)
}

function itemNames(item: JsonObject): {
  primaryName: string
  alternateNames: string[]
} {
  const names = array(item.name).map((value, index) =>
    object(value, `name ${index + 1}`)
  )
  const primary = names.find((name) => attribute(name, 'type') === 'primary')
  const primaryName = boundedText(
    primary ? attribute(primary, 'value') : undefined,
    'primary name'
  )
  const alternateNames = [...new Set(
    names
      .filter((name) => attribute(name, 'type') === 'alternate')
      .map((name) => boundedText(attribute(name, 'value'), 'alternate name'))
      .filter((name) => name !== primaryName)
  )].slice(0, 20)
  return { primaryName, alternateNames }
}

function boardGameItems(xml: string): JsonObject[] {
  let root: JsonObject
  try {
    root = object(parser.parse(xml), 'response')
  } catch (error) {
    throw new Error(
      `BGG XML is malformed: ${error instanceof Error ? error.message : 'parse failed'}`
    )
  }
  const items = object(root.items, 'items')
  const values = array(items.item)
  return values.map((value, index) => {
    const item = object(value, `item ${index + 1}`)
    if (attribute(item, 'type') !== 'boardgame') {
      throw new Error('BGG item must be a board game')
    }
    positiveInteger(attribute(item, 'id'), 'item id')
    return item
  })
}

function candidate(item: JsonObject): BoardGameMetadataCandidate {
  const id = positiveInteger(attribute(item, 'id'), 'item id')
  return {
    source: 'bgg',
    externalId: String(id),
    ...itemNames(item),
    yearPublished: nullableInteger(valueAttribute(item, 'yearpublished'))
  }
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function linkedLabels(item: JsonObject, type: string): string[] {
  const values = array(item.link)
    .map((value, index) => object(value, `link ${index + 1}`))
    .filter((link) => attribute(link, 'type') === type)
    .map((link) => boundedText(attribute(link, 'value'), `${type} label`, 100))
    .map(localizeBggLabel)
  return [...new Set(values)].slice(0, 20)
}

function complexity(item: JsonObject): number | null {
  const statistics = item.statistics
  if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics)) {
    return null
  }
  const ratings = (statistics as JsonObject).ratings
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) {
    return null
  }
  const raw = valueAttribute(ratings as JsonObject, 'averageweight')
  const parsed = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) return null
  return Math.round(parsed * 10) / 10
}

export function parseBggSearchXml(xml: string): BoardGameMetadataCandidate[] {
  return boardGameItems(xml).map(candidate).slice(0, 100)
}

export function parseBggThingXml(
  xml: string,
  options: { imagesEnabled: boolean; fetchedAt?: string } = {
    imagesEnabled: false
  }
): BoardGameMetadataDetails {
  const item = boardGameItems(xml)[0]
  if (!item) throw new Error('BGG board game was not found')
  const result = candidate(item)
  const minPlayers = positiveInteger(
    valueAttribute(item, 'minplayers'),
    'minimum players'
  )
  const maxPlayers = positiveInteger(
    valueAttribute(item, 'maxplayers'),
    'maximum players'
  )
  if (maxPlayers < minPlayers) {
    throw new Error('BGG maximum players is smaller than minimum players')
  }
  return {
    ...result,
    minPlayers,
    maxPlayers,
    minMinutes: nullableDuration(valueAttribute(item, 'minplaytime')),
    maxMinutes: nullableDuration(valueAttribute(item, 'maxplaytime')),
    complexityRating: complexity(item),
    categories: linkedLabels(item, 'boardgamecategory'),
    mechanics: linkedLabels(item, 'boardgamemechanic'),
    thumbnailUrl: options.imagesEnabled ? safeImageUrl(item.thumbnail) : null,
    imageUrl: options.imagesEnabled ? safeImageUrl(item.image) : null,
    sourceUrl: `https://boardgamegeek.com/boardgame/${result.externalId}`,
    fetchedAt: options.fetchedAt ?? new Date().toISOString()
  }
}
