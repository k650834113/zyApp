import type { DataEnvironment } from '@zyapp/contracts'

export type PublicEndpointConfiguration = {
  desktopProductionApiBaseUrl: string
  desktopTestApiBaseUrl: string
  miniappTestApiBaseUrl: string
  miniappTestStoreId: string
}

declare const __ZYAPP_PUBLIC_ENDPOINTS__:
  | PublicEndpointConfiguration
  | undefined

const EMPTY_PUBLIC_ENDPOINTS: PublicEndpointConfiguration = {
  desktopProductionApiBaseUrl: '',
  desktopTestApiBaseUrl: '',
  miniappTestApiBaseUrl: '',
  miniappTestStoreId: ''
}

export function publicEndpointConfiguration(): PublicEndpointConfiguration {
  return typeof __ZYAPP_PUBLIC_ENDPOINTS__ === 'undefined'
    ? EMPTY_PUBLIC_ENDPOINTS
    : __ZYAPP_PUBLIC_ENDPOINTS__
}

export function configuredCloudBaseUrl(
  environment: DataEnvironment,
  configuration: PublicEndpointConfiguration = publicEndpointConfiguration()
): string {
  return environment === 'production'
    ? configuration.desktopProductionApiBaseUrl.trim()
    : configuration.desktopTestApiBaseUrl.trim()
}
