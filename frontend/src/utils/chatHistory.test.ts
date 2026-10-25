import { expect, it } from 'vitest'
import { mergeChatMessages } from './chatHistory'

it('prepends older messages without duplicates or changing order', () => {
  const current = [
    { id: 3, role: 'user' as const, content: '三' },
    { id: 'chat-temp-1', role: 'user' as const, content: '临时' },
  ]
  const older = [
    { id: 1, role: 'user' as const, content: '一' },
    { id: 2, role: 'assistant' as const, content: '二' },
    { id: 3, role: 'user' as const, content: '重复三' },
    { id: 2, role: 'assistant' as const, content: '重复二' },
  ]

  const merged = mergeChatMessages(current, older)

  expect(merged.map((message) => message.id)).toEqual([1, 2, 3, 'chat-temp-1'])
  expect(merged.map((message) => message.content)).toEqual(['一', '二', '三', '临时'])
})
