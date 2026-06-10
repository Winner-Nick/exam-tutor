import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ breaks: true, gfm: true })

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }) as string),
    [text],
  )
  return <div className={`md text-sm ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
