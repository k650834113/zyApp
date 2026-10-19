import { expect, it } from 'vitest'
import { MemberSelection } from './member-selection'

it('rejects late responses after A → B → A and after switching to a guest', () => {
  const selection = new MemberSelection()
  const a = selection.select('A')
  const b = selection.select('B')
  const newest = selection.select('A')
  expect(selection.accepts(a, 'A')).toBe(false)
  expect(selection.accepts(b, 'B')).toBe(false)
  expect(selection.accepts(newest, 'A')).toBe(true)
  selection.select(null)
  expect(selection.accepts(newest, 'A')).toBe(false)
})
