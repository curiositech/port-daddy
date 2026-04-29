import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { TUTORIALS as TUTORIALS_DATA } from '@/data/tutorials'

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Foundation',
  intermediate: 'Practice',
  advanced: 'Operations',
}

const LEVEL_CLASS: Record<string, string> = {
  beginner: 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
  intermediate: 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
  advanced: 'bg-[var(--border-strong)] text-[var(--text-inverse)]',
}

const META_TEXT_CLASS =
  'font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]'
const META_MONO_CLASS =
  'font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]'

const TRACKS = [
  {
    label: 'Runtime basics',
    detail: 'Install, identity, ports, naming, and service discovery.',
  },
  {
    label: 'Agent work loops',
    detail: 'Sessions, notes, file claims, inboxes, and phase-aware handoff.',
  },
  {
    label: 'Automation paths',
    detail: 'Spawned agents, watchers, pipelines, fleets, and recovery.',
  },
]

export function TutorialsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col bg-[var(--surface-base)] font-sans"
    >
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--space-8)] lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,0.45fr)] lg:items-end">
            <div className="space-y-[var(--space-6)]">
              <PanelEyebrow>Operator training</PanelEyebrow>
              <PanelTitle as="h1" size="hero" className="max-w-[12ch]">
                Learn the control-plane protocol.
              </PanelTitle>
              <PanelBody size="default" className="max-w-[42rem] text-[length:var(--text-lg)]">
                A practical route through Port Daddy: claim stable identities, coordinate
                sessions, publish runtime signals, launch background agents, and recover
                work when a run fails.
              </PanelBody>
            </div>

            <aside className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
              <div className="grid grid-cols-3 gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-4)]">
                {[
                  { value: TUTORIALS_DATA.length.toString().padStart(2, '0'), label: 'lessons' },
                  { value: '05', label: 'min start' },
                  { value: '03', label: 'tracks' },
                ].map((stat) => (
                  <div key={stat.label} className="space-y-[var(--space-1)]">
                    <div className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--text-primary)]">
                      {stat.value}
                    </div>
                    <div className={`${META_TEXT_CLASS} text-[var(--text-muted)]`}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-[var(--space-4)] space-y-[var(--space-4)]">
                {TRACKS.map((track, index) => (
                  <div key={track.label} className="grid grid-cols-[2rem,1fr] gap-[var(--space-3)]">
                    <div className={`${META_MONO_CLASS} text-[var(--brand-primary)]`}>
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div>
                      <div className={`${META_TEXT_CLASS} text-[var(--text-primary)]`}>
                        {track.label}
                      </div>
                      <p className="mt-[var(--space-1)] text-sm leading-relaxed text-[var(--text-secondary)]">
                        {track.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </PageContainer>
      </section>

      <main className="flex-1 py-[var(--section-space-y)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--space-4)] sm:grid-cols-2 xl:grid-cols-3">
            {TUTORIALS_DATA.map((tutorial, index) => (
              <motion.article
                key={tutorial.slug}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: index * 0.025 }}
                className="h-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)] transition-colors hover:bg-[var(--surface-raised)]"
              >
                <Link to={tutorial.href} className="flex h-full flex-col gap-[var(--space-4)] p-[var(--space-5)] text-[var(--text-primary)]">
                  <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                    <span className={`${META_MONO_CLASS} text-[var(--text-primary)]`}>
                      {tutorial.number}
                    </span>
                    <span
                      className={`border-2 border-[var(--border-strong)] px-[var(--space-2)] py-[var(--space-1)] ${META_TEXT_CLASS} ${LEVEL_CLASS[tutorial.level]}`}
                    >
                      {LEVEL_LABEL[tutorial.level]}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-[var(--space-3)]">
                    <PanelTitle as="h2" size="nav" className="max-w-none">
                      {tutorial.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none flex-1">
                      {tutorial.description}
                    </PanelBody>
                  </div>

                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    {tutorial.tags.map((tag) => (
                      <span
                        key={tag}
                        className="border border-[var(--border-default)] px-[var(--space-2)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
                    <div className="flex items-center gap-[var(--space-2)] text-[var(--text-muted)]">
                      <Clock size={14} />
                      <span className={META_TEXT_CLASS}>
                        {tutorial.time}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-[var(--space-2)] ${META_TEXT_CLASS} text-[var(--brand-primary)]`}>
                      Open lesson
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </Link>
              </motion.article>
            ))}
          </div>

          <section className="mt-[var(--space-8)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-6)] lg:p-[var(--space-7)]">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.7fr)_minmax(16rem,0.3fr)] lg:items-end">
              <div className="space-y-[var(--space-4)]">
                <PanelEyebrow>Product-truth curriculum</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[12ch]">
                  Learn the live system, not folklore.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[44rem]">
                  Lessons are written against current Port Daddy primitives and call out
                  roadmap-only behavior directly. The goal is operational fluency:
                  commands you can run, signals you can inspect, and recovery paths you
                  can trust during real agent work.
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-3)]">
                {['Current command names', 'Visible runtime evidence', 'Explicit roadmap boundaries'].map((item) => (
                  <div
                    key={item}
                    className={`border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] ${META_TEXT_CLASS} text-[var(--text-primary)]`}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </PageContainer>
      </main>

      <Footer />
    </motion.div>
  )
}
