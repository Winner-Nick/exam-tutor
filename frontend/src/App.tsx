import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { api, ApiError } from './api'
import { AppShell } from './components/AppShell'
import { Spinner } from './components/Spinner'
import { ToastProvider } from './components/Toast'
import { DashboardPage } from './pages/DashboardPage'
import { JobPage } from './pages/JobPage'
import { LoginPage } from './pages/LoginPage'
import { MistakesPage } from './pages/MistakesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      staleTime: 10_000,
    },
  },
})

function Protected() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  if (me.isPending)
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  if (me.isError) return <Navigate to="/login" replace />
  return (
    <AppShell user={me.data}>
      <Outlet context={me.data} />
    </AppShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Protected />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/jobs/:jobId" element={<JobPage />} />
              <Route path="/mistakes" element={<MistakesPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}
