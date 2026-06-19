import { Badge } from '@/components/ui/Badge'
import { DocsCodeBlock as CodeBlock } from '@/components/docs/DocsCodeBlock'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function LocksSdk() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">SDK</Link>
        <span>/</span>
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">Modules</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">Locks</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="gold">Current</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Locks Module
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          Distributed locks for preventing conflicts in multi-agent environments.
          Use locks when multiple agents might modify the same files or resources.
        </p>
      </div>

      {/* acquireLock */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">acquireLock()</h2>
          <p className="text-[var(--text-secondary)]">
            Acquire a distributed lock by name. Returns the lock if successful, null if already held.
          </p>
        </div>

        <CodeBlock language="typescript" code={`acquireLock(name: string, options?: LockOptions): Promise<Lock | null>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">name</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Unique name for this lock</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.ttl</code>
                <span className="text-xs text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Time-to-live in seconds (default: 60)</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.wait</code>
                <span className="text-xs text-[var(--text-muted)]">boolean</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Wait for lock instead of failing immediately</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.timeout</code>
                <span className="text-xs text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Max wait time in milliseconds (when wait=true)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Basic usage — acquire a lock</p>
            <CodeBlock
              language="typescript"
              code={`const lock = await pd.locks.acquireLock('database-migration', {
  ttl: 300 // 5 minutes
})

if (lock) {
  console.log('Lock acquired, proceeding with migration')
  // Do work...
  await pd.locks.releaseLock('database-migration')
} else {
  console.log('Lock already held by another agent')
}`}
              output={`{
  "name": "database-migration",
  "holder": "agent-001",
  "acquiredAt": "2026-03-16T12:00:00Z",
  "expiresAt": "2026-03-16T12:05:00Z",
  "ttl": 300
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Wait for lock with timeout</p>
            <CodeBlock
              language="typescript"
              code={`const lock = await pd.locks.acquireLock('config-file', {
  wait: true,
  timeout: 10000 // Wait up to 10 seconds
})

if (lock) {
  // Modify shared config
  await pd.locks.releaseLock('config-file')
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Immediate fail if locked</p>
            <CodeBlock
              language="typescript"
              code={`// Without wait option, returns null immediately if locked
const lock = await pd.locks.acquireLock('build-artifacts')
if (!lock) {
  console.log('Build in progress, skipping')
  return
}`}
            />
          </div>
        </div>
      </div>

      {/* releaseLock */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">releaseLock()</h2>
          <p className="text-[var(--text-secondary)]">
            Release a previously acquired lock. Safe to call even if lock doesn't exist.
          </p>
        </div>

        <CodeBlock language="typescript" code={`releaseLock(name: string): Promise<boolean>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">name</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">The lock name to release</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Release lock when done
await pd.locks.releaseLock('database-migration')

// Returns true if released, false if not found
const released = await pd.locks.releaseLock('database-migration')
console.log(released) // true`}
          />
        </div>
      </div>

      {/* withLock */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">withLock()</h2>
          <p className="text-[var(--text-secondary)]">
            Execute a function with automatic lock acquisition and release.
            The lock is released even if the function throws an error.
          </p>
        </div>

        <CodeBlock language="typescript" code={`withLock<T>(name: string, fn: () => Promise<T>, options?: LockOptions): Promise<T | null>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">name</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Lock name</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">fn</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-xs text-[var(--text-muted)]">() =&gt; Promise&lt;T&gt;</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Function to execute while holding the lock</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options</code>
                <span className="text-xs text-[var(--text-muted)]">LockOptions</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Same options as acquireLock</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Automatic lock management</p>
            <CodeBlock
              language="typescript"
              code={`import { writeFile } from 'fs/promises'

// Lock is acquired before the function runs
// and released after it completes (even on error)
const result = await pd.locks.withLock('package-json', async () => {
  // Read current package.json
  const pkg = await readFile('package.json', 'utf8')
  const data = JSON.parse(pkg)

  // Modify dependencies
  data.dependencies['new-lib'] = '^1.0.0'

  // Write back
  await writeFile('package.json', JSON.stringify(data, null, 2))

  return data
}, { ttl: 30 })

if (result) {
  console.log('Package.json updated successfully')
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Handling lock failures</p>
            <CodeBlock
              language="typescript"
              code={`const result = await pd.locks.withLock('critical-section', async () => {
  return await performCriticalOperation()
})

if (result === null) {
  console.log('Could not acquire lock, operation skipped')
} else {
  console.log('Operation completed:', result)
}`}
            />
          </div>
        </div>
      </div>

      {/* Use Cases */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Common Use Cases</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">File Modifications</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Prevent multiple agents from editing the same file simultaneously.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Database Migrations</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Ensure only one agent runs migrations at a time.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Build Processes</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Coordinate builds to avoid conflicts in output directories.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Resource Allocation</h3>
            <p className="text-sm text-[var(--text-muted)]">
              Coordinate access to limited external resources.
            </p>
          </div>
        </div>
      </div>

      {/* Types */}
      <div className="space-y-4 pt-8 border-t border-[var(--border-subtle)]">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Type Definitions</h2>
        <CodeBlock language="typescript" code={`interface Lock {
  name: string
  holder: string
  acquiredAt: string
  expiresAt: string
  ttl: number
}

interface LockOptions {
  ttl?: number
  wait?: boolean
  timeout?: number
}`} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-8 border-t border-[var(--border-subtle)]">
        <Link
          to="/docs/sdk/sessions"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Sessions Module
        </Link>
        <Link
          to="/docs/sdk/harbors"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
        >
          Harbors Module
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
