import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

const sensitiveKeyPattern = /password|secret|token|api[-_]?key|phone|mobile/i
const mainlandPhonePattern = /(?<!\d)1\d{10}(?!\d)/g

export function shanghaiDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function redactLogValue(value: unknown, key = ''): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return '[REDACTED]'
  }

  if (typeof value === 'string') {
    return value.replace(mainlandPhonePattern, (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactLogValue(childValue, childKey)
      ])
    )
  }

  return value
}

export function createFileLogger(directory: string): {
  filePath: string
  write(level: LogLevel, event: string, context?: LogContext): void
} {
  mkdirSync(directory, { recursive: true })
  const date = shanghaiDateStamp(new Date())
  const filePath = join(directory, `zyapp-${date}.log`)

  return {
    filePath,
    write(level, event, context = {}) {
      const record = {
        timestamp: new Date().toISOString(),
        level,
        event,
        context: redactLogValue(context)
      }
      appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
    }
  }
}
