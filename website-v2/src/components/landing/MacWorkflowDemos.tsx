import { useState } from 'react'
import { motion } from 'framer-motion'
import { Cpu, KeyRound, MonitorCheck, Play, Radar, Square } from 'lucide-react'
import { PageContainer, PanelBody, PanelEyebrow, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { TerminalGif } from '@/components/site/TerminalGif'
import { RoleTerm } from '@/components/site/RoleTerm'
import { MCP_TOOL_TOTAL } from '@/data/mcp'

type DemoMedia =
  | {
      type: 'image'
      light: string
      dark: string
      alt: string
      caption: string
    }
  | {
      type: 'gif'
      src: string
      title: string
      caption: string
    }

type MacAppDemo = {
  id: string
  title: string
  description: string
  media: DemoMedia
  evidence: string[]
}

const MAC_APP_DEMOS: MacAppDemo[] = [
  {
    id: 'agent-radio',
    title: 'Agent Radio',
    description: 'Agents leave signals for agents',
    media: {
      type: 'gif',
      src: '/gifs/agents/communication-protocols.gif',
      title: 'Agent Radio recording',
      caption: 'A real terminal recording with command output, kept as agent proof instead of human setup UI.',
    },
    evidence: [
      'Notes, signals, and actor messages stay durable after a shell exits.',
      'The operator reads coordination state in Activity, Channels, Inbox, and Flow.',
      'Terminal evidence is acceptable here because the recording includes daemon responses.',
    ],
  },
  {
    id: 'mac-setup',
    title: 'Mac Setup',
    description: 'Install daemon, MCP, FleetBar',
    media: {
      type: 'image',
      light: '/img/app-screens/fleetbar-native-shell-light.webp',
      dark: '/img/app-screens/fleetbar-native-shell-dark.webp',
      alt: 'FleetBar native Mac shell around the Fleet Control Center',
      caption: 'FleetBar is the human entry point after agent-side setup work runs.',
    },
    evidence: [
      'Project selection, daemon state, and Fleet Control Center chrome appear in the Mac app.',
      'Setup commands belong in docs and agent workflows where their output can be checked.',
      'Humans should start with the app surface, not a paste-this-command card.',
    ],
  },
  {
    id: 'mcp-tools',
    title: 'MCP Tools',
    description: `${MCP_TOOL_TOTAL} functions visible`,
    media: {
      type: 'image',
      light: '/img/app-screens/resources-light.webp',
      dark: '/img/app-screens/resources-dark.webp',
      alt: 'Fleet Control Center resources surface showing readiness and capacity',
      caption: 'The app turns MCP and runtime capability into inspectable readiness.',
    },
    evidence: [
      'Capability breadth is an app/readiness surface, not a wall of function names.',
      'Resource pressure and dependency state sit next to launch choices.',
      'The operator can compare capacity before letting agents spend work.',
    ],
  },
  {
    id: 'keys',
    title: 'API Keys',
    description: 'Make missing backends obvious',
    media: {
      type: 'image',
      light: '/img/app-screens/resources-light.webp',
      dark: '/img/app-screens/resources-dark.webp',
      alt: 'Backend readiness surface in the Fleet Control Center',
      caption: 'Backend readiness is product UX: missing keys and dependencies are visible before launch.',
    },
    evidence: [
      'Readiness calls out missing provider keys, SDK packages, and model availability.',
      'Blocked backends fail closed before an operator launches a mission.',
      'The GUI explains what is missing without asking a human to parse curl output.',
    ],
  },
  {
    id: 'shipwright',
    title: 'Shipwright',
    description: 'Cold-start a new repo',
    media: {
      type: 'image',
      light: '/img/app-screens/shipwright-harbor-light.webp',
      dark: '/img/app-screens/shipwright-harbor-dark.webp',
      alt: 'Shipwright Harbor screen proposing a starter fleet',
      caption: 'Shipwright surveys the repo and proposes the first bounded fleet in the app.',
    },
    evidence: [
      'Survey, focus, simulation, and control are visible steps, not hidden shell state.',
      'The operator reviews budget, readiness, and launch count before activation.',
      'Flow, Agents, Resources, and YAML stay connected after the starter fleet is approved.',
    ],
  },
  {
    id: 'spawned-runs',
    title: 'Spawned Runs',
    description: 'Launch budgeted work',
    media: {
      type: 'image',
      light: '/img/app-screens/sorties-light.webp',
      dark: '/img/app-screens/sorties-dark.webp',
      alt: 'Spawned runs surface showing tracked one-shot agent work',
      caption: 'Spawned runs make budgeted one-shot work inspectable without relying on terminal scrollback.',
    },
    evidence: [
      'A spawned run has a budget, expected result, backend/model choice, and persisted event history.',
      'Completed work remains visible after the agent run exits.',
      'The operator sees launch status and outcome in the app before reading raw logs.',
    ],
  },
]

function DemoPreview({ demo }: { demo: MacAppDemo }) {
  if (demo.media.type === 'gif') {
    return (
      <TerminalGif
        src={demo.media.src}
        title={demo.media.title}
        caption={demo.media.caption}
        mediaClassName="!h-[clamp(18rem,34vw,30rem)]"
      />
    )
  }

  return (
    <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
      <picture>
        <source srcSet={demo.media.dark} media="(prefers-color-scheme: dark)" />
        <img
          src={demo.media.light}
          alt={demo.media.alt}
          className="aspect-[16/10] w-full object-contain"
          loading="lazy"
        />
      </picture>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-secondary)]">
        {demo.media.caption}
      </figcaption>
    </figure>
  )
}

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
              proposes a bounded fleet, and <RoleTerm role="spawn">spawned runs</RoleTerm> handle explicit
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
                  ) : demo.id === 'spawned-runs' ? (
                    <Radar size={14} className="text-[var(--text-muted)]" />
                  ) : demo.id === 'mac-setup' ? (
                    <MonitorCheck size={14} className="text-[var(--text-muted)]" />
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
            className="grid min-w-0 max-w-full gap-[var(--space-4)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.42fr)]"
          >
            <DemoPreview demo={activeDemo} />
            <div className="grid content-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
              <PanelEyebrow>Operator evidence</PanelEyebrow>
              <PanelTitle as="h3" size="card" className="max-w-[14ch]">
                {activeDemo.title}
              </PanelTitle>
              <ul className="grid gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-secondary)]">
                {activeDemo.evidence.map((item) => (
                  <li key={item} className="border-t border-[var(--border-subtle)] pt-[var(--space-2)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
