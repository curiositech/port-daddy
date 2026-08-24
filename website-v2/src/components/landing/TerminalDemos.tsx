import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { PortholeEmbed } from '@/components/porthole/PortholeEmbed'

/**
 * The landing page's terminal demos, replaying real `pd` sessions.
 *
 * Motivation: this used to render hand-written strings through a typewriter
 * animation, under copy claiming "these are real recordings, with the
 * daemon answering back" — an audit of the site
 * (`demos/porthole/AUDIT-2026-08-18.md`) found the output didn't match what
 * the CLI actually prints, because nothing here was ever recorded. Each
 * `cast` below is a genuine asciicast capture of the real, released `pd`
 * CLI against a live local daemon — recorded with
 * `website-v2/scripts/record-porthole-cast.sh` per the capture doctrine in
 * `demos/porthole/PLAN.md`, gated in CI by `check-porthole-casts.mjs`,
 * replayed here as real, selectable DOM text (not a GIF, not a re-typed
 * string) via `PortholeEmbed`.
 */
const DEMOS = [
  {
    id: 'collision',
    title: 'No Collisions',
    description: 'Two agents about to touch the same thing — stopped cold',
    cast: '/casts/porthole/collision.cast',
  },
  {
    id: 'visibility',
    title: 'Catch Up Instantly',
    description: 'Two agents leave real notes while you’re away — one command hands you the whole picture',
    cast: '/casts/porthole/visibility.cast',
  },
  {
    id: 'ports',
    title: 'No Port Fights',
    description: 'Two services, one default port, zero EADDRINUSE',
    cast: '/casts/porthole/ports.cast',
  },
  {
    id: 'recovery',
    title: 'Nothing Lost',
    description: 'A warning sent before you logged off is waiting when you log on — even offline, never missed',
    cast: '/casts/porthole/recovery.cast',
  },
  {
    id: 'quickstart',
    title: 'First Contact',
    description: 'From zero to a coordinated session in under a minute',
    cast: '/casts/porthole/quickstart.cast',
  },
]

export function TerminalDemos() {
  const [activeDemo, setActiveDemo] = useState(DEMOS[0])

  return (
    <section id="demos" className="relative py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="See it run for real"
          title="Under the app is a real local API your agents can drive."
          description="The app is where you watch and steer. Underneath it is a set of commands your agents can script themselves: claim a port, hold a lock, leave a note, hand off a job, recover work from a crash. Every replay below is a genuine asciicast capture of the released pd CLI against a live daemon — real text, full scrollback, select any line and copy it."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[46rem]"
          titleClassName="max-w-[20ch]"
          bodyClassName="max-w-[39rem]"
        />

        <div className="grid w-full min-w-0 max-w-full gap-4 overflow-hidden sm:gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
          {/* Tabs */}
          <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:flex lg:flex-col lg:pb-0">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className={`min-w-0 cursor-pointer rounded-[var(--radius-lg)] px-4 py-3 text-left transition-all duration-200 ${
                  activeDemo.id === demo.id
                    ? 'bg-[var(--surface-overlay)] shadow-[var(--shadow-inset)]'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  {activeDemo.id === demo.id ? (
                    <Play size={14} className="text-[var(--brand-primary)]" fill="var(--brand-primary)" />
                  ) : (
                    <Square size={14} className="text-[var(--text-muted)]" />
                  )}
                  <PanelTitle as="span" size="nav" className={`max-w-none ${
                    activeDemo.id === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {demo.title}
                  </PanelTitle>
                </div>
                {/*
                  Indent aligns the description under the demo title,
                  clearing the 14px Square icon + gap. --space-5 (24px)
                  is the closest grid step.
                */}
                <PanelBody size="compact" className="ml-[var(--space-5)] mt-[var(--space-1)] max-w-none">
                  {demo.description}
                </PanelBody>
              </button>
            ))}
          </div>

          {/* Terminal */}
          <motion.div
            key={activeDemo.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="min-w-0 max-w-full overflow-hidden"
          >
            <PortholeEmbed src={activeDemo.cast} label={`${activeDemo.title} — ${activeDemo.description}`} eager />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
