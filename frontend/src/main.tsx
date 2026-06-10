import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installErrorBuffer } from './utils/diagnostics'

// 全局错误缓冲：随「问题反馈」自动上报最近的 JS 报错
installErrorBuffer()

// 渲染前套用主题（CSP 禁止内联脚本，所以放在打包入口里）
{
  const t = localStorage.getItem('et-theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
