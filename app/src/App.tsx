import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router'
import React, { Suspense } from 'react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AuthProvider } from '@/hooks/useAuth'
import { GroundRulesModal } from '@/components/GroundRulesModal'
import AppErrorBoundary from '@/components/AppErrorBoundary'
import Index from './pages/Index'

const queryClient = new QueryClient()

const ProfilePage = React.lazy(() => import('./pages/ProfilePage'))
const SettingsPage = React.lazy(() => import('./components/settings/SettingsPage'))
const DebugPage = React.lazy(() => import('./pages/DebugPage'))
const NotFound = React.lazy(() => import('./pages/NotFound'))

const RouteFallback = () => (
	<div className="flex min-h-screen items-center justify-center bg-background">
		<div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
	</div>
)

const App = () => (
	<QueryClientProvider client={queryClient}>
		<ThemeProvider defaultTheme="system" storageKey="app-theme">
			<AppErrorBoundary>
				<AuthProvider>
					<TooltipProvider>
						<Toaster />
						<Sonner />
						<GroundRulesModal />
						<BrowserRouter>
							<Suspense fallback={<RouteFallback />}>
								<Routes>
									<Route path="/" element={<Index />} />
									<Route path="/profile" element={<ProfilePage />} />
									<Route path="/settings" element={<SettingsPage />} />
									<Route path="/debug" element={<DebugPage />} />
									<Route path="*" element={<NotFound />} />
								</Routes>
							</Suspense>
						</BrowserRouter>
					</TooltipProvider>
				</AuthProvider>
			</AppErrorBoundary>
		</ThemeProvider>
	</QueryClientProvider>
)

export default App
