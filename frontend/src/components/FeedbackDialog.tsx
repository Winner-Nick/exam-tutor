import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../api'
import { collectDiag } from '../utils/diagnostics'
import { Icon } from './Icon'
import { useToast } from './Toast'

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const location = useLocation()
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = useMutation({
    mutationFn: () => api.sendFeedback(message.trim(), location.pathname, collectDiag()),
    onSuccess: () => {
      toast('已收到反馈，谢谢！')
      onClose()
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '提交失败，请重试', 'error'),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="pop-in card max-h-full w-full max-w-md overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 font-serif text-lg font-bold">
          <Icon name="megaphone" size={18} className="text-primary-600 dark:text-primary-400" />
          问题反馈
        </h3>
        <p className="mt-1 text-xs text-dim">
          提交时会自动附上当前页面与设备信息（机型、浏览器内核、近期报错），帮助快速定位问题。
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="描述你遇到的问题，比如：哪个页面、点了什么、看到了什么（选填）"
          className="input mt-3"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
            取消
          </button>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            className="btn-primary px-5 py-2 text-sm"
          >
            {submit.isPending ? '提交中…' : '提交反馈'}
          </button>
        </div>
      </div>
    </div>
  )
}
