import type {
  BoardGameMetadataAvailability,
  BoardGameMetadataCandidate,
  BoardGameMetadataDetails,
  BoardGameMetadataDetailsRequest,
  BusinessTemplateSummary,
  CashierCommandExecution,
  CashierCommandSummary,
  CloudMirrorPage,
  CloudMirrorResource,
  CreateTenantStoreRequest,
  CreateTenantStoreResult,
  DataEnvironment,
  DesktopCloudLoginResult,
  EmployeeStoreAccessSummary,
  EmployeeFinancialCommandExecution,
  EmployeeFinancialCommandResult,
  EmployeeFinancialCommandSummary,
  OfflineFinancialLeaseStatus,
  SalesOrderSummary,
  SaveBusinessTemplateOverrideRequest,
  SaveBusinessTemplateRequest,
  SetEmployeeStoreAccessRequest,
  TenantStoreAdminSummary
} from '@zyapp/contracts'
import type {
  SyncCommandResult,
  SyncOperation,
  SyncPullResult,
  SyncPushBatch,
  SyncPushResult,
  SyncReceiveResult
} from '@zyapp/sync-protocol'
import {
  normalizeCloudBaseUrl,
  type CloudConnection
} from './cloud-connection'

type Fetch = typeof fetch

const DEFAULT_CLOUD_REQUEST_TIMEOUT_MILLISECONDS = 10_000
const BOARD_GAME_METADATA_REQUEST_TIMEOUT_MILLISECONDS = 25_000

export class CloudRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CloudRequestError'
  }
}

export type CloudDeviceEnrollmentRequest = {
  environment: DataEnvironment
  baseUrl: string
  enrollmentSecret: string
  tenantId: string
  storeId: string
  deviceId: string
  storeName: string
  deviceName: string
}

export type CloudDeviceEnrollmentResult = {
  environment: DataEnvironment
  tenantId: string
  storeId: string
  deviceId: string
  deviceName: string
  token: string
}

export type PairedCloudDeviceEnrollmentResult = CloudDeviceEnrollmentResult & {
  storeName: string
  epochId: string
  manager: {
    id: string
    username: string
    displayName: string
    status: 'active'
    createdAt: string
    updatedAt: string
  }
}

async function responseJson<T>(
  response: Response,
  options: { allowEmpty?: boolean } = {}
): Promise<T> {
  const responseText = await response.text()
  let body: unknown = null
  if (responseText.length > 0) {
    try {
      body = JSON.parse(responseText) as unknown
    } catch {
      throw new Error(`Cloud request returned invalid JSON (HTTP ${response.status})`)
    }
  }
  if (!response.ok) {
    const reason =
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : `Cloud request failed with HTTP ${response.status}`
    throw new CloudRequestError(reason, response.status)
  }
  if (responseText.length === 0 && !options.allowEmpty) {
    throw new Error(`Cloud request returned an empty response (HTTP ${response.status})`)
  }
  return body as T
}

function headers(connection: CloudConnection): Record<string, string> {
  return {
    authorization: `Bearer ${connection.token}`,
    'content-type': 'application/json',
    'x-zyapp-device-id': connection.deviceId
  }
}

export async function enrollCloudDevice(
  request: CloudDeviceEnrollmentRequest,
  fetchImpl: Fetch = fetch
): Promise<CloudDeviceEnrollmentResult> {
  const baseUrl = normalizeCloudBaseUrl(request.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/devices/enroll`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zyapp-enrollment-secret': request.enrollmentSecret
    },
    body: JSON.stringify({
      environment: request.environment,
      tenantId: request.tenantId,
      storeId: request.storeId,
      deviceId: request.deviceId,
      storeName: request.storeName,
      deviceName: request.deviceName
    }),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson<CloudDeviceEnrollmentResult>(response)
}

export async function createCloudDevicePairingCode(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<{ code: string; expiresAt: string; storeName: string }> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/devices/pairing-codes`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify({ actorId }),
    signal: AbortSignal.timeout(10_000)
  })
  return responseJson(response)
}

