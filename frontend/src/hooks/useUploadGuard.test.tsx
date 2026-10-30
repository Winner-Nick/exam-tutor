import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { useUploadGuard } from './useUploadGuard'

function GuardedPage() {
  useUploadGuard(true)
  const navigate = useNavigate()
  return <><Link to="/next">链接离开</Link><button onClick={() => navigate('/next')}>程序化离开</button><button onClick={() => navigate(-1)}>后退</button></>
}

function CompletingPage() {
  const [complete, setComplete] = useState(false)
  const navigate = useNavigate()
  useEffect(() => { if (complete) navigate('/next') }, [complete, navigate])
  useUploadGuard(!complete)
  return <button onClick={() => setComplete(true)}>上传完成</button>
}

function setup() {
  const router = createMemoryRouter([
    { path: '/', element: <GuardedPage /> },
    { path: '/next', element: <div>下一页</div> },
    { path: '/previous', element: <div>上一页</div> },
  ], { initialEntries: ['/previous', '/'], initialIndex: 1 })
  render(<RouterProvider router={router} />)
  return router
}

for (const [name, destination] of [['链接离开', '/next'], ['程序化离开', '/next'], ['后退', '/previous']] as const) {
  it(`cancels ${name} consistently`, async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = setup()
    await user.click(screen.getByRole(name === '链接离开' ? 'link' : 'button', { name }))
    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it(`confirms ${name} consistently`, async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const router = setup()
    await user.click(screen.getByRole(name === '链接离开' ? 'link' : 'button', { name }))
    await waitFor(() => expect(router.state.location.pathname).toBe(destination))
    expect(window.confirm).toHaveBeenCalledOnce()
  })
}

it('retains the beforeunload guard', () => {
  setup()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

it('proceeds without confirmation when a blocked operation has completed', async () => {
  const user = userEvent.setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const router = createMemoryRouter([
    { path: '/', element: <CompletingPage /> },
    { path: '/next', element: <div>完成后的页面</div> },
  ], { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)

  await user.click(screen.getByRole('button', { name: '上传完成' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/next'))
  expect(confirm).not.toHaveBeenCalled()
})
