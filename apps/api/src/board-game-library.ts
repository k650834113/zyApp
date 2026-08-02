import { BadRequestException } from '@nestjs/common'
import type {
  PublicBoardGameFilters,
  SetBoardGameLikeRequest
} from '@zyapp/contracts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(
      `${label}必须是 ${minimum}–${maximum} 的整数`
    )
  }
  return parsed
}

function optionalComplexity(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 5 ||
    !Number.isInteger(parsed * 10)
  ) {
    throw new BadRequestException('复杂度必须是 0.0–5.0 的一位小数')
  }
  return parsed
}

function categories(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const source = Array.isArray(value) ? value : [value]
  const normalized = [
    ...new Set(
      source.map((item) => {
        if (typeof item !== 'string') {
          throw new BadRequestException('分类必须是文本')
        }
        const tag = item.trim()
        if (!tag || tag.length > 40) {
          throw new BadRequestException('分类长度必须是 1–40 个字符')
        }
        return tag
      })
    )
  ]
  if (normalized.length > 10) {
    throw new BadRequestException('分类最多选择 10 项')
  }
  return normalized.length > 0 ? normalized : undefined
}

function assertRange(
  minimum: number | undefined,
  maximum: number | undefined,
  label: string
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new BadRequestException(`${label}起始值不能大于结束值`)
  }
}

export function normalizePublicBoardGameFilters(
  raw: Record<string, unknown>
): PublicBoardGameFilters {
  const query =
    typeof raw.query === 'string' ? raw.query.trim().slice(0, 100) : ''
  const selectedCategories = categories(raw.categories)
  const minPlayers = optionalInteger(raw.minPlayers, '最少人数', 1, 100)
  const maxPlayers = optionalInteger(raw.maxPlayers, '最多人数', 1, 100)
  const minMinutes = optionalInteger(raw.minMinutes, '最短时长', 1, 1_440)
  const maxMinutes = optionalInteger(raw.maxMinutes, '最长时长', 1, 1_440)
  const minComplexity = optionalComplexity(raw.minComplexity)
  const maxComplexity = optionalComplexity(raw.maxComplexity)

  assertRange(minPlayers, maxPlayers, '人数范围')
  assertRange(minMinutes, maxMinutes, '时长范围')
  assertRange(minComplexity, maxComplexity, '复杂度范围')

  return {
    ...(query ? { query } : {}),
    ...(selectedCategories ? { categories: selectedCategories } : {}),
    ...(minPlayers === undefined ? {} : { minPlayers }),
    ...(maxPlayers === undefined ? {} : { maxPlayers }),
    ...(minMinutes === undefined ? {} : { minMinutes }),
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    ...(minComplexity === undefined ? {} : { minComplexity }),
    ...(maxComplexity === undefined ? {} : { maxComplexity })
  }
}

export function normalizeBoardGameId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new BadRequestException('boardGameId must be a UUID')
  }
  return value.trim().toLowerCase()
}

export function normalizeSetBoardGameLikeRequest(
  value: unknown
): SetBoardGameLikeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Like request must be an object')
  }
  const input = value as Record<string, unknown>
  if (typeof input.liked !== 'boolean') {
    throw new BadRequestException('liked must be boolean')
  }
  if (typeof input.requestId !== 'string') {
    throw new BadRequestException('requestId must be text')
  }
  const requestId = input.requestId.trim()
  if (requestId.length < 8 || requestId.length > 100) {
    throw new BadRequestException('requestId must contain 8 to 100 characters')
  }
  return { liked: input.liked, requestId }
}
