import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { Nav } from '@/components/landing/Nav'
import { TutorialsPage } from '@/pages/TutorialsPage'
import { DocsPage } from '@/pages/DocsPage'
import { ExamplesPage } from '@/pages/ExamplesPage'
import { MCPPage } from '@/pages/MCPPage'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/tutorials" element={<TutorialsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="/mcp" element={<MCPPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
