export type LegacyDesktopUpdateRequest = {
  url: string
}

export type LegacyDesktopUpdateResponse = {
  redirect(statusCode: number, path: string): void
}

export function redirectLegacyDesktopUpdate(
  request: LegacyDesktopUpdateRequest,
  response: LegacyDesktopUpdateResponse,
): void {
  const suffix = request.url.startsWith('/') ? request.url : `/${request.url}`
  response.redirect(307, `/v1/desktop-updates/windows${suffix}`)
}
