import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../api'
import { collectDiag } from '../utils/diagnostics'
import { Dialog } from './Dialog'
import { useToast } from './Toast'

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const location = useLocation()
  const [message, setMessage] = useState('')
  const submit = useMutation({
    mutationFn: () => api.sendFeedback(message.trim(), `${location.pathname}${location.search}`, collectDiag()),
    onSuccess: () => {
      toast('已收到反馈，谢谢！')
      onClose()
    },
    onError: (error) => toast(error instanceof ApiError ? error.message : '提交失败，请重试', 'error'),
  })

  return (
    <Dialog title="问题反馈" onClose={onClose} hideClose={submit.isPending} preventClose={submit.isPending}>
      <p className="text-sm leading-relaxed text-ink2">
        提交时会附上当前页面与设备信息（机型、浏览器内核、近期报错），帮助定位问题。
      </p>
      <label className="mt-3 block text-sm font-medium text-ink2">
        问题描述
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          maxLength={2000}
          autoFocus
          placeholder="哪个页面、点了什么、看到了什么（选填）"
          className="input mt-1"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={submit.isPending} className="btn-ghost px-4">取消</button>
        <button onClick={() => submit.mutate()} disabled={submit.isPending} className="btn-primary px-5">
          {submit.isPending ? '提交中…' : '提交反馈'}
        </button>
      </div>
    </Dialog>
  )
}
