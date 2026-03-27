import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { Nav } from '@/components/landing/Nav'
import { DocsLayout } from '@/components/docs/DocsLayout'

// Pages
import App from './App.tsx'
import { TutorialsPage } from '@/pages/TutorialsPage'
import DocsPage from '@/pages/DocsPage'
import { ExamplesPage } from '@/pages/ExamplesPage'
import MCPPage from '@/pages/MCPPage'
import WhitepaperPage from '@/pages/whitepaper'
import { DashboardPage } from '@/pages/DashboardPage'
import { BlogPage } from '@/pages/BlogPage'
import { BlogPostPage } from '@/pages/BlogPostPage'
import { RoadmapPage } from '@/pages/RoadmapPage'
import { TemplatesPage } from '@/pages/TemplatesPage'

// New Documentation Pages
import DocsOverview from '@/pages/docs/DocsOverview'
import QuickStart from '@/pages/docs/QuickStart'
import CliOverview from '@/pages/docs/CliOverview'
import McpOverview from '@/pages/docs/McpOverview'
import PortsFeature from '@/pages/docs/features/PortsFeature'

// CLI Command Pages
import ClaimCommand from '@/pages/docs/cli/ClaimCommand'
import ReleaseCommand from '@/pages/docs/cli/ReleaseCommand'
import FindCommand from '@/pages/docs/cli/FindCommand'
import ServicesCommand from '@/pages/docs/cli/ServicesCommand'
import ScanCommand from '@/pages/docs/cli/ScanCommand'
import UpCommand from '@/pages/docs/cli/UpCommand'
import DownCommand from '@/pages/docs/cli/DownCommand'
import StatusCommand from '@/pages/docs/cli/StatusCommand'
import BeginCommand from '@/pages/docs/cli/BeginCommand'
import DoneCommand from '@/pages/docs/cli/DoneCommand'
import WhoamiCommand from '@/pages/docs/cli/WhoamiCommand'
import NoteCommand from '@/pages/docs/cli/NoteCommand'
import NotesCommand from '@/pages/docs/cli/NotesCommand'
import LockAcquireCommand from '@/pages/docs/cli/LockAcquireCommand'
import LockReleaseCommand from '@/pages/docs/cli/LockReleaseCommand'
import WithLockCommand from '@/pages/docs/cli/WithLockCommand'
import MsgCommand from '@/pages/docs/cli/MsgCommand'
import PubCommand from '@/pages/docs/cli/PubCommand'
import WatchCommand from '@/pages/docs/cli/WatchCommand'
import SpawnCommand from '@/pages/docs/cli/SpawnCommand'
import SpawnedCommand from '@/pages/docs/cli/SpawnedCommand'
import AgentRegisterCommand from '@/pages/docs/cli/AgentRegisterCommand'
import SalvageCommand from '@/pages/docs/cli/SalvageCommand'
import SalvageClaimCommand from '@/pages/docs/cli/SalvageClaimCommand'
import DnsCommand from '@/pages/docs/cli/DnsCommand'
import HarborCreateCommand from '@/pages/docs/cli/HarborCreateCommand'
import HarborEnterCommand from '@/pages/docs/cli/HarborEnterCommand'
import HarborLeaveCommand from '@/pages/docs/cli/HarborLeaveCommand'
import HarborsCommand from '@/pages/docs/cli/HarborsCommand'
import TunnelCommand from '@/pages/docs/cli/TunnelCommand'
import TunnelStopCommand from '@/pages/docs/cli/TunnelStopCommand'

// SDK Module Pages
import SdkOverview from '@/pages/docs/sdk'
import PortsSdk from '@/pages/docs/sdk/Ports'
import SessionsSdk from '@/pages/docs/sdk/Sessions'
import LocksSdk from '@/pages/docs/sdk/Locks'
import HarborsSdk from '@/pages/docs/sdk/Harbors'

// SDK Function Pages - Ports
import ScanServices from '@/pages/docs/sdk/ScanServices'
import Up from '@/pages/docs/sdk/Up'
import Down from '@/pages/docs/sdk/Down'
import Status from '@/pages/docs/sdk/Status'

// SDK Function Pages - Sessions
import Whoami from '@/pages/docs/sdk/Whoami'
import AddNote from '@/pages/docs/sdk/AddNote'
import ListNotes from '@/pages/docs/sdk/ListNotes'
import DoneSession from '@/pages/docs/sdk/DoneSession'

// SDK Function Pages - Locks
import ReleaseLock from '@/pages/docs/sdk/ReleaseLock'
import WithLock from '@/pages/docs/sdk/WithLock'

// SDK Function Pages - Messaging
import Subscribe from '@/pages/docs/sdk/Subscribe'
import Watch from '@/pages/docs/sdk/Watch'

