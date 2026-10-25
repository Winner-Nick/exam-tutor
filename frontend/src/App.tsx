import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, UNAUTHORIZED_EVENT } from './api'
import { AppShell } from './components/AppShell'
import { ErrorState } from './components/ErrorState'
import { Spinner } from './components/Spinner'
import { ToastProvider } from './components/Toast'
import { DashboardPage } from './pages/DashboardPage'
import { DownloadPage } from './pages/DownloadPage'
import { GuidePage } from './pages/GuidePage'
import { JobPage } from './pages/JobPage'
import { LoginPage } from './pages/LoginPage'
import { MistakesPage } from './pages/MistakesPage'
import { PaperPage } from './pages/PaperPage'
import { PapersPage } from './pages/PapersPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'
import { StudentsPage } from './pages/StudentsPage'
import { resetWorkspaceUi } from './store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
      staleTime: 10_000,
    },
  },
})

function SessionEvents() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const unauthorized = () => {
      qc.clear()
      resetWorkspaceUi()
      if (location.pathname !== '/login') {
        navigate('/login', {
          replace: true,
          state: { from: `${location.pathname}${location.search}${location.hash}`, reason: 'expired' },
        })
      }
    }
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
  }, [location.hash, location.pathname, location.search, navigate, qc])
  return null
}

function Protected() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const location = useLocation()
  if (me.isPending) {
    return (
      <div className="flex h-screen items-center justify-center" aria-label="正在恢复会话">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}`, reason: 'expired' }} />
    }
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <ErrorState error={me.error} title="暂时无法恢复会话" onRetry={() => void me.refetch()} />
      </div>
    )
  }
  return (
    <AppShell user={me.data}>
      <Outlet context={me.data} />
    </AppShell>
  )
}

function TeacherOnly() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me })
  if (me.data?.role === 'student') return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SessionEvents />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/download" element={<DownloadPage />} />
            <Route element={<Protected />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/jobs/:jobId" element={<JobPage />} />
              <Route element={<TeacherOnly />}>
                <Route path="/papers" element={<PapersPage />} />
                <Route path="/papers/:paperId" element={<PaperPage />} />
                <Route path="/students" element={<StudentsPage />} />
              </Route>
              <Route path="/mistakes" element={<MistakesPage />} />
              <Route path="/guide" element={<GuidePage />} />
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