export async function enrollPairedCloudDevice(
  request: {
    environment: DataEnvironment
    baseUrl: string
    pairingCode: string
    deviceId: string
    deviceName: string
    requestId?: string
  },
  fetchImpl: Fetch = fetch
): Promise<PairedCloudDeviceEnrollmentResult> {
  const baseUrl = normalizeCloudBaseUrl(request.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/devices/enroll-paired`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      environment: request.environment,
      pairingCode: request.pairingCode,
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      requestId: request.requestId
    }),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson(response)
}

export async function enrollAuthorizedCloudStore(
  request: {
    environment: DataEnvironment
    baseUrl: string
    activationCode: string
    deviceId: string
    deviceName: string
    requestId: string
  },
  fetchImpl: Fetch = fetch
): Promise<PairedCloudDeviceEnrollmentResult> {
  const baseUrl = normalizeCloudBaseUrl(request.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/devices/enroll-authorized-store`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      environment: request.environment,
      activationCode: request.activationCode,
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      requestId: request.requestId
    }),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson(response)
}

export async function listTenantStores(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<TenantStoreAdminSummary[]> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/stores?actorId=${encodeURIComponent(actorId)}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(DEFAULT_CLOUD_REQUEST_TIMEOUT_MILLISECONDS)
    }
  )
  return responseJson(response)
}

export async function getCloudBoardGameMetadataStatus(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<BoardGameMetadataAvailability> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/board-game-metadata/status?actorId=${encodeURIComponent(actorId)}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(DEFAULT_CLOUD_REQUEST_TIMEOUT_MILLISECONDS)
    }
  )
  return responseJson(response)
}

export async function searchCloudBoardGameMetadata(
  connection: CloudConnection,
  actorId: string,
  request: { query: string },
  fetchImpl: Fetch = fetch
): Promise<BoardGameMetadataCandidate[]> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/board-game-metadata/search?actorId=${encodeURIComponent(actorId)}&query=${encodeURIComponent(request.query)}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(BOARD_GAME_METADATA_REQUEST_TIMEOUT_MILLISECONDS)
    }
  )
  return responseJson(response)
}

export async function getCloudBoardGameMetadataDetails(
  connection: CloudConnection,
  actorId: string,
  request: BoardGameMetadataDetailsRequest,
  fetchImpl: Fetch = fetch
): Promise<BoardGameMetadataDetails> {
  if (request.source !== 'bgg' || !/^[1-9]\d*$/.test(request.externalId)) {
    throw new TypeError('BGG metadata request is invalid')
  }
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/board-game-metadata/bgg/${encodeURIComponent(request.externalId)}?actorId=${encodeURIComponent(actorId)}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(BOARD_GAME_METADATA_REQUEST_TIMEOUT_MILLISECONDS)
    }
  )
  return responseJson(response)
}

export async function createTenantStore(
  connection: CloudConnection,
  actorId: string,
  request: CreateTenantStoreRequest,
  fetchImpl: Fetch = fetch
): Promise<CreateTenantStoreResult> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/stores?actorId=${encodeURIComponent(actorId)}`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson(response)
}

export async function listEmployeeStoreAccess(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<EmployeeStoreAccessSummary[]> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/employee-store-access?actorId=${encodeURIComponent(actorId)}`,
    { headers: headers(connection), signal: AbortSignal.timeout(10_000) }
  )
  return responseJson(response)
}

export async function setEmployeeStoreAccess(
  connection: CloudConnection,
  actorId: string,
  request: SetEmployeeStoreAccessRequest,
  fetchImpl: Fetch = fetch
): Promise<EmployeeStoreAccessSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/employee-store-access?actorId=${encodeURIComponent(actorId)}`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson(response)
}

export async function listBusinessTemplates(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<BusinessTemplateSummary[]> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/business-templates?actorId=${encodeURIComponent(actorId)}`,
    { headers: headers(connection), signal: AbortSignal.timeout(10_000) }
  )
  return responseJson(response)
}

export async function saveBusinessTemplate(
  connection: CloudConnection,
  actorId: string,
  request: SaveBusinessTemplateRequest,
  fetchImpl: Fetch = fetch
): Promise<BusinessTemplateSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/business-templates?actorId=${encodeURIComponent(actorId)}`,
    { method: 'POST', headers: headers(connection), body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000) }
  )
  return responseJson(response)
}

export async function saveBusinessTemplateOverride(
  connection: CloudConnection,
  actorId: string,
  request: SaveBusinessTemplateOverrideRequest,
  fetchImpl: Fetch = fetch
): Promise<BusinessTemplateSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/tenant-admin/business-template-overrides?actorId=${encodeURIComponent(actorId)}`,
    { method: 'POST', headers: headers(connection), body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000) }
  )
  return responseJson(response)
}

