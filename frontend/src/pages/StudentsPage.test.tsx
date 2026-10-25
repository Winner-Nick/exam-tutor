import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { api } from '../api'
import { StudentsPage } from './StudentsPage'

it('uses real labels for student account credentials', async () => {
  const user = userEvent.setup()
  const qc = new QueryClient()
  vi.spyOn(api, 'listStudents').mockResolvedValue({
    students: [{ id: 2, name: '小明', is_self: 0, created_at: 1, submission_count: 0, wrong_total: 0 }],
  })
  render(<QueryClientProvider client={qc}><MemoryRouter><StudentsPage /></MemoryRouter></QueryClientProvider>)

  await user.click(await screen.findByTitle('登录账号管理'))

  expect(screen.getByLabelText('登录用户名')).toBeInTheDocument()
  expect(screen.getByLabelText('初始密码')).toBeInTheDocument()
})
