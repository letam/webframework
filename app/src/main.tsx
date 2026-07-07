import { initMonitoring } from '@/lib/monitoring'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

initMonitoring()

// biome-ignore lint/style/noNonNullAssertion: expect root element to exist
createRoot(document.getElementById('root')!).render(<App />)
