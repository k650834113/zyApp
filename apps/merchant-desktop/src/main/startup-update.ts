import type { ApplicationUpdateStatus } from '@zyapp/contracts'

export async function checkStartupUpdate(deps: {
  check(): Promise<ApplicationUpdateStatus>
  ignored(): string[]
  ignore(key: string): void
  ask(status: ApplicationUpdateStatus): Promise<'update' | 'ignore' | 'later'>
  download(): Promise<ApplicationUpdateStatus>
  install(): Promise<void>
}): Promise<void> {
  const status = await deps.check()
  if (status.state !== 'available' || !status.availableVersion) return
  const key = `${status.feedUrl}:${status.availableVersion}`
  if (deps.ignored().includes(key)) return
  const choice = await deps.ask(status)
  if (choice === 'ignore') deps.ignore(key)
  if (choice !== 'update') return
  const downloaded = await deps.download()
  if (downloaded.state === 'downloaded') await deps.install()
}
