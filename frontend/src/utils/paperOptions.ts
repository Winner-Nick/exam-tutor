export interface ParsedOptions {
  options: Record<string, string> | null
  error: string | null
}

export function optionsText(options: Record<string, string> | null) {
  return Object.entries(options ?? {}).map(([key, value]) => {
    const [first = '', ...rest] = value.replace(/\r\n?/g, '\n').split('\n')
    return `${key}. ${first}${rest.map((line) => `\n  ${line}`).join('')}`
  }).join('\n')
}

export function parseOptions(value: string): ParsedOptions {
  if (!value.trim()) return { options: null, error: null }

  const options: Record<string, string> = {}
  let current: string | null = null
  const lines = value.replace(/\r\n?/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^([^.\s]+)\s*[.、．:：][ \t]?(.*)$/)
    if (match) {
      const [, key, text] = match
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        return { options: null, error: `选项 ${key} 重复，请合并或更正后再保存。` }
      }
      options[key] = text
      current = key
      continue
    }
    if (!current) {
      if (!line.trim()) continue
      return { options: null, error: `第 ${index + 1} 行无法解析，请以“A. 选项内容”的格式开始。` }
    }
    const continuation = line.startsWith('  ')
      ? line.slice(2)
      : line.startsWith(' ') || line.startsWith('\t') ? line.slice(1) : line
    options[current] += `\n${continuation}`
  }

  return Object.keys(options).length
    ? { options, error: null }
    : { options: null, error: '未识别到选项，请使用“A. 选项内容”的格式，或留空。' }
}
