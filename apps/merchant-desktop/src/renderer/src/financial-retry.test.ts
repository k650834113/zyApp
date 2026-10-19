import { expect, it } from 'vitest'
import { FinancialRetry } from './financial-retry'

it('reuses the operation id after a lost reply, then allows a new sale after confirmation', async () => {
  const retry = new FinancialRetry()
  await expect(retry.run('debit', {requestId:'first',memberId:'a',amount:100}, async () => {throw new Error('reply lost')})).rejects.toThrow()
  expect(await retry.run('debit', {requestId:'second',memberId:'a',amount:100}, async request=>request.requestId)).toBe('first')
  expect(await retry.run('debit', {requestId:'third',memberId:'a',amount:100}, async request=>request.requestId)).toBe('third')
  expect(await retry.run('debit', {requestId:'fourth',memberId:'b',amount:100}, async request=>request.requestId)).toBe('fourth')
})
