import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, UNAUTHORIZED_EVENT } from './api'
import { AppShell } from './components/AppShell'
import { ErrorState } from './components/ErrorState'
import { Spinner } from './components/Spinner'
import { ToastProvider } from './components/Toast'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

const DownloadPage = lazy(() => import('./pages/DownloadPage').then((module) => ({ default: module.DownloadPage })))
const GuidePage = lazy(() => import('./pages/GuidePage').then((module) => ({ default: module.GuidePage })))
const JobPage = lazy(() => import('./pages/JobPage').then((module) => ({ default: module.JobPage })))
const MistakesPage = lazy(() => import('./pages/MistakesPage').then((module) => ({ default: module.MistakesPage })))
const PaperPage = lazy(() => import('./pages/PaperPage').then((module) => ({ default: module.PaperPage })))
const PapersPage = lazy(() => import('./pages/PapersPage').then((module) => ({ default: module.PapersPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const StatsPage = lazy(() => import('./pages/StatsPage').then((module) => ({ default: module.StatsPage })))
const StudentsPage = lazy(() => import('./pages/StudentsPage').then((module) => ({ default: module.StudentsPage })))

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
      <Suspense fallback={<div className="flex justify-center py-20" role="status"><Spinner className="h-8 w-8" /><span className="sr-only">正在加载页面</span></div>}>
        <Outlet context={me.data} />
      </Suspense>
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
      { path: '/download', element: <Suspense fallback={<div className="flex justify-center py-20" role="status"><Spinner className="h-8 w-8" /></div>}><DownloadPage /></Suspense> },
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
