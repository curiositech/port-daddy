import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'

const STEPS = [
  {
    number: '01',
    title: 'Install Port Daddy',
    description: 'Install globally via npm.',
    code: '$ npm install -g port-daddy',
    verify: '$ pd --version\nport-daddy v3.8.0'
  },
  {
    number: '02',
    title: 'Start the Daemon',
    description: 'The daemon runs in the background and manages all coordination.',
    code: '$ pd start',
    verify: '$ pd status\nPort Daddy is running on localhost:9876'
  },
  {
    number: '03',
    title: 'Claim Your First Port',
    description: 'Use semantic identities to claim stable ports for your services.',
    code: '$ pd claim myapp:api:main',
    verify: '$ pd services\nmyapp:api:main → port 3001 (healthy)'
  },
  {
    number: '04',
    title: 'Begin an Agent Session',
    description: 'Register as an agent and start tracking your work.',
    code: '$ pd begin "Initial setup" --identity myapp:coder',
    verify: '$ pd whoami\nAgent: agent-7f3a\nSession: session-b2e4\nIdentity: myapp:coder'
  }
]

export default function QuickStart() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <Badge variant="teal">Quick Start</Badge>
        <h1 className="text-4xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Get Started with Port Daddy
        </h1>
        <p className="text-xl leading-relaxed max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
          Get up and running in four commands.
        </p>
      </div>

      {/* Prerequisites */}
      <Surface depth="raised" radius="xl" padding="lg">
        <h2 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Prerequisites</h2>
        <ul className="space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li className="flex items-center gap-2">
            <Check size={16} style={{ color: 'var(--status-success)' }} />
            macOS, Linux, or WSL2 on Windows
          </li>
          <li className="flex items-center gap-2">
            <Check size={16} style={{ color: 'var(--status-success)' }} />
            Node.js 18+
          </li>
        </ul>
      </Surface>

      {/* Steps */}
      <div className="space-y-6">
        {STEPS.map((step, i) => (
          <Surface key={step.number} depth="raised" radius="xl" padding="lg" className="space-y-4">
            <div className="flex items-center gap-4">
              <Surface depth="inset" radius="full" padding="none" className="w-10 h-10 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold" style={{ color: 'var(--brand-primary)' }}>{step.number}</span>
              </Surface>
              <div>
                <h3 className="text-lg font-semibold m-0" style={{ color: 'var(--text-primary)' }}>{step.title}</h3>
                <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>{step.description}</p>
              </div>
            </div>

            <CodeBlock language="bash">{step.code}</CodeBlock>

            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Verify</span>
              <CodeBlock language="bash" copyable={false}>{step.verify}</CodeBlock>
            </div>
          </Surface>
        ))}
      </div>

      {/* Next Steps */}
      <Surface depth="raised" radius="xl" padding="lg" className="space-y-4">
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Next Steps</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Now that you have Port Daddy running, explore these guides:
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { label: 'Swarm Radio', to: '/docs/features/radio' },
            { label: 'Harbors', to: '/docs/features/harbors' },
            { label: 'MCP Integration', to: '/docs/mcp' },
            { label: 'Full Tutorial', to: '/tutorials/getting-started' },
          ].map(link => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center justify-between p-3 rounded-lg transition-colors"
              style={{ background: 'var(--interactive-hover)' }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{link.label}</span>
              <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
            </Link>
          ))}
        </div>
      </Surface>
    </div>
  )
}
