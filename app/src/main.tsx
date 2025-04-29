import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// biome-ignore lint/style/noNonNullAssertion: expect root element to exist
createRoot(document.getElementById('root')!).render(<App />)
