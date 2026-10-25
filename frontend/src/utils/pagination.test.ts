import { describe, expect, it } from 'vitest'
import { emptyPageTarget } from './pagination'

describe('emptyPageTarget', () => {
  it('returns to the previous page after deleting the only item on a tail page', () => {
    expect(emptyPageTarget(1, 9, 9, 0)).toBe(0)
    expect(emptyPageTarget(2, 18, 9, 0)).toBe(1)
  })

  it('clamps an out-of-range empty page to the last valid page', () => {
    expect(emptyPageTarget(8, 20, 9, 0)).toBe(2)
  })

  it('does not redirect non-empty pages, empty collections, or the first page', () => {
    expect(emptyPageTarget(1, 20, 9, 1)).toBeNull()
    expect(emptyPageTarget(1, 0, 9, 0)).toBeNull()
    expect(emptyPageTarget(0, 20, 9, 0)).toBeNull()
    expect(emptyPageTarget(1, 20, 9, undefined)).toBeNull()
  })
})
