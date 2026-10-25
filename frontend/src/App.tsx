import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
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
  return <Outlet />
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

const router = createBrowserRouter([
  {
    element: <SessionEvents />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/download', element: <DownloadPage /> },
      {
        element: <Protected />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/jobs/:jobId', element: <JobPage /> },
          {
            element: <TeacherOnly />,
            children: [
              { path: '/papers', element: <PapersPage /> },
              { path: '/papers/:paperId', element: <PaperPage /> },
              { path: '/students', element: <StudentsPage /> },
            ],
          },
          { path: '/mistakes', element: <MistakesPage /> },
          { path: '/guide', element: <GuidePage /> },
          { path: '/stats', element: <StatsPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}
