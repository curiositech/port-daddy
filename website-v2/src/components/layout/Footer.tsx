import { Link } from 'react-router-dom'
import { Github, Twitter, ShieldCheck, Heart } from 'lucide-react'
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
    ]
  },
  {
    title: 'Infrastructure',
    links: [
      { label: 'The Daemon', href: '/docs/daemon' },
      { label: 'Semantic DNS', href: '/docs/dns' },
      { label: 'Lighthouses', href: '/docs/lighthouses' },
      { label: 'SDK Reference', href: '/docs/sdk' },
    ]
  },
  {
    title: 'Ecosystem',
    links: [
      { label: 'LangChain', href: '/integrations/langchain' },
      { label: 'CrewAI', href: '/integrations/crewai' },
      { label: 'Claude Code', href: '/integrations/claude' },
      { label: 'Gemini CLI', href: '/integrations/gemini' },
    ]
  }
]

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { theme } = useTheme()

  return (
    <footer className="py-16 bg-[var(--bg-base)] border-t border-[var(--border-subtle)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 lg:gap-12 mb-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link to="/" className="inline-flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center">
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
            
            <p className="text-sm text-[var(--text-tertiary)] max-w-xs mb-4">
              The definitive control plane for high-fidelity multi-agent orchestration.
            </p>
            
            <div className="flex items-center gap-3">
              <a 
                href="https://github.com/erichowens/port-daddy" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
              >
                <Github size={16} />
              </a>
              <a 
                href="#" 
                className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
              >
                <Twitter size={16} />
              </a>
              <Badge variant="teal" size="sm">v3.7.0</Badge>
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
                      className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
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
        <div className="pt-8 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>© {currentYear} Port Daddy Project</span>
            <span className="hidden sm:inline">·</span>
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-[var(--success)]" />
              <span>Anchor Protocol Verified</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              Built by Erich Owens
              <Heart size={12} className="text-red-500 fill-red-500" />
            </span>
            <span className="hidden sm:inline">·</span>
            <Link to="#" className="hover:text-[var(--text-primary)] transition-colors">Terms</Link>
            <Link to="#" className="hover:text-[var(--text-primary)] transition-colors">Privacy</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