export async function loginDesktopEmployee(
  connection: CloudConnection,
  request: { username: string; password: string },
  fetchImpl: Fetch = fetch
): Promise<DesktopCloudLoginResult> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/desktop-auth/login`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson<DesktopCloudLoginResult>(response)
}

export async function pushCloudSyncBatch(
  connection: CloudConnection,
  batch: SyncPushBatch,
  fetchImpl: Fetch = fetch
): Promise<SyncReceiveResult> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/sync/push`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson<SyncReceiveResult>(response)
}

export async function getCloudSyncResults(
  connection: CloudConnection,
  afterDeviceSeq: number,
  limit = 100,
  fetchImpl: Fetch = fetch
): Promise<SyncPushResult> {
  if (!Number.isSafeInteger(afterDeviceSeq) || afterDeviceSeq < 0) {
    throw new RangeError('afterDeviceSeq must be a non-negative integer')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be between 1 and 500')
  }
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const query = new URLSearchParams({
    afterDeviceSeq: String(afterDeviceSeq),
    limit: String(limit)
  })
  const response = await fetchImpl(
    `${baseUrl}/v1/sync/results?${query.toString()}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<SyncPushResult>(response)
}

export async function getCloudSyncEvents(
  connection: CloudConnection,
  afterCursor: string | null,
  limit = 100,
  fetchImpl: Fetch = fetch
): Promise<SyncPullResult> {
  if (
    afterCursor !== null &&
    !/^(0|[1-9]\d*)$/.test(afterCursor)
  ) {
    throw new RangeError(
      'afterCursor must be a non-negative decimal integer'
    )
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be between 1 and 500')
  }
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const query = new URLSearchParams()
  if (afterCursor !== null) query.set('afterCursor', afterCursor)
  query.set('limit', String(limit))
  const response = await fetchImpl(
    `${baseUrl}/v1/sync/pull?${query.toString()}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<SyncPullResult>(response)
}

export async function submitCloudSyncCommand(
  connection: CloudConnection,
  operation: SyncOperation,
  fetchImpl: Fetch = fetch
): Promise<SyncCommandResult> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/sync/command`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify({
      protocolVersion: 2,
      operation: { ...operation, protocolVersion: 2 }
    }),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson<SyncCommandResult>(response)
}

export async function getCloudOperationOutcome(
  connection: CloudConnection,
  operationId: string,
  fetchImpl: Fetch = fetch
): Promise<SyncCommandResult | null> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/sync/operations/${encodeURIComponent(operationId)}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(10_000)
    }
  )
  if (response.status === 404) return null
  return responseJson<SyncCommandResult>(response)
}

export async function streamCloudEventHints(
  connection: CloudConnection,
  input: {
    signal: AbortSignal
    onCursor(cursor: string): void
  },
  fetchImpl: Fetch = fetch
): Promise<void> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/sync/stream`, {
    headers: {
      ...headers(connection),
      accept: 'text/event-stream'
    },
    signal: input.signal
  })
  if (!response.ok || !response.body) {
    await responseJson<never>(response)
    throw new Error('Cloud event stream returned no body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder
        .decode(chunk.value, { stream: true })
        .replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const message = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = message
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (data) {
          const parsed = JSON.parse(data) as { cursor?: unknown }
          if (
            typeof parsed.cursor === 'string' &&
            /^(0|[1-9]\d*)$/.test(parsed.cursor)
          ) {
            input.onCursor(parsed.cursor)
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function getCloudMirrorPage(
  connection: CloudConnection,
  resource: CloudMirrorResource,
  after: string | null = null,
  limit = 200,
  fetchImpl: Fetch = fetch
): Promise<CloudMirrorPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be between 1 and 500')
  }
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const query = new URLSearchParams({ limit: String(limit) })
  if (after) query.set('after', after)
  const response = await fetchImpl(
    `${baseUrl}/v1/desktop/mirror/${resource}?${query.toString()}`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<CloudMirrorPage>(response)
}

export async function activateEmptyCloudMirrorEpoch(
  connection: CloudConnection,
  input: { epochId: string; archiveSha256: string },
  fetchImpl: Fetch = fetch
): Promise<{
  epochId: string
  activatedAt: string
  firstBusinessWriteAt: string | null
}> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(`${baseUrl}/v1/desktop/mirror/epoch/empty`, {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15_000)
  })
  return responseJson(response)
}

export async function getCurrentCloudMirrorEpoch(
  connection: CloudConnection,
  fetchImpl: Fetch = fetch
): Promise<{
  epochId: string
  activatedAt: string
  firstBusinessWriteAt: string | null
} | null> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/desktop/mirror/epoch/current`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(10_000)
    }
  )
  return responseJson(response, { allowEmpty: true })
}

export async function getOfflineFinancialLease(
  connection: CloudConnection,
  fetchImpl: Fetch = fetch
): Promise<OfflineFinancialLeaseStatus> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/offline-writer-lease`,
    {
      headers: headers(connection),
      signal: AbortSignal.timeout(10_000)
    }
  )
  return responseJson(response)
}

