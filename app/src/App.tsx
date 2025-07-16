import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AuthProvider } from '@/hooks/useAuth'
import { GroundRulesModal } from '@/components/GroundRulesModal'
import Index from './pages/Index'
import ProfilePage from './pages/ProfilePage'
import NotFound from './pages/NotFound'
import DebugPage from './pages/DebugPage'
import SettingsPage from './components/settings/SettingsPage'

const queryClient = new QueryClient()

const App = () => (
	<QueryClientProvider client={queryClient}>
		<ThemeProvider defaultTheme="system" storageKey="app-theme">
			<AuthProvider>
				<TooltipProvider>
					<Toaster />
					<Sonner />
					<GroundRulesModal />
					<BrowserRouter>
						<Routes>
							<Route path="/" element={<Index />} />
							<Route path="/profile" element={<ProfilePage />} />
							<Route path="/settings" element={<SettingsPage />} />
							<Route path="/debug" element={<DebugPage />} />
							<Route path="*" element={<NotFound />} />
						</Routes>
					</BrowserRouter>
				</TooltipProvider>
			</AuthProvider>
		</ThemeProvider>
	</QueryClientProvider>
)

export default App
