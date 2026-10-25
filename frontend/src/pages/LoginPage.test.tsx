import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { api, ApiError } from '../api'
import { LoginPage } from './LoginPage'

it('keeps invite requirements consistent on options failure and retries loading', async () => {
  const user = userEvent.setup()
  const options = vi.spyOn(api, 'registrationOptions').mockRejectedValue(new ApiError(0, 'offline', 'network'))
  const qc = new QueryClient()
  render(<QueryClientProvider client={qc}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>)

  await user.click(screen.getByRole('tab', { name: '注册' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('当前按邀请码注册处理，请填写邀请码')
  expect(screen.getByLabelText('邀请码')).toBeRequired()
  expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled()
  expect(screen.queryByText(/可留空/)).not.toBeInTheDocument()

  options.mockResolvedValue({ bootstrap: false, allow_open_register: true })
  await user.click(screen.getByRole('button', { name: '重试加载注册配置' }))

  await waitFor(() => expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument())
  expect(screen.getByText('当前开放注册，无需邀请码。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled()
  expect(options.mock.calls.length).toBeGreaterThanOrEqual(3)
})
