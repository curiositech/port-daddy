import { StrictMode, Suspense, lazy, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { DocumentMeta } from '@/components/layout/DocumentMeta'
import { HashScroll } from '@/components/layout/HashScroll'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { MainLayout } from '@/components/layout/MainLayout'
import { TypeThemeSwitcher } from '@/components/layout/TypeThemeSwitcher'
import { RouteFallback } from '@/components/layout/RouteFallback'
import { LegacyExampleRedirect } from '@/components/routing/LegacyExampleRedirect'
import './index.css'

function lazyNamed(loader: () => Promise<Record<string, unknown>>, exportName: string) {
  return lazy(async () => {
    const module = await loader()
    return { default: module[exportName] as ComponentType }
  })
}

const App = lazy(() => import('./App'))
const DocsLayout = lazyNamed(() => import('@/components/docs/DocsLayout'), 'DocsLayout')
const TutorialsPage = lazyNamed(() => import('@/pages/TutorialsPage'), 'TutorialsPage')
const ExamplesPage = lazyNamed(() => import('@/pages/ExamplesPage'), 'ExamplesPage')
const ExampleDetailPage = lazyNamed(() => import('@/pages/ExampleDetailPage'), 'ExampleDetailPage')
const LibraryPage = lazy(() => import('@/pages/library'))
const ResearchLibraryPage = lazy(() => import('@/pages/library/ResearchPage'))
const SecurityPage = lazy(() => import('@/pages/SecurityPage'))
const HarnessPage = lazy(() => import('@/pages/HarnessPage'))
const CliBackendPage = lazy(() => import('@/pages/cli-backend'))
const SquidCodexPage = lazy(() => import('@/pages/SquidCodexPage'))
const WhitepaperDetailPage = lazy(() => import('@/pages/whitepaper/PaperDetailPage'))
const WhitepaperRoundsPage = lazy(() => import('@/pages/whitepaper/RoundsPage'))
const WhitepaperHowWeProvePage = lazy(() => import('@/pages/whitepaper/HowWeProveGameTheory'))
const LandscapePage = lazy(() => import('@/pages/landscape'))
const BlogPage = lazyNamed(() => import('@/pages/BlogPage'), 'BlogPage')
const BlogPostPage = lazyNamed(() => import('@/pages/BlogPostPage'), 'BlogPostPage')
const ManifestoPage = lazyNamed(() => import('@/pages/ManifestoPage'), 'ManifestoPage')
const MacPreviewPage = lazyNamed(() => import('@/pages/MacPreviewPage'), 'MacPreviewPage')
const ScoutPage = lazyNamed(() => import('@/pages/ScoutPage'), 'ScoutPage')
const AccountabilityPage = lazyNamed(() => import('@/pages/AccountabilityPage'), 'AccountabilityPage')
const PdTubePlayground = lazyNamed(() => import('@/pages/pd-tube/Playground'), 'Playground')
const SkillAuditPage = lazyNamed(() => import('@/pages/SkillAuditPage'), 'SkillAuditPage')
const AgentsPage = lazyNamed(() => import('@/pages/AgentsPage'), 'AgentsPage')
const IntegrationsPage = lazyNamed(() => import('@/pages/integrations/IntegrationsPage'), 'IntegrationsPage')
const IntegrationPage = lazyNamed(() => import('@/pages/integrations/IntegrationPage'), 'IntegrationPage')

const GettingStarted = lazyNamed(() => import('@/pages/tutorials/GettingStarted'), 'GettingStarted')
const SemanticIdentities = lazyNamed(() => import('@/pages/tutorials/SemanticIdentities'), 'SemanticIdentities')
const MultiAgentOrchestration = lazyNamed(() => import('@/pages/tutorials/MultiAgentOrchestration'), 'MultiAgentOrchestration')
const Monorepo = lazyNamed(() => import('@/pages/tutorials/Monorepo'), 'Monorepo')
const Debugging = lazyNamed(() => import('@/pages/tutorials/Debugging'), 'Debugging')
const TunnelTutorial = lazyNamed(() => import('@/pages/tutorials/Tunnel'), 'Tunnel')
const DNSResolver = lazyNamed(() => import('@/pages/tutorials/DNSResolver'), 'DNSResolver')
const SessionPhases = lazyNamed(() => import('@/pages/tutorials/SessionPhases'), 'SessionPhases')
const Inbox = lazyNamed(() => import('@/pages/tutorials/Inbox'), 'Inbox')
const Sugar = lazyNamed(() => import('@/pages/tutorials/Sugar'), 'Sugar')
const AlwaysOn = lazyNamed(() => import('@/pages/tutorials/AlwaysOn'), 'AlwaysOn')
const Spawn = lazyNamed(() => import('@/pages/tutorials/Spawn'), 'Spawn')
const Harbors = lazyNamed(() => import('@/pages/tutorials/Harbors'), 'Harbors')
const TimeTravel = lazyNamed(() => import('@/pages/tutorials/TimeTravel'), 'TimeTravel')
const Pipelines = lazyNamed(() => import('@/pages/tutorials/Pipelines'), 'Pipelines')
const Watch = lazyNamed(() => import('@/pages/tutorials/Watch'), 'Watch')
const RemoteHarbors = lazyNamed(() => import('@/pages/tutorials/RemoteHarbors'), 'RemoteHarbors')
const Fleet = lazyNamed(() => import('@/pages/tutorials/Fleet'), 'Fleet')
const Pheromone = lazyNamed(() => import('@/pages/tutorials/Pheromone'), 'Pheromone')
const Primitives = lazyNamed(() => import('@/pages/tutorials/Primitives'), 'Primitives')
const PdTube = lazyNamed(() => import('@/pages/tutorials/PdTube'), 'PdTube')
const DoctrineCycle = lazyNamed(() => import('@/pages/tutorials/DoctrineCycle'), 'DoctrineCycle')

const ApiReference = lazy(() => import('@/pages/docs/ApiReference'))
const Decisions = lazy(() => import('@/pages/docs/Decisions'))
const DocsOverview = lazy(() => import('@/pages/docs/DocsOverview'))
const DocsSectionPage = lazy(() => import('@/pages/docs/DocsSectionPage'))
const QuickStart = lazy(() => import('@/pages/docs/QuickStart'))
const CliOverview = lazy(() => import('@/pages/docs/CliOverview'))
const McpOverview = lazy(() => import('@/pages/docs/McpOverview'))
const PortsFeature = lazy(() => import('@/pages/docs/features/PortsFeature'))
const RadioFeature = lazy(() => import('@/pages/docs/features/RadioFeature'))
const SessionsFeature = lazy(() => import('@/pages/docs/features/SessionsFeature'))
const HarborsFeature = lazy(() => import('@/pages/docs/features/HarborsFeature'))
const SalvageFeature = lazy(() => import('@/pages/docs/features/SalvageFeature'))
const TimelineFeature = lazy(() => import('@/pages/docs/features/TimelineFeature'))
const ClaimTreeConcept = lazy(() => import('@/pages/docs/concepts/ClaimTree'))
const DnsFeature = lazy(() => import('@/pages/docs/features/DnsFeature'))
const RemoteFeature = lazy(() => import('@/pages/docs/features/RemoteFeature'))
const TunnelsFeature = lazy(() => import('@/pages/docs/features/TunnelsFeature'))
const AvatarsFeature = lazy(() => import('@/pages/docs/features/AvatarsFeature'))
const PheromoneFeature = lazy(() => import('@/pages/docs/features/PheromoneFeature'))
const FleetFeature = lazy(() => import('@/pages/docs/features/FleetFeature'))
const TuplesFeature = lazy(() => import('@/pages/docs/features/TuplesFeature'))
const ArbiterFeature = lazy(() => import('@/pages/docs/features/ArbiterFeature'))
const RelayPkiFeature = lazy(() => import('@/pages/docs/features/RelayPkiFeature'))
const DoctrineFeature = lazy(() => import('@/pages/docs/features/DoctrineFeature'))
const PromptingAgents = lazy(() => import('@/pages/docs/guides/PromptingAgents'))
const TemplatesGuide = lazy(() => import('@/pages/docs/guides/TemplatesGuide'))
const ProtocolGuide = lazy(() => import('@/pages/docs/guides/ProtocolGuide'))

const ClaimCommand = lazy(() => import('@/pages/docs/cli/ClaimCommand'))
const ReleaseCommand = lazy(() => import('@/pages/docs/cli/ReleaseCommand'))
const FindCommand = lazy(() => import('@/pages/docs/cli/FindCommand'))
const ServicesCommand = lazy(() => import('@/pages/docs/cli/ServicesCommand'))
const ScanCommand = lazy(() => import('@/pages/docs/cli/ScanCommand'))
const UpCommand = lazy(() => import('@/pages/docs/cli/UpCommand'))
const DownCommand = lazy(() => import('@/pages/docs/cli/DownCommand'))
const StatusCommand = lazy(() => import('@/pages/docs/cli/StatusCommand'))
const BeginCommand = lazy(() => import('@/pages/docs/cli/BeginCommand'))
const DoneCommand = lazy(() => import('@/pages/docs/cli/DoneCommand'))
const WhoamiCommand = lazy(() => import('@/pages/docs/cli/WhoamiCommand'))
const NoteCommand = lazy(() => import('@/pages/docs/cli/NoteCommand'))
const NotesCommand = lazy(() => import('@/pages/docs/cli/NotesCommand'))
const LockAcquireCommand = lazy(() => import('@/pages/docs/cli/LockAcquireCommand'))
const LockReleaseCommand = lazy(() => import('@/pages/docs/cli/LockReleaseCommand'))
const WithLockCommand = lazy(() => import('@/pages/docs/cli/WithLockCommand'))
const MsgCommand = lazy(() => import('@/pages/docs/cli/MsgCommand'))
const PubCommand = lazy(() => import('@/pages/docs/cli/PubCommand'))
const WatchCommand = lazy(() => import('@/pages/docs/cli/WatchCommand'))
const SpawnCommand = lazy(() => import('@/pages/docs/cli/SpawnCommand'))
const SpawnedCommand = lazy(() => import('@/pages/docs/cli/SpawnedCommand'))
const AgentRegisterCommand = lazy(() => import('@/pages/docs/cli/AgentRegisterCommand'))
const SalvageCommand = lazy(() => import('@/pages/docs/cli/SalvageCommand'))
const SalvageClaimCommand = lazy(() => import('@/pages/docs/cli/SalvageClaimCommand'))
const DnsCommand = lazy(() => import('@/pages/docs/cli/DnsCommand'))
const HarborCreateCommand = lazy(() => import('@/pages/docs/cli/HarborCreateCommand'))
const HarborEnterCommand = lazy(() => import('@/pages/docs/cli/HarborEnterCommand'))
const HarborLeaveCommand = lazy(() => import('@/pages/docs/cli/HarborLeaveCommand'))
const HarborsCommand = lazy(() => import('@/pages/docs/cli/HarborsCommand'))
const TunnelCommand = lazy(() => import('@/pages/docs/cli/TunnelCommand'))
const TunnelStopCommand = lazy(() => import('@/pages/docs/cli/TunnelStopCommand'))
const FleetCommand = lazy(() => import('@/pages/docs/cli/FleetCommand'))
const InitCommand = lazy(() => import('@/pages/docs/cli/InitCommand'))
const McpInstallCommand = lazy(() => import('@/pages/docs/cli/McpInstallCommand'))
const RoadmapCommand = lazy(() => import('@/pages/docs/cli/RoadmapCommand'))
const TubeCommand = lazy(() => import('@/pages/docs/cli/TubeCommand'))
const GenericCliCommandPage = lazy(() => import('@/pages/docs/cli/GenericCliCommandPage'))

const SdkOverview = lazy(() => import('@/pages/docs/sdk'))
const PortsSdk = lazy(() => import('@/pages/docs/sdk/Ports'))
const SessionsSdk = lazy(() => import('@/pages/docs/sdk/Sessions'))
const LocksSdk = lazy(() => import('@/pages/docs/sdk/Locks'))
const HarborsSdk = lazy(() => import('@/pages/docs/sdk/Harbors'))
const ScanServices = lazy(() => import('@/pages/docs/sdk/ScanServices'))
const SdkUp = lazy(() => import('@/pages/docs/sdk/Up'))
const SdkDown = lazy(() => import('@/pages/docs/sdk/Down'))
const SdkStatus = lazy(() => import('@/pages/docs/sdk/Status'))
const SdkWhoami = lazy(() => import('@/pages/docs/sdk/Whoami'))
const AddNote = lazy(() => import('@/pages/docs/sdk/AddNote'))
const ListNotes = lazy(() => import('@/pages/docs/sdk/ListNotes'))
const DoneSession = lazy(() => import('@/pages/docs/sdk/DoneSession'))
const ReleaseLock = lazy(() => import('@/pages/docs/sdk/ReleaseLock'))
const SdkWithLock = lazy(() => import('@/pages/docs/sdk/WithLock'))
const Subscribe = lazy(() => import('@/pages/docs/sdk/Subscribe'))
const SdkWatch = lazy(() => import('@/pages/docs/sdk/Watch'))
const LeaveHarbor = lazy(() => import('@/pages/docs/sdk/LeaveHarbor'))
const ListHarbors = lazy(() => import('@/pages/docs/sdk/ListHarbors'))
const DnsRegister = lazy(() => import('@/pages/docs/sdk/DnsRegister'))
const DnsResolve = lazy(() => import('@/pages/docs/sdk/DnsResolve'))
const SdkSpawn = lazy(() => import('@/pages/docs/sdk/Spawn'))
const ListSpawned = lazy(() => import('@/pages/docs/sdk/ListSpawned'))
const RegisterAgent = lazy(() => import('@/pages/docs/sdk/RegisterAgent'))
const SdkSalvage = lazy(() => import('@/pages/docs/sdk/Salvage'))
const SdkSalvageClaim = lazy(() => import('@/pages/docs/sdk/SalvageClaim'))
const SdkTunnel = lazy(() => import('@/pages/docs/sdk/Tunnel'))
const SdkTunnelStop = lazy(() => import('@/pages/docs/sdk/TunnelStop'))

const ClaimPortTool = lazy(() => import('@/pages/docs/mcp/ClaimPortTool'))
const ReleasePortTool = lazy(() => import('@/pages/docs/mcp/ReleasePortTool'))
const FindPortTool = lazy(() => import('@/pages/docs/mcp/FindPortTool'))
const ListServicesTool = lazy(() => import('@/pages/docs/mcp/ListServicesTool'))
const BeginSessionTool = lazy(() => import('@/pages/docs/mcp/BeginSessionTool'))
const DoneSessionTool = lazy(() => import('@/pages/docs/mcp/DoneSessionTool'))
const PublishMessageTool = lazy(() => import('@/pages/docs/mcp/PublishMessageTool'))
const AcquireLockTool = lazy(() => import('@/pages/docs/mcp/AcquireLockTool'))
const CreateHarborTool = lazy(() => import('@/pages/docs/mcp/CreateHarborTool'))
const DnsRegisterTool = lazy(() => import('@/pages/docs/mcp/DnsRegisterTool'))
const DnsResolveTool = lazy(() => import('@/pages/docs/mcp/DnsResolveTool'))
const SubscribeTool = lazy(() => import('@/pages/docs/mcp/SubscribeTool'))
const LeaveHarborTool = lazy(() => import('@/pages/docs/mcp/LeaveHarborTool'))
const ListHarborsTool = lazy(() => import('@/pages/docs/mcp/ListHarborsTool'))
const AddNoteTool = lazy(() => import('@/pages/docs/mcp/AddNoteTool'))
const ListNotesTool = lazy(() => import('@/pages/docs/mcp/ListNotesTool'))
const SpawnTool = lazy(() => import('@/pages/docs/mcp/SpawnTool'))
const ListSpawnedTool = lazy(() => import('@/pages/docs/mcp/ListSpawnedTool'))
const SalvageTool = lazy(() => import('@/pages/docs/mcp/SalvageTool'))
const SalvageClaimTool = lazy(() => import('@/pages/docs/mcp/SalvageClaimTool'))
const ScanServicesTool = lazy(() => import('@/pages/docs/mcp/ScanServicesTool'))
const UpTool = lazy(() => import('@/pages/docs/mcp/UpTool'))
const DownTool = lazy(() => import('@/pages/docs/mcp/DownTool'))
const StatusTool = lazy(() => import('@/pages/docs/mcp/StatusTool'))
const TunnelTool = lazy(() => import('@/pages/docs/mcp/TunnelTool'))
const TunnelStopTool = lazy(() => import('@/pages/docs/mcp/TunnelStopTool'))
const WatchTool = lazy(() => import('@/pages/docs/mcp/WatchTool'))
const DoctrineListTool = lazy(() => import('@/pages/docs/mcp/DoctrineListTool'))
const DoctrineGetTool = lazy(() => import('@/pages/docs/mcp/DoctrineGetTool'))
const DoctrineHarvestListTool = lazy(() => import('@/pages/docs/mcp/DoctrineHarvestListTool'))
const DoctrineHarvestGetTool = lazy(() => import('@/pages/docs/mcp/DoctrineHarvestGetTool'))
const RecordDoctrineEpisodeTool = lazy(() => import('@/pages/docs/mcp/RecordDoctrineEpisodeTool'))
const HarvestDoctrineEpisodesTool = lazy(() => import('@/pages/docs/mcp/HarvestDoctrineEpisodesTool'))
const ProposeDoctrineCandidateTool = lazy(() => import('@/pages/docs/mcp/ProposeDoctrineCandidateTool'))
const PreregisterDoctrineExperimentTool = lazy(() => import('@/pages/docs/mcp/PreregisterDoctrineExperimentTool'))
const RecordDoctrineTreatmentRunTool = lazy(() => import('@/pages/docs/mcp/RecordDoctrineTreatmentRunTool'))
const AdmitDoctrineCandidateTool = lazy(() => import('@/pages/docs/mcp/AdmitDoctrineCandidateTool'))
const DoctrineOrdersTool = lazy(() => import('@/pages/docs/mcp/DoctrineOrdersTool'))
const RecordDoctrineApplicationTool = lazy(() => import('@/pages/docs/mcp/RecordDoctrineApplicationTool'))
const RecordDoctrineOutcomeTool = lazy(() => import('@/pages/docs/mcp/RecordDoctrineOutcomeTool'))
const ContestDoctrineTool = lazy(() => import('@/pages/docs/mcp/ContestDoctrineTool'))
const SupersedeDoctrineTool = lazy(() => import('@/pages/docs/mcp/SupersedeDoctrineTool'))
const RetireDoctrineTool = lazy(() => import('@/pages/docs/mcp/RetireDoctrineTool'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <DocumentMeta />
        <ScrollToTop />
        <HashScroll />
        <TypeThemeSwitcher />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<App />} />
              <Route path="/mac-preview" element={<MacPreviewPage />} />
              <Route path="/scout" element={<ScoutPage />} />
              <Route path="/accountability" element={<AccountabilityPage />} />
              {/* The playground IS the pd-tube page now; the old marketing page
                  is retired and the /playground URL redirects in. */}
              <Route path="/pd-tube" element={<PdTubePlayground />} />
              <Route path="/pd-tube/playground" element={<Navigate to="/pd-tube" replace />} />
              <Route path="/skill-audit" element={<SkillAuditPage />} />
              <Route path="/examples" element={<ExamplesPage />} />
              <Route path="/examples/:slug" element={<ExampleDetailPage />} />
              {/* Skills + MCP page retired; its install + skill story merged into the Mac app page. */}
              <Route path="/mcp" element={<Navigate to="/mac-preview" replace />} />
              <Route path="/templates" element={<Navigate to="/agents/templates" replace />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/agent-skill" element={<Navigate to="/mac-preview" replace />} />
              <Route path="/agents/:section" element={<AgentsPage />} />

              <Route path="/tutorials" element={<TutorialsPage />} />
              <Route path="/tutorials/getting-started" element={<GettingStarted />} />
              <Route path="/tutorials/semantic-identities" element={<SemanticIdentities />} />
              <Route path="/tutorials/multi-agent" element={<MultiAgentOrchestration />} />
              <Route path="/tutorials/monorepo" element={<Monorepo />} />
              <Route path="/tutorials/debugging" element={<Debugging />} />
              <Route path="/tutorials/tunnel" element={<TunnelTutorial />} />
              <Route path="/tutorials/dns" element={<DNSResolver />} />
              <Route path="/tutorials/session-phases" element={<SessionPhases />} />
              <Route path="/tutorials/inbox" element={<Inbox />} />
              <Route path="/tutorials/sugar" element={<Sugar />} />
              <Route path="/tutorials/always-on" element={<AlwaysOn />} />
              <Route path="/tutorials/pd-spawn" element={<Spawn />} />
              <Route path="/tutorials/harbors" element={<Harbors />} />
              <Route path="/tutorials/time-travel" element={<TimeTravel />} />
              <Route path="/tutorials/pipelines" element={<Pipelines />} />
              <Route path="/tutorials/watch" element={<Watch />} />
              <Route path="/tutorials/remote-harbors" element={<RemoteHarbors />} />
              <Route path="/tutorials/fleet" element={<Fleet />} />
              <Route path="/tutorials/pheromone" element={<Pheromone />} />
              <Route path="/tutorials/primitives" element={<Primitives />} />
              <Route path="/tutorials/pd-tube" element={<PdTube />} />
              <Route path="/tutorials/doctrine-cycle" element={<DoctrineCycle />} />

              <Route path="/cookbook" element={<LegacyExampleRedirect />} />
              <Route path="/cookbook/:id" element={<LegacyExampleRedirect />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/integrations/:id" element={<IntegrationPage />} />
              <Route path="/templates/:id" element={<Navigate to="/agents/templates" replace />} />

              <Route path="/blog" element={<BlogPage />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />

              <Route path="/manifesto" element={<ManifestoPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/harness" element={<HarnessPage />} />
              <Route path="/squid-codex" element={<SquidCodexPage />} />
              <Route path="/cryptography" element={<Navigate to="/security" replace />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/research" element={<ResearchLibraryPage />} />
              {/* /whitepaper now forwards to the Library (the canonical home for
                  the papers). The URL is preserved as a forwarding link because
                  it was shared externally. Deep links to individual papers below
                  still resolve. */}
              <Route path="/whitepaper" element={<Navigate to="/library" replace />} />
              <Route path="/whitepaper/rounds" element={<WhitepaperRoundsPage />} />
              <Route path="/whitepaper/how-we-prove-game-theory" element={<WhitepaperHowWeProvePage />} />
              <Route path="/whitepaper/:paperSlug" element={<WhitepaperDetailPage />} />

              <Route path="/landscape" element={<LandscapePage />} />

              <Route path="/cli-backend" element={<CliBackendPage />} />
            </Route>

            <Route path="/docs" element={<DocsLayout />}>
              <Route index element={<DocsOverview />} />
              <Route path="quickstart" element={<QuickStart />} />
              {/* Forwarding redirect: "Get started" links historically pointed at
                  /docs/get-started, which had no route and fell through to the docs
                  index. Canonical entry point is /docs/quickstart. */}
              <Route path="get-started" element={<Navigate to="/docs/quickstart" replace />} />
              <Route path="guides/prompting-agents" element={<PromptingAgents />} />
              <Route path="guides/templates" element={<TemplatesGuide />} />
              <Route path="guides/protocol" element={<ProtocolGuide />} />

              <Route path="cli" element={<CliOverview />} />
              <Route path="cli/claim" element={<ClaimCommand />} />
              <Route path="cli/release" element={<ReleaseCommand />} />
              <Route path="cli/find" element={<FindCommand />} />
              <Route path="cli/services" element={<ServicesCommand />} />
              <Route path="cli/scan" element={<ScanCommand />} />
              <Route path="cli/up" element={<UpCommand />} />
              <Route path="cli/down" element={<DownCommand />} />
              <Route path="cli/status" element={<StatusCommand />} />
              <Route path="cli/begin" element={<BeginCommand />} />
              <Route path="cli/done" element={<DoneCommand />} />
              <Route path="cli/whoami" element={<WhoamiCommand />} />
              <Route path="cli/note" element={<NoteCommand />} />
              <Route path="cli/notes" element={<NotesCommand />} />
              <Route path="cli/lock-acquire" element={<LockAcquireCommand />} />
              <Route path="cli/lock-release" element={<LockReleaseCommand />} />
              <Route path="cli/with-lock" element={<WithLockCommand />} />
              <Route path="cli/msg" element={<MsgCommand />} />
              <Route path="cli/pub" element={<PubCommand />} />
              <Route path="cli/watch" element={<WatchCommand />} />
              <Route path="cli/spawn" element={<SpawnCommand />} />
              <Route path="cli/spawned" element={<SpawnedCommand />} />
              <Route path="cli/agent-register" element={<AgentRegisterCommand />} />
              <Route path="cli/salvage" element={<SalvageCommand />} />
              <Route path="cli/salvage-claim" element={<SalvageClaimCommand />} />
              <Route path="cli/dns" element={<DnsCommand />} />
              <Route path="cli/harbor-create" element={<HarborCreateCommand />} />
              <Route path="cli/harbor-enter" element={<HarborEnterCommand />} />
              <Route path="cli/harbor-leave" element={<HarborLeaveCommand />} />
              <Route path="cli/harbors" element={<HarborsCommand />} />
              <Route path="cli/tunnel" element={<TunnelCommand />} />
              <Route path="cli/tunnel-stop" element={<TunnelStopCommand />} />
              <Route path="cli/fleet" element={<FleetCommand />} />
              <Route path="cli/init" element={<InitCommand />} />
              <Route path="cli/mcp-install" element={<McpInstallCommand />} />
              <Route path="cli/roadmap" element={<RoadmapCommand />} />
              <Route path="cli/tube" element={<TubeCommand />} />
              <Route path="cli/:commandSlug" element={<GenericCliCommandPage />} />

              <Route path="features/ports" element={<PortsFeature />} />
              <Route path="features/radio" element={<RadioFeature />} />
              <Route path="features/harbors" element={<HarborsFeature />} />
              <Route path="features/avatars" element={<AvatarsFeature />} />
              <Route path="features/salvage" element={<SalvageFeature />} />
              <Route path="features/timeline" element={<TimelineFeature />} />
              <Route path="concepts/claim-tree" element={<ClaimTreeConcept />} />
              <Route path="features/dns" element={<DnsFeature />} />
              <Route path="features/remote" element={<RemoteFeature />} />
              <Route path="features/sessions" element={<SessionsFeature />} />
              <Route path="features/tunnels" element={<TunnelsFeature />} />
              <Route path="features/pheromone" element={<PheromoneFeature />} />
              <Route path="features/fleet" element={<FleetFeature />} />
              <Route path="features/tuples" element={<TuplesFeature />} />
              <Route path="features/arbiter" element={<ArbiterFeature />} />
              <Route path="features/relay-pki" element={<RelayPkiFeature />} />
              <Route path="features/doctrine" element={<DoctrineFeature />} />

              <Route path="sdk" element={<SdkOverview />} />
              <Route path="sdk/ports" element={<PortsSdk />} />
              <Route path="sdk/sessions" element={<SessionsSdk />} />
              <Route path="sdk/locks" element={<LocksSdk />} />
              <Route path="sdk/harbors" element={<HarborsSdk />} />
              <Route path="sdk/scan-services" element={<ScanServices />} />
              <Route path="sdk/up" element={<SdkUp />} />
              <Route path="sdk/down" element={<SdkDown />} />
              <Route path="sdk/status" element={<SdkStatus />} />
              <Route path="sdk/whoami" element={<SdkWhoami />} />
              <Route path="sdk/add-note" element={<AddNote />} />
              <Route path="sdk/list-notes" element={<ListNotes />} />
              <Route path="sdk/done-session" element={<DoneSession />} />
              <Route path="sdk/release-lock" element={<ReleaseLock />} />
              <Route path="sdk/with-lock" element={<SdkWithLock />} />
              <Route path="sdk/subscribe" element={<Subscribe />} />
              <Route path="sdk/watch" element={<SdkWatch />} />
              <Route path="sdk/leave-harbor" element={<LeaveHarbor />} />
              <Route path="sdk/list-harbors" element={<ListHarbors />} />
              <Route path="sdk/dns-register" element={<DnsRegister />} />
              <Route path="sdk/dns-resolve" element={<DnsResolve />} />
              <Route path="sdk/spawn" element={<SdkSpawn />} />
              <Route path="sdk/list-spawned" element={<ListSpawned />} />
              <Route path="sdk/register-agent" element={<RegisterAgent />} />
              <Route path="sdk/salvage" element={<SdkSalvage />} />
              <Route path="sdk/salvage-claim" element={<SdkSalvageClaim />} />
              <Route path="sdk/tunnel" element={<SdkTunnel />} />
              <Route path="sdk/tunnel-stop" element={<SdkTunnelStop />} />

              <Route path="mcp" element={<McpOverview />} />
              <Route path="mcp/claude" element={<McpOverview />} />
              <Route path="mcp/cursor" element={<McpOverview />} />
              <Route path="mcp/windsurf" element={<McpOverview />} />
              <Route path="mcp/custom" element={<McpOverview />} />
              <Route path="mcp/claim-port" element={<ClaimPortTool />} />
              <Route path="mcp/release-port" element={<ReleasePortTool />} />
              <Route path="mcp/find-port" element={<FindPortTool />} />
              <Route path="mcp/list-services" element={<ListServicesTool />} />
              <Route path="mcp/begin-session" element={<BeginSessionTool />} />
              <Route path="mcp/done-session" element={<DoneSessionTool />} />
              <Route path="mcp/publish-message" element={<PublishMessageTool />} />
              <Route path="mcp/acquire-lock" element={<AcquireLockTool />} />
              <Route path="mcp/create-harbor" element={<CreateHarborTool />} />
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
              <Route path="mcp/doctrine-list" element={<DoctrineListTool />} />
              <Route path="mcp/doctrine-get" element={<DoctrineGetTool />} />
              <Route path="mcp/doctrine-harvest-list" element={<DoctrineHarvestListTool />} />
              <Route path="mcp/doctrine-harvest-get" element={<DoctrineHarvestGetTool />} />
              <Route path="mcp/record-doctrine-episode" element={<RecordDoctrineEpisodeTool />} />
              <Route path="mcp/harvest-doctrine-episodes" element={<HarvestDoctrineEpisodesTool />} />
              <Route path="mcp/propose-doctrine-candidate" element={<ProposeDoctrineCandidateTool />} />
              <Route path="mcp/preregister-doctrine-experiment" element={<PreregisterDoctrineExperimentTool />} />
              <Route path="mcp/record-doctrine-treatment-run" element={<RecordDoctrineTreatmentRunTool />} />
              <Route path="mcp/admit-doctrine-candidate" element={<AdmitDoctrineCandidateTool />} />
              <Route path="mcp/doctrine-orders" element={<DoctrineOrdersTool />} />
              <Route path="mcp/record-doctrine-application" element={<RecordDoctrineApplicationTool />} />
              <Route path="mcp/record-doctrine-outcome" element={<RecordDoctrineOutcomeTool />} />
              <Route path="mcp/contest-doctrine" element={<ContestDoctrineTool />} />
              <Route path="mcp/supersede-doctrine" element={<SupersedeDoctrineTool />} />
              <Route path="mcp/retire-doctrine" element={<RetireDoctrineTool />} />

              <Route path="api" element={<ApiReference />} />
              <Route path="api/endpoints" element={<ApiReference />} />

              <Route path="decisions" element={<Decisions />} />

              <Route path="examples/*" element={<Navigate to="/examples" replace />} />
              <Route path=":sectionSlug/*" element={<DocsSectionPage />} />
              <Route path="*" element={<Navigate to="/docs" replace />} />
            </Route>

            {/* Legacy docs route retired — redirect to the current docs. */}
            <Route path="/docs-old" element={<Navigate to="/docs" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
