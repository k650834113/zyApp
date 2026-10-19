/** Preserve an ambiguous operation's identity when the cashier clicks retry. */
export class FinancialRetry {
  private pending = new Map<string, string>()
  async run<T>(method: string, request: Record<string, unknown>, execute: (request: Record<string, unknown>) => Promise<T>): Promise<T> {
    const { requestId, ...body } = request
    const key = JSON.stringify([method, body])
    const id = this.pending.get(key) ?? (typeof requestId === 'string' && requestId ? requestId : crypto.randomUUID())
    this.pending.set(key, id)
    const result = await execute({ ...request, requestId: id })
    this.pending.delete(key)
    return result
  }
  clear(): void { this.pending.clear() }
}