export async function claimOfflineFinancialLease(
  connection: CloudConnection,
  actorId: string,
  fetchImpl: Fetch = fetch
): Promise<OfflineFinancialLeaseStatus> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/offline-writer-lease/claim`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify({ actorId }),
      signal: AbortSignal.timeout(10_000)
    }
  )
  return responseJson(response)
}

export async function renewOfflineFinancialLease(
  connection: CloudConnection,
  fetchImpl: Fetch = fetch
): Promise<OfflineFinancialLeaseStatus> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/offline-writer-lease/renew`,
    {
      method: 'POST',
      headers: headers(connection),
      body: '{}',
      signal: AbortSignal.timeout(10_000)
    }
  )
  return responseJson(response)
}

export async function claimCloudCashierCommand(
  connection: CloudConnection,
  fetchImpl: Fetch = fetch
): Promise<CashierCommandExecution | null> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/cashier-commands/claim`,
    {
      method: 'POST',
      headers: headers(connection),
      body: '{}',
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<CashierCommandExecution | null>(response, {
    allowEmpty: true
  })
}

export async function completeCloudCashierCommand(
  connection: CloudConnection,
  input: {
    commandId: string
    localOrderId: string
    result: SalesOrderSummary
  },
  fetchImpl: Fetch = fetch
): Promise<CashierCommandSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/cashier-commands/${encodeURIComponent(input.commandId)}/complete`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify({
        localOrderId: input.localOrderId,
        result: input.result
      }),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<CashierCommandSummary>(response)
}

export async function failCloudCashierCommand(
  connection: CloudConnection,
  input: {
    commandId: string
    errorMessage: string
  },
  fetchImpl: Fetch = fetch
): Promise<CashierCommandSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/cashier-commands/${encodeURIComponent(input.commandId)}/fail`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify({ errorMessage: input.errorMessage }),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<CashierCommandSummary>(response)
}

export async function claimCloudEmployeeFinancialCommand(
  connection: CloudConnection,
  fetchImpl: Fetch = fetch
): Promise<EmployeeFinancialCommandExecution | null> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/financial-commands/claim`,
    {
      method: 'POST',
      headers: headers(connection),
      body: '{}',
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<EmployeeFinancialCommandExecution | null>(response, {
    allowEmpty: true
  })
}

export async function completeCloudEmployeeFinancialCommand(
  connection: CloudConnection,
  input: {
    commandId: string
    result: EmployeeFinancialCommandResult
  },
  fetchImpl: Fetch = fetch
): Promise<EmployeeFinancialCommandSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/financial-commands/${encodeURIComponent(input.commandId)}/complete`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify({ result: input.result }),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<EmployeeFinancialCommandSummary>(response)
}

export async function failCloudEmployeeFinancialCommand(
  connection: CloudConnection,
  input: {
    commandId: string
    errorMessage: string
  },
  fetchImpl: Fetch = fetch
): Promise<EmployeeFinancialCommandSummary> {
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/devices/financial-commands/${encodeURIComponent(input.commandId)}/fail`,
    {
      method: 'POST',
      headers: headers(connection),
      body: JSON.stringify({ errorMessage: input.errorMessage }),
      signal: AbortSignal.timeout(15_000)
    }
  )
  return responseJson<EmployeeFinancialCommandSummary>(response)
}
