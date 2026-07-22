const ACCESS_TOKEN_KEY_PREFIX = 'zyapp_access_token'

export function accessTokenStorageKey(
  apiBaseUrl: string,
  storeId: string
): string {
  return `${ACCESS_TOKEN_KEY_PREFIX}:${apiBaseUrl.replace(/\/+$/, '')}:${storeId}`
}
