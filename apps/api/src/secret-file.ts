import { readFileSync } from 'node:fs'

export function readSingleLineSecret(
  path: string,
  name: string,
  expectedLength?: number
): string {
  const content = readFileSync(path, 'utf8')
  const value = content.endsWith('\r\n')
    ? content.slice(0, -2)
    : content.endsWith('\n')
      ? content.slice(0, -1)
      : content

  if (!value || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${name} must contain exactly one non-empty single line`)
  }
  if (value.trim() !== value) {
    throw new Error(`${name} must not contain leading or trailing whitespace`)
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new Error(`${name} must contain exactly ${expectedLength} characters`)
  }
  return value
}
