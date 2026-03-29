import { Badge } from '@/components/ui/Badge'
import { CodeBlock as SharedCodeBlock } from '@/components/ui/CodeBlock'
import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { useState } from 'react'

const STEPS = [
  {
    number: '01',
    title: 'Install Port Daddy',
    description: 'Install globally via npm.',
    code: 'npm install -g port-daddy',
    verify: 'pd --version'
  },
  {
    number: '02',
    title: 'Start the Daemon',
    description: 'The daemon runs in the background and manages all coordination.',
    code: 'pd start',
    verify: 'pd status'
  },
  {
    number: '03',
    title: 'Claim Your First Port',
    description: 'Use semantic identities to claim stable ports for your services.',
    code: 'pd claim myapp:api:main',
    verify: 'pd services'
  },
  {
    number: '04',
    title: 'Begin an Agent Session',
    description: 'Register as an agent and start tracking your work.',
    code: 'pd begin --identity myapp:coder --purpose "Initial setup"',
    verify: 'pd whoami'
  }
]

function StepCodeBlock({ code, verify }: { code: string; verify: string }) {
  return (
    <div className="space-y-2">
      <SharedCodeBlock language="bash">{code}</SharedCodeBlock>
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>Verify:</span>
        <code>{verify}</code>
      </div>
    </div>
  )
}

export default function QuickStart() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="teal">Quick Start</Badge>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Get Started with Port Daddy
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-2xl">
          Get up and running in minutes. Follow these steps to start coordinating 
          your first agent swarm.
        </p>
      </div>

      {/* Prerequisites */}
      <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="font-semibold text-[var(--text-primary)] mb-3">Prerequisites</h2>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-center gap-2">
            <Check size={16} className="text-[var(--success)]" />
            macOS, Linux, or WSL2 on Windows
          </li>
          <li className="flex items-center gap-2">
            <Check size={16} className="text-[var(--success)]" />
            npm or yarn
          </li>
          <li className="flex items-center gap-2">
            <Check size={16} className="text-[var(--success)]" />
            Node.js 18+ (for SDK features)
          </li>
        </ul>
      </div>

      {/* Steps */}
      <div className="space-y-8">
        {STEPS.map((step, i) => (
          <div key={step.number} className="relative">
            {i < STEPS.length - 1 && (
              <div className="absolute left-6 top-16 bottom-0 w-px bg-[var(--border-subtle)]" />
            )}
            <div className="flex gap-6">
              <div className="w-12 h-12 rounded-full bg-[var(--brand-primary)]/10 flex items-center justify-center shrink-0">
                <span className="font-semibold text-[var(--brand-primary)]">{step.number}</span>
              </div>
              <div className="flex-1 space-y-3">
                <h3 className="text-xl font-semibold text-[var(--text-primary)]">{step.title}</h3>
                <p className="text-[var(--text-secondary)]">{step.description}</p>
                <StepCodeBlock code={step.code} verify={step.verify} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Next Steps */}
      <div className="p-6 rounded-xl bg-gradient-to-br from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <h2 className="font-semibold text-[var(--text-primary)] mb-3">Next Steps</h2>
        <p className="text-[var(--text-secondary)] mb-4">
          Now that you have Port Daddy running, explore these guides to build your first swarm:
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Link 
            to="/docs/features/radio"
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <span className="text-[var(--text-primary)]">Swarm Radio</span>
            <ArrowRight size={14} className="text-[var(--text-muted)]" />
          </Link>
          <Link 
            to="/docs/features/harbors"
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <span className="text-[var(--text-primary)]">Cryptographic Harbors</span>
            <ArrowRight size={14} className="text-[var(--text-muted)]" />
          </Link>
          <Link 
            to="/docs/mcp"
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <span className="text-[var(--text-primary)]">MCP Integration</span>
            <ArrowRight size={14} className="text-[var(--text-muted)]" />
          </Link>
          <Link 
            to="/tutorials/getting-started"
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <span className="text-[var(--text-primary)]">Full Tutorial</span>
            <ArrowRight size={14} className="text-[var(--text-muted)]" />
          </Link>
        </div>
      </div>

      {/* Help */}
      <div className="text-center py-8">
        <p className="text-[var(--text-muted)] mb-3">Need help?</p>
        <div className="flex items-center justify-center gap-4">
          <a 
            href="https://github.com/erichowens/port-daddy/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--brand-primary)] hover:underline"
          >
            Open an Issue
          </a>
          <span className="text-[var(--border-subtle)]">|</span>
          <Link to="/docs/cli" className="text-[var(--brand-primary)] hover:underline">
            CLI Reference
          </Link>
        </div>
      </div>
    </div>
  )
}
