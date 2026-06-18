import { Github, MessagesSquare, Terminal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const GITHUB_URL = 'https://github.com/curiositech/port-daddy'
const DISCUSSIONS_URL = 'https://github.com/curiositech/port-daddy/discussions'

/**
 * Click-to-copy install block. Homebrew is the primary path (the daemon + CLI
 * ship as a tap); npm is the secondary path for Node-first setups. Both run the
 * same backend. Open source, free — no tiers, no urgency.
 */
export function InstallCTASection() {
  return (
    <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--space-8)] lg:py-[var(--section-space-y)]">
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.8fr)] lg:items-start">
          <div className="grid content-start gap-[var(--space-4)]">
            <PanelEyebrow>Install in one line</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="max-w-[18ch]">
              Copy a command, run your fleet.
            </PanelTitle>
            <PanelBody className="max-w-[46rem]">
              Port Daddy is open source and free. Install the daemon and CLI with
              Homebrew, point your agents at the project, and the coordination
              record is live. The Mac app reads the same backend if you prefer a
              window over a terminal.
            </PanelBody>

            <div className="mt-[var(--space-2)] grid gap-[var(--space-2)]">
              <PanelEyebrow>Homebrew</PanelEyebrow>
              <CodeBlock language="bash" showHeaderLabel={false}>
                {`brew install curiositech/tap/port-daddy`}
              </CodeBlock>
            </div>

            <div className="grid gap-[var(--space-2)]">
              <PanelEyebrow>npm</PanelEyebrow>
              <CodeBlock language="bash" showHeaderLabel={false}>
                {`npm install -g port-daddy`}
              </CodeBlock>
            </div>

            <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              Then run <code className="font-mono text-[var(--brand-primary)]">pd setup</code> to point it at a project.{' '}
              <Link
                to="/docs/quickstart"
                className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline"
              >
                Read the quickstart
              </Link>
              .
            </p>
          </div>

          <SurfacePanel elevation="quiet" padding="compact" className="grid content-start gap-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
              <Terminal size={17} className="text-[var(--brand-primary)]" />
              <PanelEyebrow>After it installs</PanelEyebrow>
            </div>
            <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
              {[
                ['pd status', 'see which agents are working where'],
                ['pd briefing', 'read what the others learned'],
                ['pd guard install', 'block commits that skip a claim'],
              ].map(([cmd, what]) => (
                <div
                  key={cmd}
                  className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-default)] pb-[var(--space-2)] last:border-b-0 last:pb-0"
                >
                  <code className="font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)]">
                    {cmd}
                  </code>
                  <span className="text-right text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    {what}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-[var(--space-3)]">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--brand-primary)]"
              >
                <Github size={15} />
                Source on GitHub
              </a>
              <a
                href={DISCUSSIONS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--brand-primary)]"
              >
                <MessagesSquare size={15} />
                Ask in Discussions
              </a>
            </div>
          </SurfacePanel>
        </div>
      </PageContainer>
    </section>
  )
}

export default InstallCTASection
