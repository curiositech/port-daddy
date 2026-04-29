import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Github, Sparkles, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const INSTALL_OPTIONS = [
  {
    label: 'npm',
    command: 'npm install -g port-daddy',
    tone: 'paper' as const,
  },
  {
    label: 'brew',
    command: 'brew install curiositech/tap/port-daddy',
    tone: 'lime' as const,
  },
]

export function CTABanner() {
  return (
    <section className="border-y-2 border-[var(--border-strong)] bg-[var(--surface-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: 'easeOut' as const }}
        >
          <SurfacePanel className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
            <div className="space-y-[var(--panel-gap-loose)]">
              <div className="space-y-[var(--panel-gap)]">
                <BracketLabel>Departure</BracketLabel>
                <div className="space-y-[var(--space-3)]">
                  <PanelTitle as="h2" size="display" className="max-w-[11ch]">
                    Give your agents a real harbormaster.
                  </PanelTitle>
                  <PanelBody className="max-w-[36rem]">
                    Port Daddy stays local-first, open source, and brutally legible. Install it,
                    bring up the daemon, and give your agents shared operational truth.
                  </PanelBody>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a
                    href="https://github.com/curiositech/port-daddy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github size={16} />
                    Star on GitHub
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link to="/tutorials/getting-started">
                    <Sparkles size={16} />
                    Read the docs
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-[var(--space-4)]">
              {INSTALL_OPTIONS.map((option) => (
                <div
                  key={option.label}
                  className="space-y-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]"
                >
                  <PanelEyebrow>{option.label}</PanelEyebrow>
                  <div
                    className="flex items-center gap-[var(--space-2)] border-2 border-[var(--code-border)] bg-[var(--code-bg)] px-[var(--space-3)] py-[var(--space-3)] font-mono text-xs text-[var(--code-text)]"
                  >
                    <Terminal
                      size={16}
                      className={option.tone === 'lime' ? 'text-[#dfff00]' : 'text-[var(--code-prompt)]'}
                    />
                    <span>{option.command}</span>
                  </div>
                </div>
              ))}

              <div className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)] sm:grid-cols-2">
                <div className="space-y-[var(--space-1)]">
                  <PanelEyebrow>License</PanelEyebrow>
                  <PanelTitle as="p" size="nav" className="max-w-none">
                    MIT / Open source
                  </PanelTitle>
                </div>
                <div className="space-y-[var(--space-1)]">
                  <PanelEyebrow>Deployment model</PanelEyebrow>
                  <PanelTitle as="p" size="nav" className="max-w-none">
                    Single daemon / local-first
                  </PanelTitle>
                </div>
              </div>
            </div>
          </SurfacePanel>
        </motion.div>
      </PageContainer>
    </section>
  )
}
