import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import type { User } from '../types'
import { AppShell } from './AppShell'

function setup(role: User['role'] = 'user', path = '/') {
  localStorage.setItem('et-guide-v1:1', JSON.stringify({ onboardingSeen: true, checklist: [] }))
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell user={{ id: 1, username: '测试账号', role }}><p>页面内容</p></AppShell>
    </MemoryRouter>,
  )
}

it('opens secondary teacher navigation as a dismissible mobile sheet', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.getByRole('navigation', { name: '移动端主导航' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '打开更多功能' }))
  const dialog = screen.getByRole('dialog', { name: '更多功能' })
  expect(within(dialog).getByRole('link', { name: /学生管理/ })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '页面导览' })).toBeInTheDocument()

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '更多功能' })).not.toBeInTheDocument()
})

it('does not expose teacher resources in student navigation', async () => {
  const user = userEvent.setup()
  setup('student')
  expect(screen.queryByRole('link', { name: /试卷库/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /学生管理/ })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '打开更多功能' }))
  const dialog = screen.getByRole('dialog', { name: '更多功能' })
  expect(within(dialog).getByRole('link', { name: /使用教程/ })).toBeInTheDocument()
  expect(within(dialog).queryByRole('link', { name: /学生管理/ })).not.toBeInTheDocument()
})

it('leaves mobile navigation to the dedicated job result tabs', () => {
  setup('user', '/jobs/job-1')
  expect(screen.queryByRole('navigation', { name: '移动端主导航' })).not.toBeInTheDocument()
})
