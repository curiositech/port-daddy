import { Badge } from '@/components/ui/Badge'
import { DocsCodeBlock as CodeBlock } from '@/components/docs/DocsCodeBlock'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function SessionsSdk() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">SDK</Link>
        <span>/</span>
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">Modules</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">Sessions</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="success">Core</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Sessions Module
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          Start agent sessions, track work context, and manage session lifecycle.
          Sessions help coordinate work between multiple AI agents.
        </p>
      </div>

      {/* beginSession */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">beginSession()</h2>
          <p className="text-[var(--text-secondary)]">
            Start a new session and register as an agent. Returns session metadata including agent and session IDs.
          </p>
        </div>

        <CodeBlock language="typescript" code={`beginSession(options?: BeginSessionOptions): Promise<Session>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.identity</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Semantic identity in format <code>project:stack:context</code></p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.purpose</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Description of what this agent is working on</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.project</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Project name (inferred from identity if not provided)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Basic usage — start a session</p>
            <CodeBlock
              language="typescript"
              code={`const session = await pd.sessions.begin({
  identity: 'myapp:api',
  purpose: 'Fix authentication bug'
})`}
              output={`{
  "id": "abc123-def456",
  "agentId": "agent-001",
  "identity": "myapp:api",
  "purpose": "Fix authentication bug",
  "startedAt": "2026-03-16T12:00:00Z",
  "status": "active"
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Minimal session with auto-generated identity</p>
            <CodeBlock
              language="typescript"
              code={`const session = await pd.sessions.begin()`}
              output={`{
  "id": "xyz789-ghi012",
  "agentId": "agent-002",
  "identity": "anonymous",
  "purpose": null,
  "startedAt": "2026-03-16T12:00:00Z",
  "status": "active"
}`}
            />
          </div>
        </div>
      </div>

      {/* doneSession */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">doneSession()</h2>
          <p className="text-[var(--text-secondary)]">
            Mark a session as complete. Updates status and writes final notes.
          </p>
        </div>

        <CodeBlock language="typescript" code={`doneSession(sessionId: string, options?: DoneSessionOptions): Promise<Session>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">sessionId</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">The session ID to complete</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.summary</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Summary of work completed</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.outcome</code>
                <span className="text-xs text-[var(--text-muted)]">'success' | 'failure' | 'cancelled'</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Session outcome status</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Complete a session
await pd.sessions.done(session.id, {
  summary: 'Fixed auth bug and added tests',
  outcome: 'success'
})

// Also available as a shortcut
await pd.sessions.done(session.id)`}
          />
        </div>
      </div>

      {/* note */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">note()</h2>
          <p className="text-[var(--text-secondary)]">
            Add a note to a session. Notes are timestamped and can be typed for categorization.
          </p>
        </div>

        <CodeBlock language="typescript" code={`note(content: string, options?: { sessionId?: string; agentId?: string; type?: NoteType }): Promise<SessionNote>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">content</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Note content</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.sessionId</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Optional target session ID. Omit it to use the current session.</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.type</code>
                <span className="text-xs text-[var(--text-muted)]">NoteType</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Note type: 'thought', 'decision', 'progress', 'blocker', 'handoff'
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Add a progress note
await pd.note('API endpoints implemented', {
  sessionId: session.id,
  type: 'progress'
})

// Log a decision
await pd.note('Decided to use JWT over session cookies', {
  sessionId: session.id,
  type: 'decision'
})

// Flag a blocker
await pd.note('Waiting for database migration', {
  sessionId: session.id,
  type: 'blocker'
})`}
          />
        </div>
      </div>

      {/* getNotes */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">getNotes()</h2>
          <p className="text-[var(--text-secondary)]">
            Retrieve notes for a session with optional filtering.
          </p>
        </div>

        <CodeBlock language="typescript" code={`getNotes(options?: GetNotesOptions): Promise<SessionNote[]>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.sessionId</code>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Filter by session ID</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.type</code>
                <span className="text-xs text-[var(--text-muted)]">NoteType</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Filter by note type</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.limit</code>
                <span className="text-xs text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Maximum number of notes to return</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Get all notes for a session
const notes = await pd.sessions.getNotes({ sessionId: session.id })

// Get only blocker notes
const blockers = await pd.sessions.getNotes({
  sessionId: session.id,
  type: 'blocker'
})

// Get recent notes across all sessions
const recent = await pd.sessions.getNotes({ limit: 10 })`}
            output={`[
  {
    "id": "note-001",
    "sessionId": "abc123-def456",
    "content": "Database migration complete",
    "type": "progress",
    "createdAt": "2026-03-16T12:30:00Z"
  },
  {
    "id": "note-002",
    "sessionId": "abc123-def456",
    "content": "Decided to use JWT over session cookies",
    "type": "decision",
    "createdAt": "2026-03-16T12:15:00Z"
  }
]`}
          />
        </div>
      </div>

      {/* Types */}
      <div className="space-y-4 pt-8 border-t border-[var(--border-subtle)]">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Type Definitions</h2>
        <CodeBlock language="typescript" code={`interface Session {
  id: string
  agentId: string
  identity: string
  purpose: string | null
  startedAt: string
  endedAt?: string
  status: 'active' | 'completed' | 'cancelled'
  summary?: string
  outcome?: 'success' | 'failure' | 'cancelled'
}

type NoteType = 'thought' | 'decision' | 'progress' | 'blocker' | 'handoff' | 'info'

interface SessionNote {
  id: string
  sessionId: string
  content: string
  type: NoteType
  createdAt: string
}

interface BeginSessionOptions {
  identity?: string
  purpose?: string
  project?: string
}

interface DoneSessionOptions {
  summary?: string
  outcome?: 'success' | 'failure' | 'cancelled'
}

interface GetNotesOptions {
  sessionId?: string
  type?: NoteType
  limit?: number
  since?: string
}`} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-8 border-t border-[var(--border-subtle)]">
        <Link
          to="/docs/sdk/ports"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Ports Module
        </Link>
        <Link
          to="/docs/sdk/locks"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
        >
          Locks Module
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
