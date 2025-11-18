import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { registerServiceWorker } from './service-worker-registration.ts'

// biome-ignore lint/style/noNonNullAssertion: expect root element to exist
createRoot(document.getElementById('root')!).render(<App />)

registerServiceWorker()
