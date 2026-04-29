import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Box,
  Clock,
  Droplets,
  Eye,
  Globe,
  History,
  Mail,
  Monitor,
  Radio,
  Search,
  Share2,
  Shield,
  Ship,
  Sparkles,
  Terminal,
  Workflow,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { TUTORIALS as TUTORIALS_DATA } from '@/data/tutorials'
import {
  BracketLabel,
  LandingStatsStrip,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelList,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, any> = {
  'getting-started': Sparkles,
  'multi-agent': Share2,
  'monorepo': Box,
  'debugging': Search,
  'tunnel': Globe,
  'dns': Globe,
  'session-phases': Workflow,
  'inbox': Mail,
  'sugar': Terminal,
  'always-on': Eye,
  'pd-spawn': Bot,
  'harbors': Shield,
  'dashboard': Monitor,
  'time-travel': History,
  'pipelines': Workflow,
  'watch': Radio,
  'remote-harbors': Ship,
  'fleet': Bot,
  'pheromone': Droplets,
}

interface TutorialWithIcon {
  slug: string
  number: string
  title: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  time: string
  tags: string[]
  href: string
  icon: any
}

const TUTORIALS: TutorialWithIcon[] = TUTORIALS_DATA.map((tutorial) => ({
  ...tutorial,
  icon: ICON_MAP[tutorial.slug] ?? Terminal,
}))

const TOTAL_TIME = TUTORIALS.reduce((acc, tutorial) => acc + Number.parseInt(tutorial.time, 10), 0)
const ADVANCED_COUNT = TUTORIALS.filter((tutorial) => tutorial.level === 'advanced').length

const heroStats = [
  { value: String(TUTORIALS.length), label: 'lessons', tone: 'paper' as const },
  { value: `${TOTAL_TIME} min`, label: 'guided operator time', tone: 'blue' as const },
  { value: `${ADVANCED_COUNT} advanced`, label: 'deep-dive lessons', tone: 'lime' as const },
] as const

const academyScope = [
  'Claim stable ports before you chase orchestration.',
  'Learn session notes, salvage, and pub/sub in the order operators actually use them.',
  'Move from one daemon on one laptop to fleets only after the local model is solid.',
] as const

const finalStrip = [
  { value: 'CLI', label: 'live command paths', tone: 'paper' as const },
  { value: 'Local', label: 'single-daemon operator model', tone: 'blue' as const },
  { value: 'Recoverable', label: 'sessions, notes, salvage', tone: 'lime' as const },
] as const

const levelTone = {
  beginner: 'accent',
  intermediate: 'default',
  advanced: 'primary',
} as const

function accentForIndex(index: number) {
  return index % 2 === 0 ? 'blue' : 'lime'
}

function TutorialCatalogCard({
  tutorial,
  index,
}: {
  tutorial: TutorialWithIcon
  index: number
}) {
  const Icon = tutorial.icon
  const accent = accentForIndex(index)
  const accentPanelTone = accent === 'blue' ? 'primary' : 'accent'
  const accentBlockClass =
    accent === 'blue'
      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
      : 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, delay: index * 0.03, ease: 'easeOut' }}
      className="h-full"
    >
      <Link to={tutorial.href} className="block h-full no-underline">
        <SurfacePanel
          elevation="raised"
          padding="compact"
          className="flex h-full flex-col gap-[var(--panel-gap)] transition-transform duration-150 hover:-translate-y-1"
        >
          <div className="grid border-b-2 border-[var(--border-strong)] md:grid-cols-[7rem_minmax(0,1fr)]">
            <div className={cn('flex min-h-[7.5rem] flex-col justify-between border-b-2 border-[var(--border-strong)] p-[var(--space-3)] md:border-b-0 md:border-r-2', accentBlockClass)}>
              <PanelEyebrow tone={accentPanelTone}>Lesson</PanelEyebrow>
              <PanelTitle
                as="p"
                size="section"
                tone={accentPanelTone}
                className="max-w-none text-[clamp(2.75rem,5vw,4.5rem)] leading-none"
              >
                {tutorial.number}
              </PanelTitle>
            </div>

            <div className="flex min-h-[7.5rem] flex-col justify-between gap-[var(--space-3)] p-[var(--space-3)]">
              <div className="flex items-center justify-between gap-[var(--space-3)]">
                <BracketLabel tone={levelTone[tutorial.level]}>
                  {tutorial.level}
                </BracketLabel>
                <Icon
                  size={18}
                  className={accent === 'blue' ? 'text-[var(--brand-primary)]' : 'text-[var(--brand-accent)]'}
                />
              </div>

              <PanelTitle as="h3" size="card" className="max-w-[16ch]">
                {tutorial.title}
              </PanelTitle>
            </div>
          </div>

          <PanelBody size="compact" className="max-w-none">
            {tutorial.description}
          </PanelBody>

          <div className="mt-auto space-y-[var(--space-4)]">
            <div className="flex flex-wrap gap-[var(--space-2)]">
              {tutorial.tags.map((tag) => (
                <BracketLabel key={tag}>{tag}</BracketLabel>
              ))}
            </div>

            <div className="flex items-center justify-between gap-[var(--space-3)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <Clock size={14} className="text-[var(--brand-primary)]" />
                <PanelEyebrow>{tutorial.time}</PanelEyebrow>
              </div>

              <div
                className={cn(
                  'inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]',
                  accentBlockClass,
                )}
              >
                <PanelEyebrow tone={accentPanelTone}>Open lesson</PanelEyebrow>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </SurfacePanel>
      </Link>
    </motion.article>
  )
}

