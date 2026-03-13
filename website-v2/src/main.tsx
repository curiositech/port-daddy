import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { Nav } from '@/components/landing/Nav'

// Pages
import App from './App.tsx'
import { TutorialsPage } from '@/pages/TutorialsPage'
import { DocsPage } from '@/pages/DocsPage'
import { ExamplesPage } from '@/pages/ExamplesPage'
import { MCPPage } from '@/pages/MCPPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { BlogPage } from '@/pages/BlogPage'
import { BlogPostPage } from '@/pages/BlogPostPage'

// Sub-pages
import { CookbookPage } from '@/pages/cookbook/CookbookPage'
import { RecipePage } from '@/pages/cookbook/RecipePage'
import { IntegrationsPage } from '@/pages/integrations/IntegrationsPage'
import { IntegrationPage } from '@/pages/integrations/IntegrationPage'
import { TemplatePage } from '@/pages/blueprints/TemplatePage'

// Tutorials
import * as Tutorials from '@/pages/tutorials'

import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          {/* Main */}
          <Route path="/" element={<App />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="/mcp" element={<MCPPage />} />
          
          {/* Academy */}
          <Route path="/tutorials" element={<TutorialsPage />} />
          <Route path="/tutorials/getting-started" element={<Tutorials.GettingStarted />} />
          <Route path="/tutorials/multi-agent" element={<Tutorials.MultiAgentOrchestration />} />
          <Route path="/tutorials/monorepo" element={<Tutorials.Monorepo />} />
          <Route path="/tutorials/debugging" element={<Tutorials.Debugging />} />
          <Route path="/tutorials/tunnel" element={<Tutorials.Tunnel />} />
          <Route path="/tutorials/dns" element={<Tutorials.DNSResolver />} />
          <Route path="/tutorials/session-phases" element={<Tutorials.SessionPhases />} />
          <Route path="/tutorials/inbox" element={<Tutorials.Inbox />} />
          <Route path="/tutorials/sugar" element={<Tutorials.Sugar />} />
          <Route path="/tutorials/always-on" element={<Tutorials.AlwaysOn />} />
          <Route path="/tutorials/pd-spawn" element={<Tutorials.Spawn />} />
          <Route path="/tutorials/harbors" element={<Tutorials.Harbors />} />
          <Route path="/tutorials/dashboard" element={<Tutorials.Dashboard />} />
          <Route path="/tutorials/pipelines" element={<Tutorials.Pipelines />} />
          <Route path="/tutorials/time-travel" element={<Tutorials.TimeTravel />} />
          <Route path="/tutorials/remote-harbors" element={<Tutorials.RemoteHarbors />} />

          {/* Ecosystem */}
          <Route path="/cookbook" element={<CookbookPage />} />
          <Route path="/cookbook/:id" element={<RecipePage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/integrations/:id" element={<IntegrationPage />} />
          <Route path="/templates/:id" element={<TemplatePage />} />

          {/* Blog */}
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