// SDK Function Pages - Harbors
import LeaveHarbor from '@/pages/docs/sdk/LeaveHarbor'
import ListHarbors from '@/pages/docs/sdk/ListHarbors'

// SDK Function Pages - DNS
import DnsRegister from '@/pages/docs/sdk/DnsRegister'
import DnsResolve from '@/pages/docs/sdk/DnsResolve'

// SDK Function Pages - Agents
import Spawn from '@/pages/docs/sdk/Spawn'
import ListSpawned from '@/pages/docs/sdk/ListSpawned'
import RegisterAgent from '@/pages/docs/sdk/RegisterAgent'
import Salvage from '@/pages/docs/sdk/Salvage'
import SalvageClaim from '@/pages/docs/sdk/SalvageClaim'

// SDK Function Pages - Tunnels
import Tunnel from '@/pages/docs/sdk/Tunnel'
import TunnelStop from '@/pages/docs/sdk/TunnelStop'

// MCP Tool Pages - Core
import ClaimPortTool from '@/pages/docs/mcp/ClaimPortTool'
import ReleasePortTool from '@/pages/docs/mcp/ReleasePortTool'
import FindPortTool from '@/pages/docs/mcp/FindPortTool'
import ListServicesTool from '@/pages/docs/mcp/ListServicesTool'
import BeginSessionTool from '@/pages/docs/mcp/BeginSessionTool'
import DoneSessionTool from '@/pages/docs/mcp/DoneSessionTool'
import PublishMessageTool from '@/pages/docs/mcp/PublishMessageTool'
import AcquireLockTool from '@/pages/docs/mcp/AcquireLockTool'
import CreateHarborTool from '@/pages/docs/mcp/CreateHarborTool'

// MCP Tool Pages - Additional
import DnsRegisterTool from '@/pages/docs/mcp/DnsRegisterTool'
import DnsResolveTool from '@/pages/docs/mcp/DnsResolveTool'
import SubscribeTool from '@/pages/docs/mcp/SubscribeTool'
import LeaveHarborTool from '@/pages/docs/mcp/LeaveHarborTool'
import ListHarborsTool from '@/pages/docs/mcp/ListHarborsTool'
import AddNoteTool from '@/pages/docs/mcp/AddNoteTool'
import ListNotesTool from '@/pages/docs/mcp/ListNotesTool'
import SpawnTool from '@/pages/docs/mcp/SpawnTool'
import ListSpawnedTool from '@/pages/docs/mcp/ListSpawnedTool'
import SalvageTool from '@/pages/docs/mcp/SalvageTool'
import SalvageClaimTool from '@/pages/docs/mcp/SalvageClaimTool'
import ScanServicesTool from '@/pages/docs/mcp/ScanServicesTool'
import UpTool from '@/pages/docs/mcp/UpTool'
import DownTool from '@/pages/docs/mcp/DownTool'
import StatusTool from '@/pages/docs/mcp/StatusTool'
import TunnelTool from '@/pages/docs/mcp/TunnelTool'
import TunnelStopTool from '@/pages/docs/mcp/TunnelStopTool'
import WatchTool from '@/pages/docs/mcp/WatchTool'

// Sub-pages
import { CookbookPage } from '@/pages/cookbook/CookbookPage'
import { RecipePage } from '@/pages/cookbook/RecipePage'
import { IntegrationsPage } from '@/pages/integrations/IntegrationsPage'
import { IntegrationPage } from '@/pages/integrations/IntegrationPage'
import { TemplatePage } from '@/pages/blueprints/TemplatePage'

// Tutorials
import * as Tutorials from '@/pages/tutorials'

import './index.css'

