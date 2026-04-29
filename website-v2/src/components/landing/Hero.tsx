import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import {
  BracketLabel,
  LandingStatsStrip,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  TruthBadge,
} from '@/components/site/primitives'

const HERO_RAIL = [
  {
    label: 'Atomic ports',
    text: 'Deterministic claims keep every local service and agent attached to the same identity.',
  },
  {
    label: 'Shared signals',
    text: 'Pub/sub channels and session notes give the whole swarm one operational thread.',
  },
  {
    label: 'Recovery built in',
    text: 'Salvage dead work, keep provenance, and resume without log archaeology.',
  },
] as const

const HERO_STATS = [
  { value: 'Single daemon', label: 'Control authority', tone: 'paper' as const },
  { value: 'Local-first', label: 'Operating model', tone: 'blue' as const },
  { value: 'Crash salvage', label: 'Recovery path', tone: 'lime' as const },
]

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative overflow-hidden border-b-2 border-[var(--border-strong)] pt-[calc(var(--space-10)+var(--space-7))] pb-[var(--section-space-y)] lg:pb-[var(--section-space-y-lg)]">
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="absolute left-[var(--layout-gutter)] top-0 h-full w-px bg-[var(--border-subtle)] lg:left-[calc(var(--layout-gutter-lg)*1.5)]" />
        <div className="absolute right-[var(--layout-gutter)] top-0 h-full w-px bg-[var(--border-subtle)] lg:right-[calc(var(--layout-gutter-lg)*1.5)]" />
        <div className="absolute inset-x-0 top-[22%] h-px bg-[var(--border-subtle)]" />
      </div>

      <PageContainer width="wide" className="relative z-10 space-y-[var(--space-8)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <Link to="/mcp" className="group inline-flex items-center gap-[var(--space-2)] no-underline">
            <BracketLabel className="group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--brand-primary-foreground)]">
              New
            </BracketLabel>
            <PanelEyebrow className="text-[var(--text-primary)]">
              Fleet + auto-respawn for background agents
            </PanelEyebrow>
            <ArrowRight
              size={14}
              className="text-[var(--text-muted)] transition-transform duration-[var(--duration-fast)] group-hover:translate-x-1 group-hover:text-[var(--text-primary)]"
            />
          </Link>
          <div className="hidden h-px flex-1 bg-[var(--border-default)] md:block" />
          <TruthBadge truth="Live" />
        </div>

        <div className="grid gap-[var(--space-7)] xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)] xl:items-start">
          <div className="space-y-[var(--space-6)]">
            <SectionIntro
              eyebrow="Multi-agent control plane"
              title={
                <>
                  <span className="block">Stop your agents</span>
                  <span className="mt-[var(--space-2)] inline-block bg-[var(--brand-primary)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--brand-primary-foreground)]">
                    from fighting each other.
                  </span>
                </>
              }
              description="Port Daddy is the single-daemon control plane for local agent work. Claim ports deterministically, coordinate over named channels, lock files before edits, and salvage dead sessions without guessing what happened."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[11ch]"
              bodyClassName="max-w-[38rem]"
            />

            <div className="grid border-y-2 border-[var(--border-strong)] md:grid-cols-3">
              {HERO_RAIL.map((item, index) => {
                return (
                  <div
                    key={item.label}
                    className={
                      index > 0
                        ? 'border-t border-[var(--border-default)] md:border-t-0 md:border-l'
                        : ''
                    }
                  >
                    <div className="space-y-[var(--space-2)] px-[var(--space-2)] py-[var(--space-4)]">
                      <div className="space-y-[var(--space-1)]">
                        <PanelEyebrow>{item.label}</PanelEyebrow>
                        <PanelBody size="compact" className="max-w-none">
                          {item.text}
                        </PanelBody>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <Button variant="primary" size="lg" onClick={() => setIsModalOpen(true)}>
                <Terminal size={16} />
                Get Started
                <ArrowRight size={16} />
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link to="/mcp">MCP Integration</Link>
              </Button>
            </div>
          </div>

          <div className="xl:pl-[var(--space-4)]">
            <SurfacePanel className="overflow-hidden !p-0">
              <img
                src="/img/hero-portdaddy.png"
                alt="Illustrated Port Daddy harbor scene with a large anchor and moored network cable"
                className="block h-auto w-full border-b-2 border-[var(--border-strong)]"
              />

              <div className="grid gap-[var(--space-4)] p-[var(--space-5)] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-end">
                <div className="space-y-[var(--space-2)]">
                  <BracketLabel>Operator view</BracketLabel>
                  <PanelTitle as="p" size="card" className="max-w-[16ch]">
                    One daemon of record for every local agent move.
                  </PanelTitle>
                </div>

                <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
                  <div className="space-y-[var(--space-1)] border-l-2 border-[var(--border-default)] pl-[var(--space-3)]">
                    <PanelEyebrow>Install once</PanelEyebrow>
                    <PanelBody size="compact" className="max-w-none">
                      Local control plane, not another hosted dashboard.
                    </PanelBody>
                  </div>
                  <div className="space-y-[var(--space-1)] border-l-2 border-[var(--border-default)] pl-[var(--space-3)]">
                    <PanelEyebrow>Run any stack</PanelEyebrow>
                    <PanelBody size="compact" className="max-w-none">
                      Claude, Codex, Gemini, Ollama, Aider, or custom shells.
                    </PanelBody>
                  </div>
                  <div className="space-y-[var(--space-1)] border-l-2 border-[var(--border-default)] pl-[var(--space-3)]">
                    <PanelEyebrow>Recover fast</PanelEyebrow>
                    <PanelBody size="compact" className="max-w-none">
                      Sessions, notes, and salvage stay attached when a run dies.
                    </PanelBody>
                  </div>
                </div>
              </div>
            </SurfacePanel>
          </div>
        </div>

        <LandingStatsStrip stats={HERO_STATS} />
      </PageContainer>

      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
