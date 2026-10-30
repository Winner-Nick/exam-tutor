/// <reference types="vite/client" />

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installErrorBuffer } from './utils/diagnostics'
import { installModuleRecovery } from './utils/moduleRecovery'

// 全局错误缓冲：随「问题反馈」自动上报最近的 JS 报错
installErrorBuffer()
installModuleRecovery()

// 渲染前套用主题（CSP 禁止内联脚本，所以放在打包入口里）
{
  const t = localStorage.getItem('et-theme')
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151915' : '#f6f6f1')
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
