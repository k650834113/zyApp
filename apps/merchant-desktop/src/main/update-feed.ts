export function desktopUpdateFeedUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Cloud base URL is required')
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Update feed must use HTTP or HTTPS')
  }
  return `${normalized}/v1/desktop-updates/windows`
}
