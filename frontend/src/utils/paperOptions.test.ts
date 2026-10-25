import { describe, expect, it } from 'vitest'
import { optionsText, parseOptions } from './paperOptions'

describe('paper options', () => {
  it('round-trips multiline values without losing continuation lines', () => {
    const original = {
      A: '第一行\n第二行\n  保留缩进\nB. 仍是 A 的续行',
      B: '另一个选项\n最后一行\n',
    }

    const text = optionsText(original)

    expect(text).toContain('A. 第一行\n  第二行\n    保留缩进\n  B. 仍是 A 的续行')
    expect(parseOptions(text)).toEqual({ options: original, error: null })
  })

  it('accepts indented and unindented continuation lines', () => {
    expect(parseOptions('A. one\ncontinued\n  again\nB、two\n\tnext')).toEqual({
      options: { A: 'one\ncontinued\nagain', B: 'two\nnext' },
      error: null,
    })
  })

  it('reports text before the first option instead of silently dropping it', () => {
    const result = parseOptions('无法识别的内容\nA. one')
    expect(result.options).toBeNull()
    expect(result.error).toContain('第 1 行无法解析')
  })

  it('reports duplicate option keys instead of overwriting one', () => {
    const result = parseOptions('A. one\nA. two')
    expect(result.options).toBeNull()
    expect(result.error).toContain('选项 A 重复')
  })

  it('keeps blank input as no options', () => {
    expect(parseOptions(' \n\t')).toEqual({ options: null, error: null })
    expect(optionsText(null)).toBe('')
  })
})
