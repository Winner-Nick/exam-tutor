import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { Icon } from './Icon'

const MODULE_ERROR = /dynamically imported module|module script failed|loading chunk|preload error/i

export function RouteErrorBoundary() {
  const error = useRouteError()
  const moduleChanged = error instanceof Error && MODULE_ERROR.test(error.message)
  const missing = isRouteErrorResponse(error) && error.status === 404

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-16">
      <section className="card w-full px-5 py-12 text-center" role="alert">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
          <Icon name={moduleChanged ? 'refresh' : 'alert'} size={28} />
        </span>
        <h1 className="mt-5 font-serif text-2xl font-bold text-ink">
          {moduleChanged ? '应用内容已更新' : missing ? '页面不存在' : '页面暂时无法打开'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-dim">
          {moduleChanged
            ? '请重新载入当前页面，即可继续使用最新版。'
            : missing
              ? '链接可能已失效，请返回首页继续操作。'
              : '这次操作未能完成。你可以重新加载页面，或先返回首页。'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={() => window.location.reload()} className="btn-primary px-5">
            <Icon name="refresh" size={16} />重新加载
          </button>
          <Link to="/" className="btn-outline px-5">返回首页</Link>
        </div>
      </section>
    </main>
  )
}
