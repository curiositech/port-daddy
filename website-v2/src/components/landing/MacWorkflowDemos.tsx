import { useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, KeyRound, Play, Radar, Square } from 'lucide-react'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'
import { ALL_CATEGORIES, MCP_TOOL_TOTAL } from '@/data/mcp'

const mcpCatalogText = ALL_CATEGORIES.map((category) => {
  const tools = category.tools.map((tool) => `  - ${tool}`).join('\n')
  return `${category.label} (${category.tools.length})\n${tools}`
}).join('\n\n')

const MAC_APP_DEMOS = [
  {
    id: 'agent-radio',
    title: 'Agent Radio',
    description: 'Agents leave signals for agents',
    code: `# One agent narrows its scope before editing
$ pd who-owns website-v2/src/components/landing/TerminalDemos.tsx
  claimed by session-1639... Finish PR5 docs/UI for PD Tube and PKI

# It leaves a durable note for the next agent
$ pd note "Moving Mac examples to MacWorkflowDemos; avoiding PR5-owned TerminalDemos."
  Note added to session

# It broadcasts the coordination risk without interrupting everyone
$ pd pub coordination:inconsistency '{"surface":"website-v2","risk":"overlap","action":"narrowed"}'
  Published to coordination:inconsistency

# It queues the durable coordination actor
$ pd actors coxswain --message "Session context and file claims disagree; please track."
  Message queued to actor:coxswain`,
  },
  {
    id: 'mac-setup',
    title: 'Mac Setup',
    description: 'Install daemon, MCP, FleetBar',
    code: `# Preferred developer path on macOS
$ brew install curiositech/tap/port-daddy
$ pd setup --project ~/coding/my-app
  daemon: installed and running
  mcp: configured for local clients
  fleetbar: installed in ~/Applications/Port Daddy/FleetBar.app
  project: initialized for Port Daddy

# FleetBar opens the same control plane the daemon serves
$ open "http://127.0.0.1:9876/fleet-ui/?surface=flow"
  Fleet Control Center ready`,
  },
  {
    id: 'mcp-tools',
    title: 'MCP Tools',
    description: `${MCP_TOOL_TOTAL} functions visible`,
    code: `# Port Daddy MCP exposes the full local coordination surface.
# Default mode starts small; pd_discover reveals these categories and functions.

${mcpCatalogText}`,
  },
  {
    id: 'keys',
    title: 'API Keys',
    description: 'Make missing backends obvious',
    code: `# Add the providers you actually want Port Daddy to launch
$ printf '\\nANTHROPIC_API_KEY=sk-ant-...\\n' >> ~/.port-daddy-env
$ printf 'GEMINI_API_KEY=...\\n' >> ~/.port-daddy-env
$ pd daemon restart
  daemon restarted

# The app reads readiness from /fleet/models
$ curl http://127.0.0.1:9876/fleet/models | jq '.backends[] | {id, readinessStatus, readinessSummary}'
  { "id": "claude", "readinessStatus": "ready", "readinessSummary": "ANTHROPIC_API_KEY present and Claude SDK installed" }
  { "id": "gemini", "readinessStatus": "needs_setup", "readinessSummary": "GEMINI_API_KEY missing..." }`,
  },
  {
    id: 'shipwright',
    title: 'Shipwright',
    description: 'Cold-start a new repo',
    code: `# Bring an existing app into the Fleet Control Center
$ pd setup --project ~/coding/my-app
  project marker written
  starter fleet available
  post-commit trigger checked

# Open the Shipwright workbench
$ open "http://127.0.0.1:9876/fleet-ui/?surface=shipwright&shipwright=harbor"
  Harbor: repo survey
  Focus: proposed agents, budgets, triggers
  Simulation: dry-run timeline and intervention events
  FleetControl: envelope + links to Flow, Agents, YAML`,
  },
  {
    id: 'sortie',
    title: 'Sortie',
    description: 'Launch a budgeted mission',
    code: `# A sortie is a tracked one-shot mission, not a background fleet
$ pd sortie run "Review the auth route for unsafe redirects" \\
    --backend codex \\
    --model gpt-5.4-mini \\
    --budget 0.50 \\
    --expected "Findings with file paths"
  Sortie sortie-01HY...: completed
  Project: my-app
  Harbor: my-app:sortie:sortie-01HY...
  Spawned: spawned-8a2f

$ pd sortie logs sortie-01HY... --limit 20
  sortie:created
  sortie:planned
  spawn:completed
  sortie:completed`,
  },
]

export function MacWorkflowDemos() {
  const [activeDemo, setActiveDemo] = useState(MAC_APP_DEMOS[0])

  return (
    <section id="app-examples" className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="App examples"
          title="Cold-start, keys, platform actors, one-offs."
          description={
            <>
              These are the workflows the website was missing: the Mac app opens the real control
              plane, backend readiness tells you what is missing, <RoleTerm role="shipwright">Shipwright</RoleTerm>{' '}
              proposes a bounded fleet, and <RoleTerm role="sortie">sorties</RoleTerm> run explicit
              one-shot missions.
            </>
          }
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[48rem]"
          titleClassName="max-w-[13ch]"
          bodyClassName="max-w-[38rem]"
        />

        <div className="grid w-full min-w-0 max-w-full gap-4 overflow-hidden sm:gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
          <div className="flex w-full max-w-full min-w-0 gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {MAC_APP_DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className="min-w-[10rem] shrink-0 cursor-pointer rounded-[var(--radius-lg)] px-4 py-3 text-left transition-all duration-200 lg:min-w-0 lg:shrink"
                style={{
                  background: activeDemo.id === demo.id ? 'var(--surface-overlay)' : 'transparent',
                  boxShadow: activeDemo.id === demo.id ? 'var(--shadow-inset)' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  {activeDemo.id === demo.id ? (
                    <Play size={14} className="text-[var(--brand-primary)]" fill="var(--brand-primary)" />
                  ) : demo.id === 'mcp-tools' ? (
                    <Cpu size={14} className="text-[var(--text-muted)]" />
                  ) : demo.id === 'keys' ? (
                    <KeyRound size={14} className="text-[var(--text-muted)]" />
                  ) : demo.id === 'sortie' ? (
                    <Radar size={14} className="text-[var(--text-muted)]" />
                  ) : (
                    <Square size={14} className="text-[var(--text-muted)]" />
                  )}
                  <PanelTitle as="span" size="nav" className={`max-w-none text-[1rem] ${
                    activeDemo.id === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {demo.title}
                  </PanelTitle>
                </div>
                <PanelBody size="compact" className="ml-[22px] mt-[var(--space-1)] max-w-none text-[0.875rem]">
                  {demo.description}
                </PanelBody>
              </button>
            ))}
          </div>

          <motion.div
            key={activeDemo.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="min-w-0 max-w-full overflow-hidden"
          >
            <CommandTerminal
              code={activeDemo.code}
              title={activeDemo.title}
              animate={activeDemo.id !== 'mcp-tools'}
              typewriterSpeed={12}
            />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
