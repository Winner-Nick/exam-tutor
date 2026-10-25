import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { User } from '../types'
import { GuideProvider } from './GuideProvider'

vi.mock('./Onboarding', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { Onboarding: () => <div>懒加载首次向导</div> }
})
vi.mock('./ProductTour', () => ({ ProductTour: () => <div>懒加载页面导览</div> }))

it('shows Suspense fallback before loading the onboarding component', async () => {
  localStorage.clear()
  const user: User = { id: 1, username: 'teacher', role: 'user' }
  render(<MemoryRouter><GuideProvider user={user}><div>页面内容</div></GuideProvider></MemoryRouter>)

  expect(await screen.findByText('正在加载引导内容…')).toBeInTheDocument()
  expect(await screen.findByText('懒加载首次向导')).toBeInTheDocument()
  expect(screen.queryByText('正在加载引导内容…')).not.toBeInTheDocument()
})
