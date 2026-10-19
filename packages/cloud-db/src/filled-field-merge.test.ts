import { describe, expect, it } from 'vitest'
import { canMergeFilledField, mergeFilledField } from './filled-field-merge'
describe('filled descriptive fields win', () => {
  it.each([null, undefined, '', '   '])('fills either empty side (%s)', empty => {
    expect(canMergeFilledField('member','note',empty,'filled')).toBe(true)
    expect(mergeFilledField(empty,'filled')).toBe('filled')
    expect(canMergeFilledField('member','note','filled',empty)).toBe(true)
    expect(mergeFilledField('filled',empty)).toBe('filled')
  })
  it('keeps different filled values for review and preserves zero/false', () => {
    expect(canMergeFilledField('member','nickname','Alice','Bob')).toBe(false)
    expect(canMergeFilledField('member','note',0,false)).toBe(false)
    expect(canMergeFilledField('wallet','principalBalanceFen',null,10)).toBe(false)
    expect(canMergeFilledField('employee','role',null,'manager')).toBe(false)
    expect(canMergeFilledField('member','tier',null,'advanced')).toBe(false)
    expect(canMergeFilledField('catalog','regularPriceFen',null,100)).toBe(false)
  })
  it('fills empty tags without combining two populated lists', () => {
    expect(canMergeFilledField('board_game','tags',[],['strategy'])).toBe(true)
    expect(mergeFilledField(['strategy'],[])).toEqual(['strategy'])
    expect(canMergeFilledField('board_game','tags',['party'],['strategy'])).toBe(false)
  })
})
