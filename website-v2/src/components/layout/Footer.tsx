import { Link } from 'react-router-dom'
import { Github, MessageSquare, ShieldCheck, Heart } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Badge } from '@/components/ui/Badge'

const FOOTER_LINKS = [
  {
    title: 'Academy',
    links: [
      { label: 'Getting Started', href: '/tutorials/getting-started' },
      { label: 'Multi-Agent Flow', href: '/tutorials/multi-agent' },
      { label: 'Harbors & Security', href: '/tutorials/harbors' },
      { label: 'P2P Tunnels', href: '/tutorials/tunnel' },
      { label: 'Time-Travel Debugging', href: '/tutorials/time-travel' }
    ]
  },
  {
    title: 'Infrastructure',
    links: [
      { label: 'The Daemon', href: '/tutorials/always-on' },
      { label: 'Semantic DNS', href: '/tutorials/dns' },
      { label: 'Session Phases', href: '/tutorials/session-phases' },
      { label: 'P2P Tunnels', href: '/tutorials/tunnel' },
      { label: 'SDK Reference', href: '/docs' }
    ]
  },
  {
    title: 'Ecosystem',
    links: [
      { label: 'LangGraph', href: '/integrations/langgraph' },
      { label: 'CrewAI', href: '/integrations/crewai' },
      { label: 'Claude Code', href: '/integrations/claude-skill' },
      { label: 'Gemini CLI', href: '/integrations/gemini-cli' },
      { label: 'All Integrations', href: '/integrations' }
    ]
  }
]

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { theme } = useTheme()

  return (
    <footer
      className="py-16"
      style={{
        background: 'var(--surface-sunken)',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 lg:gap-12 mb-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link to="/" className="inline-flex items-center gap-2 mb-4">
              <div
                className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--brand-primary)] flex items-center justify-center"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <img
                  src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                  alt="Port Daddy"
                  className="h-5 w-auto"
                />
              </div>
              <span className="font-semibold text-lg text-[var(--text-primary)]">
                Port Daddy
              </span>
            </Link>

            <p className="text-sm text-[var(--text-muted)] max-w-xs mb-4">
              The definitive control plane for high-fidelity multi-agent orchestration.
            </p>

            <div className="flex items-center gap-3">
              <a
                href="https://github.com/curiositech/port-daddy"
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                style={{ boxShadow: 'var(--shadow-inset)' }}
              >
                <Github size={16} />
              </a>
              <a
                href="https://github.com/curiositech/port-daddy/discussions"
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                style={{ boxShadow: 'var(--shadow-inset)' }}
              >
                <MessageSquare size={16} />
              </a>
              <Badge variant="teal">v3.8.3</Badge>
            </div>
          </div>

          {/* Links */}
          {FOOTER_LINKS.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide mb-4">
                {section.title}
              </h4>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.href}
                      className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>&copy; {currentYear} Port Daddy Project</span>
            <span className="hidden sm:inline">&middot;</span>
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-[var(--status-success)]" />
              <span>Open Source · MIT License</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ boxShadow: 'var(--shadow-pressed)' }}
            >
              Built by Erich Owens
              <Heart size={12} className="text-[var(--brand-primary)]" style={{ fill: 'var(--brand-primary)' }} />
            </span>
            <span className="hidden sm:inline">&middot;</span>
            <span>MIT License</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