export function TutorialsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col"
      style={{ background: 'var(--surface-base)' }}
    >
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
        <PageContainer width="wide" className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,1.04fr)_minmax(22rem,0.78fr)] xl:items-start">
          <div className="space-y-[var(--space-5)]">
            <BracketLabel>Academy catalog</BracketLabel>

            <div className="space-y-[var(--space-3)]">
              <PanelTitle as="h1" size="hero" className="max-w-[9ch]">
                Learn the swarm.
              </PanelTitle>
              <div className="inline-flex border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)]">
                <PanelTitle as="p" size="section" tone="primary" className="max-w-none">
                  From claim to fleet.
                </PanelTitle>
              </div>
            </div>

            <PanelBody className="max-w-[46rem]">
              Start with a single port claim, then build up through session notes, pub/sub,
              salvage, harbors, and background fleets. The academy teaches the control plane in
              the same order operators actually meet it.
            </PanelBody>

            <LandingStatsStrip stats={heroStats} />
          </div>

          <div className="grid gap-[var(--space-4)]">
            <Link to="/tutorials/getting-started" className="block no-underline">
              <SurfacePanel tone="blue" className="h-full space-y-[var(--panel-gap)]">
                <BracketLabel tone="primary" surface="blue">
                  Recommended path
                </BracketLabel>
                <PanelTitle as="h2" size="card" tone="primary" className="max-w-[12ch]">
                  Start with Lesson 01 and earn the mental model first.
                </PanelTitle>
                <PanelBody tone="primary" size="compact" className="max-w-none">
                  Install the daemon, claim a stable identity, and use the live CLI before you
                  touch fleets, watches, or harbor boundaries.
                </PanelBody>
                <div className="flex items-center gap-[var(--space-2)] border-t-2 border-[color:var(--brand-primary-foreground-subtle)] pt-[var(--space-3)]">
                  <PanelEyebrow tone="primary">Open getting started</PanelEyebrow>
                  <ArrowRight size={14} className="text-[var(--brand-primary-foreground)]" />
                </div>
              </SurfacePanel>
            </Link>

            <SurfacePanel tone="lime" className="space-y-[var(--panel-gap)]">
              <BracketLabel tone="accent" surface="lime">
                Coverage
              </BracketLabel>
              <PanelTitle as="h2" size="card" tone="accent" className="max-w-[13ch]">
                Learn the whole operator arc, not isolated tricks.
              </PanelTitle>
              <PanelList
                items={[...academyScope]}
                tone="accent"
                size="compact"
                className="max-w-none"
              />
            </SurfacePanel>
          </div>
        </PageContainer>
      </section>

      <main className="flex-1">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="space-y-[var(--space-7)]">
            <div className="max-w-[44rem] space-y-[var(--space-3)]">
              <BracketLabel>Lesson catalog</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                Nineteen lessons. One operator story.
              </PanelTitle>
              <PanelBody className="max-w-[46rem]">
                Each card is a direct path into a real coordination primitive. No mascot theater,
                no soft UI filler, no pretend dashboard state.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-3">
              {TUTORIALS.map((tutorial, index) => (
                <TutorialCatalogCard key={tutorial.slug} tutorial={tutorial} index={index} />
              ))}
            </div>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)] lg:items-end">
            <div className="space-y-[var(--space-3)]">
              <BracketLabel>Why this works</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Learn the real control plane, not a slide deck about one.
              </PanelTitle>
              <PanelBody className="max-w-[42rem]">
                The academy is intentionally local-first. You learn claims, notes, locks, pub/sub,
                salvage, and fleets as operator behaviors, so the product stays legible when the
                runtime gets busy.
              </PanelBody>
            </div>

            <LandingStatsStrip stats={finalStrip} />
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
