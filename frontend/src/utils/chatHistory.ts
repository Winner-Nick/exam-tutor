import type { ChatMessage } from '../types'

export function mergeChatMessages(current: ChatMessage[], older: ChatMessage[]) {
  const seen = new Set(
    current.filter((message) => message.id != null).map((message) => String(message.id)),
  )
  const prefix: ChatMessage[] = []

  for (const message of older) {
    if (message.id == null) {
      prefix.push(message)
      continue
    }
    const key = String(message.id)
    if (seen.has(key)) continue
    seen.add(key)
    prefix.push(message)
  }

  return [...prefix, ...current]
}
