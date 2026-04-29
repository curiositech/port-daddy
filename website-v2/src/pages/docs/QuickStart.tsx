import { Badge } from '@/components/ui/Badge'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import {
  BracketLabel,
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { ArrowRight, Check } from 'lucide-react'

const STEPS = [
  {
    number: '01',
    title: 'Install Port Daddy',
    description: 'Install globally via npm.',
    code: '$ npm install -g port-daddy',
    verifyCommand: '$ pd --version',
    verifyOutput: 'port-daddy v3.11.0',
  },
  {
    number: '02',
    title: 'Start the Daemon',
    description: 'The daemon runs in the background and manages all coordination.',
    code: '$ pd start',
    verifyCommand: '$ pd status',
    verifyOutput: 'Port Daddy is running\nRuntime: nominal',
  },
  {
    number: '03',
    title: 'Claim Your First Port',
    description: 'Use semantic identities to claim stable ports for your services.',
    code: '$ pd claim myapp:api:main',
    verifyCommand: '$ pd services',
    verifyOutput: 'myapp:api:main  3001  healthy',
  },
  {
    number: '04',
    title: 'Begin an Agent Session',
    description: 'Register as an agent and start tracking your work.',
    code: '$ pd begin "Initial setup" --identity myapp:coder',
    verifyCommand: '$ pd whoami',
    verifyOutput: 'Agent:   agent-7f3a\nSession: session-b2e4\nIdentity: myapp:coder',
  }
]

export default function QuickStart() {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="space-y-[var(--space-4)]">
        <Badge variant="teal">Quick Start</Badge>
        <SectionIntro
          eyebrow="First run"
          title="Get Port Daddy running in four checked commands."
          description="Install the CLI, start the daemon, claim a deterministic service port, and register an agent session. Each command includes the output you should expect before moving on."
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-[16ch]"
          bodyClassName="max-w-[46rem]"
        />
      </div>

      <DocsNoteCard label="Prerequisites" title="Before you start" elevation="quiet" padding="compact" titleSize="nav">
        <div className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-strong)]/12 pt-[var(--panel-gap)] sm:grid-cols-2">
          {['macOS, Linux, or WSL2 on Windows', 'Node.js 20 or newer'].map((item) => (
            <div key={item} className="flex items-start gap-[var(--space-2)]">
              <Check className="mt-[2px] h-[var(--space-3)] w-[var(--space-3)] flex-none text-[var(--status-success)]" />
              <PanelBody size="compact" className="max-w-none">
                {item}
              </PanelBody>
            </div>
          ))}
        </div>
      </DocsNoteCard>

      <div className="grid gap-[var(--space-4)]">
        {STEPS.map((step) => (
          <SurfacePanel key={step.number} elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
            <div className="grid gap-[var(--space-3)] sm:grid-cols-[4.5rem_minmax(0,1fr)]">
              <BracketLabel className="self-start">{step.number}</BracketLabel>
              <div className="grid gap-[var(--space-1)]">
                <PanelTitle as="h2" size="nav" className="max-w-none">
                  {step.title}
                </PanelTitle>
                <PanelBody size="compact" className="max-w-[40rem]">
                  {step.description}
                </PanelBody>
              </div>
            </div>

            <div className="grid gap-[var(--space-3)] lg:grid-cols-2">
              <DocsCodeBlock code={step.code} label="Command" />
              <DocsCodeBlock code={step.verifyCommand} output={step.verifyOutput} label="Verify" />
            </div>
          </SurfacePanel>
        ))}
      </div>

      <DocsNoteCard label="Next steps" title="Move from first run to coordination" tone="blue">
        <PanelBody tone="primary" className="max-w-[42rem]">
          Once the daemon is running, move into the coordination surfaces agents use all day.
        </PanelBody>
        <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
          {[
            { label: 'Swarm Radio', to: '/docs/features/radio' },
            { label: 'Harbors', to: '/docs/features/harbors' },
            { label: 'MCP Integration', to: '/docs/mcp' },
            { label: 'Full Tutorial', to: '/tutorials/getting-started' },
          ].map(link => (
            <BracketLink
              key={link.to}
              to={link.to}
              tone="blue"
              className="justify-between"
            >
              {link.label}
              <ArrowRight size={14} />
            </BracketLink>
          ))}
        </div>
      </DocsNoteCard>
    </div>
  )
}
