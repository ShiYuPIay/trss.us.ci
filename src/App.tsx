import { useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, useLocation } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AnimatedRoutes } from '@/components/AnimatedRoutes'
import { PageTransition } from '@/components/PageTransition'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { AuthProvider, useAuth } from '@/lib/AuthContext'
import { isCloudConfigured } from '@/lib/cloudbase'
import Index from '@/pages/Index'
import Articles from '@/pages/Articles'
import ArticleDetail from '@/pages/ArticleDetail'
import Tags from '@/pages/Tags'
import About from '@/pages/About'
import Login from '@/pages/Login'
import Studio from '@/pages/Studio'
import AuthCallback from '@/pages/AuthCallback'
import NotFound from '@/pages/NotFound'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 300_000, retry: 1, refetchOnWindowFocus: false } } })

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [pathname])
  return null
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="route-loading">正在加载你的空间…</div>
  if (isCloudConfigured && !user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function SiteRoutes() {
  const { pathname } = useLocation()
  const isCallback = pathname === '/auth/callback'
  return (
    <div className="site-shell">
      <ScrollToTop />
      {!isCallback && <Header />}
      <AnimatedRoutes>
        <Route path="/" data-genie-title="huiyiziyuan 首页" data-genie-key="Home" element={<PageTransition transition="slide-up"><Index /></PageTransition>} />
        <Route path="/articles" data-genie-title="文章列表" data-genie-key="Articles" element={<PageTransition transition="fade"><Articles /></PageTransition>} />
        <Route path="/articles/:slug" data-genie-title="文章详情" data-genie-key="ArticleDetail" element={<PageTransition transition="slide-up"><ArticleDetail /></PageTransition>} />
        <Route path="/tags" data-genie-title="标签分类" data-genie-key="Tags" element={<PageTransition transition="fade"><Tags /></PageTransition>} />
        <Route path="/about" data-genie-title="关于" data-genie-key="About" element={<PageTransition transition="slide-up"><About /></PageTransition>} />
        <Route path="/login" data-genie-title="登录" data-genie-key="Login" element={<PageTransition transition="scale"><Login /></PageTransition>} />
        <Route path="/studio" data-genie-title="写作工作台" data-genie-key="Studio" element={<PageTransition transition="fade"><ProtectedRoute><Studio /></ProtectedRoute></PageTransition>} />
        <Route path="/auth/callback" data-genie-title="登录处理中" data-genie-key="AuthCallback" element={<PageTransition transition="fade"><AuthCallback /></PageTransition>} />
        <Route path="*" data-genie-title="页面未找到" data-genie-key="NotFound" element={<PageTransition transition="fade"><NotFound /></PageTransition>} />
      </AnimatedRoutes>
      {!isCallback && <Footer />}
    </div>
  )
}

export default function App() {
  return <ErrorBoundary><QueryClientProvider client={queryClient}><TooltipProvider><Toaster position="top-center" /><BrowserRouter><AuthProvider><SiteRoutes /></AuthProvider></BrowserRouter></TooltipProvider></QueryClientProvider></ErrorBoundary>
}
