import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from './RouteErrorBoundary'

function renderError(error: unknown) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <div>正常页面</div>,
      errorElement: <RouteErrorBoundary />,
      loader: () => { throw error },
    },
  ])
  return render(<RouterProvider router={router} />)
}

it('offers a reload when an outdated page module cannot be loaded', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  renderError(new Error('Failed to fetch dynamically imported module: /assets/GuidePage-old.js'))

  expect(await screen.findByRole('heading', { name: '应用内容已更新' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
})

it('contains other page failures instead of leaving a blank screen', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  renderError(new Error('unexpected render failure'))

  expect(await screen.findByRole('heading', { name: '页面暂时无法打开' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toBeInTheDocument()
})
