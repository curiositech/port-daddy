import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check } from 'lucide-react'
import { useState } from 'react'

function CodeBlock({ code, output }: { code: string; output?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="relative p-4 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm group">
        <button
          onClick={handleCopy}
          className="absolute right-3 top-3 p-1.5 rounded hover:bg-[var(--interactive-hover)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {copied ? <Check size={14} className="text-[var(--success)]" /> : <Copy size={14} />}
        </button>
        <code className="text-[var(--brand-primary)]">{code}</code>
      </div>
      {output && (
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-sm">
          <div className="text-[var(--text-muted)] mb-1 text-xs uppercase tracking-wide">Output</div>
          <pre className="text-[var(--text-secondary)] whitespace-pre-wrap">{output}</pre>
        </div>
      )}
    </div>
  )
}

export default function HarborsSdk() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">SDK</Link>
        <span>/</span>
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">Modules</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">Harbors</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="amber">New in v3.7</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Harbors Module
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          Cryptographic capability namespaces for secure agent operations.
          Harbors provide a way to restrict agent capabilities and create secure enclaves.
        </p>
      </div>

      {/* What are Harbors? */}
      <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">What are Harbors?</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          A Harbor is a capability-based security boundary. Agents must present a valid 
          Harbor Card to enter and perform operations within the harbor. Think of it as 
          a secure workspace with fine-grained permissions.
        </p>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <strong className="text-[var(--text-primary)]">Create</strong>
            <p className="text-[var(--text-tertiary)] mt-1">Define a new harbor with specific capabilities</p>
          </div>
          <div>
            <strong className="text-[var(--text-primary)]">Enter</strong>
            <p className="text-[var(--text-tertiary)] mt-1">Agents present cards to enter harbors</p>
          </div>
          <div>
            <strong className="text-[var(--text-primary)]">Control</strong>
            <p className="text-[var(--text-tertiary)] mt-1">Restricted operations within boundaries</p>
          </div>
        </div>
      </div>

      {/* createHarbor */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">createHarbor()</h2>
          <p className="text-[var(--text-secondary)]">
            Create a new harbor with specified capabilities and access controls.
          </p>
        </div>

        <CodeBlock code={`createHarbor(name: string, options?: HarborOptions): Promise<Harbor>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">name</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Unique name for this harbor</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.capabilities</code>
                <span className="text-xs text-[var(--text-muted)]">string[]</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Allowed capabilities in this harbor (e.g., ['read', 'write', 'execute'])</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.allowedIdentities</code>
                <span className="text-xs text-[var(--text-muted)]">string[]</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Identity patterns allowed to enter (e.g., ['myapp:*'])</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.ttl</code>
                <span className="text-xs text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Harbor lifetime in seconds (default: 1 hour)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          
          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Basic harbor with read/write capabilities</p>
            <CodeBlock 
              code={`const harbor = await pd.harbors.createHarbor('production-db', {
  capabilities: ['read', 'write'],
  allowedIdentities: ['myapp:api:*', 'myapp:admin:*'],
  ttl: 3600 // 1 hour
})`}
              output={`{
  "name": "production-db",
  "capabilities": ["read", "write"],
  "allowedIdentities": ["myapp:api:*", "myapp:admin:*"],
  "createdAt": "2026-03-16T12:00:00Z",
  "expiresAt": "2026-03-16T13:00:00Z",
  "token": "harbor-token-abc123"
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Read-only harbor for reporting agents</p>
            <CodeBlock 
              code={`const harbor = await pd.harbors.createHarbor('analytics-readonly', {
  capabilities: ['read'],
  allowedIdentities: ['myapp:analytics:*'],
  ttl: 7200 // 2 hours
})`}
            />
          </div>
        </div>
      </div>

      {/* enterHarbor */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">enterHarbor()</h2>
          <p className="text-[var(--text-secondary)]">
            Enter a harbor by presenting a valid harbor token. Returns the session context if successful.
          </p>
        </div>

        <CodeBlock code={`enterHarbor(name: string, token: string): Promise<HarborSession>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">name</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Harbor name to enter</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">token</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Harbor card token</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock 
            code={`// Enter a harbor
try {
  const session = await pd.harbors.enterHarbor('production-db', harborToken)
  console.log(\`Entered harbor with capabilities: \${session.capabilities.join(', ')}\`)
  
  // Perform restricted operations
  await performDatabaseWork()
  
} catch (error) {
  console.error('Failed to enter harbor:', error.message)
}`}
            output={`{
  "harborName": "production-db",
  "agentId": "agent-001",
  "capabilities": ["read", "write"],
  "enteredAt": "2026-03-16T12:00:00Z",
  "expiresAt": "2026-03-16T13:00:00Z"
}`}
          />
        </div>
      </div>

      {/* issueHarborCard */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">issueHarborCard()</h2>
          <p className="text-[var(--text-secondary)]">
            Issue a Harbor Card (token) to an agent, granting them specific capabilities within a harbor.
          </p>
        </div>

        <CodeBlock code={`issueHarborCard(agentId: string, capabilities: string[], options?: CardOptions): Promise<HarborCard>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">agentId</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Agent to issue card to</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">capabilities</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string[]</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Capabilities to grant (must be subset of harbor capabilities)</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.harborName</code>
                <Badge variant="neutral" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Harbor this card is valid for</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.ttl</code>
                <span className="text-xs text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Card lifetime in seconds</p>
            </div>
            <div className="p-4 bg-[var(--bg-surface)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.restrictions</code>
                <span className="text-xs text-[var(--text-muted)]">object</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Additional restrictions (paths, operations, etc.)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          
          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Issue a card with read-only access</p>
            <CodeBlock 
              code={`const card = await pd.harbors.issueHarborCard('agent-001', ['read'], {
  harborName: 'production-db',
  ttl: 1800 // 30 minutes
})`}
              output={`{
  "token": "card-token-xyz789",
  "agentId": "agent-001",
  "capabilities": ["read"],
  "harborName": "production-db",
  "issuedAt": "2026-03-16T12:00:00Z",
  "expiresAt": "2026-03-16T12:30:00Z"
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Issue restricted card with path limitations</p>
            <CodeBlock 
              code={`const card = await pd.harbors.issueHarborCard('agent-002', ['read', 'write'], {
  harborName: 'production-db',
  ttl: 3600,
  restrictions: {
    allowedPaths: ['/data/public/*'],
    deniedPaths: ['/data/private/*'],
    maxOperations: 100
  }
})`}
            />
          </div>
        </div>
      </div>

      {/* Security Model */}
      <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Security Model</h2>
        <div className="space-y-4 text-[var(--text-secondary)]">
          <p>
            Harbors implement a capability-based security model inspired by capability systems 
            like Capsicum and Cloudflare Workers' sandboxing:
          </p>
          <ul className="space-y-2 ml-4">
            <li><strong className="text-[var(--text-primary)]">Principle of Least Privilege</strong> — Agents only get the capabilities they need</li>
            <li><strong className="text-[var(--text-primary)]">Time-Bound</strong> — All harbors and cards expire automatically</li>
            <li><strong className="text-[var(--text-primary)]">Identity-Based</strong> — Only agents matching allowed patterns can enter</li>
            <li><strong className="text-[var(--text-primary)]">Auditable</strong> — All harbor entries and operations are logged</li>
          </ul>
        </div>
      </div>

      {/* Types */}
      <div className="space-y-4 pt-8 border-t border-[var(--border-subtle)]">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Type Definitions</h2>
        <CodeBlock code={`interface Harbor {
  name: string
  capabilities: string[]
  allowedIdentities: string[]
  createdAt: string
  expiresAt: string
  token: string
}

interface HarborOptions {
  capabilities?: string[]
  allowedIdentities?: string[]
  ttl?: number
}

interface HarborSession {
  harborName: string
  agentId: string
  capabilities: string[]
  enteredAt: string
  expiresAt: string
}

interface HarborCard {
  token: string
  agentId: string
  capabilities: string[]
  harborName: string
  issuedAt: string
  expiresAt: string
}

interface CardOptions {
  harborName: string
  ttl?: number
  restrictions?: {
    allowedPaths?: string[]
    deniedPaths?: string[]
    maxOperations?: number
  }
}`} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-8 border-t border-[var(--border-subtle)]">
        <Link 
          to="/docs/sdk/locks"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Locks Module
        </Link>
        <Link 
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)] transition-colors"
        >
          SDK Overview
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
