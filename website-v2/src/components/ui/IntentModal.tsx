import { useEffect, useRef, useCallback } from 'react'
import { BookOpen, Play, Search, X, Sparkles, Terminal, Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Surface } from './Surface'

interface IntentModalProps {
  isOpen: boolean
  onClose: () => void
}

const INTENTS = [
  {
    id: 'agent-builder',
    icon: Sparkles,
    title: "I'm building AI agents",
    description: 'Learn to spawn, coordinate, and recover agent swarms',
    action: 'Agent Tutorial',
    href: '/tutorials/pd-spawn',
    primary: true,
  },
  {
    id: 'multi-service',
    icon: Terminal,
    title: 'I run multiple services',
    description: 'Port coordination without the port 3000 headaches',
    action: 'Quick Start',
    href: '/tutorials/getting-started',
    primary: false,
  },
  {
    id: 'exploring',
    icon: Play,
    title: 'Just exploring',
    description: 'See what agent-native infrastructure looks like',
    action: 'View Examples',
    href: '/examples',
    primary: false,
  },
]

export function IntentModal({ isOpen, onClose }: IntentModalProps) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    if (isOpen && firstLinkRef.current) {
      firstLinkRef.current.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intent-modal-heading"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-bg-scrim"
        onClick={onClose}
      />

      {/* Modal */}
      <Surface depth="floating" radius="2xl" padding="lg" className="relative w-full max-w-lg border border-[var(--border-subtle)]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-[var(--radius-lg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)] transition-all cursor-pointer"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <h2 id="intent-modal-heading" className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
            Join the Agent Economy
          </h2>
          <p className="text-[var(--text-secondary)]">
            How do you want to start building?
          </p>
        </div>

        {/* Intent options */}
        <div className="space-y-3">
          {INTENTS.map((intent, index) => {
            const Icon = intent.icon
            return (
              <Link
                key={intent.id}
                ref={index === 0 ? firstLinkRef : undefined}
                to={intent.href}
                onClick={onClose}
                className={`flex items-start gap-4 p-4 rounded-[var(--radius-lg)] border transition-all group ${
                  intent.primary
                    ? 'border-[var(--brand-primary)]/30 hover:border-[var(--brand-primary)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                }`}
                style={{
                  background: intent.primary
                    ? 'var(--interactive-active)'
                    : 'var(--surface-base)',
                }}
              >
                <Surface
                  depth="inset"
                  radius="lg"
                  padding="none"
                  className="w-10 h-10 flex items-center justify-center shrink-0"
                >
                  <Icon
                    size={20}
                    className={intent.primary ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)]'}
                  />
                </Surface>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[var(--text-primary)] mb-0.5">
                    {intent.title}
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mb-2">
                    {intent.description}
                  </p>
                  <span className={`text-sm font-medium ${
                    intent.primary ? 'text-[var(--brand-primary)]' : 'text-[var(--text-secondary)]'
                  }`}>
                    {intent.action} →
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Quick links */}
        <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
          <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] uppercase tracking-wide mb-3 text-center">
            Quick Links
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Github size={14} />
              GitHub
            </a>
            <Link
              to="/docs"
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <BookOpen size={14} />
              Docs
            </Link>
            <Link
              to="/docs/concepts"
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Search size={14} />
              Concepts
            </Link>
          </div>
        </div>
      </Surface>
    </div>
  )
}