// Wrapper for pages that need the main Nav
function MainLayout() {
  return (
    <>
      <Nav />
      <Outlet />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          {/* Main Site with Nav */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<App />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            {/* DocsPage is now served via DocsLayout — use /docs-old for legacy */}
            <Route path="/examples" element={<ExamplesPage />} />
            <Route path="/mcp" element={<MCPPage />} />
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/templates" element={<TemplatesPage />} />

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
            <Route path="/tutorials/time-travel" element={<Tutorials.TimeTravel />} />

            {/* Ecosystem */}
            <Route path="/cookbook" element={<CookbookPage />} />
            <Route path="/cookbook/:id" element={<RecipePage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/integrations/:id" element={<IntegrationPage />} />
            <Route path="/templates/:id" element={<TemplatePage />} />

            {/* Blog */}
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/:slug" element={<BlogPostPage />} />

            {/* White Papers */}
            <Route path="/whitepaper" element={<WhitepaperPage />} />
          </Route>

          {/* Documentation with Sidebar Layout */}
          <Route path="/docs" element={<DocsLayout />}>
            {/* Overview */}
            <Route index element={<DocsOverview />} />
            <Route path="quickstart" element={<QuickStart />} />
            <Route path="installation" element={<DocsOverview />} />
            <Route path="concepts" element={<DocsOverview />} />
            
            {/* CLI */}
            <Route path="cli" element={<CliOverview />} />
            
            {/* CLI Commands - Individual Pages */}
            {/* Ports */}
            <Route path="cli/claim" element={<ClaimCommand />} />
            <Route path="cli/release" element={<ReleaseCommand />} />
            <Route path="cli/find" element={<FindCommand />} />
            <Route path="cli/services" element={<ServicesCommand />} />
            <Route path="cli/scan" element={<ScanCommand />} />
            <Route path="cli/up" element={<UpCommand />} />
            <Route path="cli/down" element={<DownCommand />} />
            <Route path="cli/status" element={<StatusCommand />} />
            {/* Sessions */}
            <Route path="cli/begin" element={<BeginCommand />} />
            <Route path="cli/done" element={<DoneCommand />} />
            <Route path="cli/whoami" element={<WhoamiCommand />} />
            <Route path="cli/note" element={<NoteCommand />} />
            <Route path="cli/notes" element={<NotesCommand />} />
            {/* Locks */}
            <Route path="cli/lock-acquire" element={<LockAcquireCommand />} />
            <Route path="cli/lock-release" element={<LockReleaseCommand />} />
            <Route path="cli/with-lock" element={<WithLockCommand />} />
            {/* Messaging */}
            <Route path="cli/msg" element={<MsgCommand />} />
            <Route path="cli/pub" element={<PubCommand />} />
            <Route path="cli/watch" element={<WatchCommand />} />
            {/* Agents */}
            <Route path="cli/spawn" element={<SpawnCommand />} />
            <Route path="cli/spawned" element={<SpawnedCommand />} />
            <Route path="cli/agent-register" element={<AgentRegisterCommand />} />
            <Route path="cli/salvage" element={<SalvageCommand />} />
            <Route path="cli/salvage-claim" element={<SalvageClaimCommand />} />
            {/* DNS */}
            <Route path="cli/dns" element={<DnsCommand />} />
            {/* Harbors */}
            <Route path="cli/harbor-create" element={<HarborCreateCommand />} />
            <Route path="cli/harbor-enter" element={<HarborEnterCommand />} />
            <Route path="cli/harbor-leave" element={<HarborLeaveCommand />} />
            <Route path="cli/harbors" element={<HarborsCommand />} />
            {/* Tunnels */}
            <Route path="cli/tunnel" element={<TunnelCommand />} />
            <Route path="cli/tunnel-stop" element={<TunnelStopCommand />} />
            
            {/* Legacy CLI category pages */}
            <Route path="cli/ports" element={<CliOverview />} />
            <Route path="cli/sessions" element={<CliOverview />} />
            <Route path="cli/messaging" element={<CliOverview />} />
            <Route path="cli/locks" element={<CliOverview />} />
            <Route path="cli/harbors" element={<CliOverview />} />
            <Route path="cli/dns" element={<CliOverview />} />
            <Route path="cli/tunnels" element={<CliOverview />} />
            
            {/* Features */}
            <Route path="features/ports" element={<PortsFeature />} />
            <Route path="features/radio" element={<PortsFeature />} />
            <Route path="features/harbors" element={<PortsFeature />} />
            <Route path="features/avatars" element={<PortsFeature />} />
            <Route path="features/salvage" element={<PortsFeature />} />
            <Route path="features/timeline" element={<PortsFeature />} />
            <Route path="features/dns" element={<PortsFeature />} />
            <Route path="features/remote" element={<PortsFeature />} />
            <Route path="features/sessions" element={<PortsFeature />} />
            <Route path="features/tunnels" element={<PortsFeature />} />
            
            {/* SDK - TypeScript */}
            <Route path="sdk" element={<SdkOverview />} />
            <Route path="sdk/ports" element={<PortsSdk />} />
            <Route path="sdk/sessions" element={<SessionsSdk />} />
            <Route path="sdk/locks" element={<LocksSdk />} />
            <Route path="sdk/harbors" element={<HarborsSdk />} />
            
            {/* SDK Function Pages - Ports */}
            <Route path="sdk/scan-services" element={<ScanServices />} />
            <Route path="sdk/up" element={<Up />} />
            <Route path="sdk/down" element={<Down />} />
            <Route path="sdk/status" element={<Status />} />
            
            {/* SDK Function Pages - Sessions */}
            <Route path="sdk/whoami" element={<Whoami />} />
            <Route path="sdk/add-note" element={<AddNote />} />
            <Route path="sdk/list-notes" element={<ListNotes />} />
            <Route path="sdk/done-session" element={<DoneSession />} />
            
            {/* SDK Function Pages - Locks */}
            <Route path="sdk/release-lock" element={<ReleaseLock />} />
            <Route path="sdk/with-lock" element={<WithLock />} />
            
            {/* SDK Function Pages - Messaging */}
            <Route path="sdk/subscribe" element={<Subscribe />} />
            <Route path="sdk/watch" element={<Watch />} />
            
            {/* SDK Function Pages - Harbors */}
            <Route path="sdk/leave-harbor" element={<LeaveHarbor />} />
            <Route path="sdk/list-harbors" element={<ListHarbors />} />
            
            {/* SDK Function Pages - DNS */}
            <Route path="sdk/dns-register" element={<DnsRegister />} />
            <Route path="sdk/dns-resolve" element={<DnsResolve />} />
            
            {/* SDK Function Pages - Agents */}
            <Route path="sdk/spawn" element={<Spawn />} />
            <Route path="sdk/list-spawned" element={<ListSpawned />} />
            <Route path="sdk/register-agent" element={<RegisterAgent />} />
            <Route path="sdk/salvage" element={<Salvage />} />
            <Route path="sdk/salvage-claim" element={<SalvageClaim />} />
            
            {/* SDK Function Pages - Tunnels */}
            <Route path="sdk/tunnel" element={<Tunnel />} />
            <Route path="sdk/tunnel-stop" element={<TunnelStop />} />
            
            {/* MCP */}
            <Route path="mcp" element={<McpOverview />} />
            <Route path="mcp/claude" element={<McpOverview />} />
            <Route path="mcp/cursor" element={<McpOverview />} />
            <Route path="mcp/windsurf" element={<McpOverview />} />
            <Route path="mcp/custom" element={<McpOverview />} />
            
            {/* MCP Tools - Core */}
            <Route path="mcp/claim-port" element={<ClaimPortTool />} />
            <Route path="mcp/release-port" element={<ReleasePortTool />} />
            <Route path="mcp/find-port" element={<FindPortTool />} />
            <Route path="mcp/list-services" element={<ListServicesTool />} />
            <Route path="mcp/begin-session" element={<BeginSessionTool />} />
            <Route path="mcp/done-session" element={<DoneSessionTool />} />
            <Route path="mcp/publish-message" element={<PublishMessageTool />} />
            <Route path="mcp/acquire-lock" element={<AcquireLockTool />} />
            <Route path="mcp/create-harbor" element={<CreateHarborTool />} />
            
            {/* MCP Tools - Additional */}
            <Route path="mcp/dns-register" element={<DnsRegisterTool />} />
            <Route path="mcp/dns-resolve" element={<DnsResolveTool />} />
            <Route path="mcp/subscribe" element={<SubscribeTool />} />
            <Route path="mcp/leave-harbor" element={<LeaveHarborTool />} />
            <Route path="mcp/list-harbors" element={<ListHarborsTool />} />
            <Route path="mcp/add-note" element={<AddNoteTool />} />
            <Route path="mcp/list-notes" element={<ListNotesTool />} />
            <Route path="mcp/spawn-agent" element={<SpawnTool />} />
            <Route path="mcp/list-spawned" element={<ListSpawnedTool />} />
            <Route path="mcp/salvage" element={<SalvageTool />} />
            <Route path="mcp/salvage-claim" element={<SalvageClaimTool />} />
            <Route path="mcp/scan-services" element={<ScanServicesTool />} />
            <Route path="mcp/up" element={<UpTool />} />
            <Route path="mcp/down" element={<DownTool />} />
            <Route path="mcp/status" element={<StatusTool />} />
            <Route path="mcp/tunnel" element={<TunnelTool />} />
            <Route path="mcp/tunnel-stop" element={<TunnelStopTool />} />
            <Route path="mcp/watch" element={<WatchTool />} />
            
            {/* API */}
            <Route path="api" element={<DocsOverview />} />
            <Route path="api/auth" element={<DocsOverview />} />
            <Route path="api/endpoints" element={<DocsOverview />} />
            <Route path="api/webhooks" element={<DocsOverview />} />
            
            {/* Advanced */}
            <Route path="advanced/architecture" element={<DocsOverview />} />
            <Route path="advanced/security" element={<DocsOverview />} />
            <Route path="advanced/performance" element={<DocsOverview />} />
            <Route path="advanced/self-hosting" element={<DocsOverview />} />
          </Route>

          {/* Legacy Docs Redirect */}
          <Route path="/docs-old" element={<DocsPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
