import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Github, Twitter, Book, PlayCircle, ShieldCheck, Anchor, Heart, Cpu, Globe, Share2, Terminal } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { Badge } from '@/components/ui/Badge'

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { theme } = useTheme()

  const footerMotion = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] }
  }

  const sections = [
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
        { label: 'The Daemon', href: '/docs/daemon' },
        { label: 'Semantic DNS', href: '/docs/dns' },
        { label: 'Lighthouses', href: '/docs/lighthouses' },
        { label: 'Swarm Radio', href: '/docs/radio' },
        { label: 'SDK Reference', href: '/docs/sdk' }
      ]
    },
    {
      title: 'Ecosystem',
      links: [
        { label: 'LangChain', href: '/integrations/langchain' },
        { label: 'CrewAI', href: '/integrations/crewai' },
        { label: 'Claude Code', href: '/integrations/claude' },
        { label: 'Gemini CLI', href: '/integrations/gemini' },
        { label: 'Storybook', href: '/storybook' }
      ]
    }
  ]

  return (
    <motion.footer
      {...footerMotion}
      className="py-32 px-6 sm:px-8 lg:px-10 border-t relative overflow-hidden font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
    >
      {/* Decorative background art */}
      <motion.div 
        className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none" 
        style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
      />
      <motion.div 
        className="absolute top-[-10%] left-[-5%] w-[300px] h-[300px] rounded-full blur-[100px] opacity-[0.05] pointer-events-none" 
        style={{ background: 'radial-gradient(circle, var(--p-amber-500) 0%, transparent 70%)' }} 
      />

      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans">
        <motion.div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-16 mb-24">
          
          {/* Brand Identity */}
          <motion.div className="col-span-2 lg:col-span-3 space-y-10">
            <Link to="/" className="inline-flex items-center gap-4 no-underline group">
              <motion.div 
                className="w-14 h-14 rounded-2xl bg-[var(--interactive-active)] border border-[var(--border-subtle)] flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform"
              >
                <motion.img
                  src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                  alt="Port Daddy"
                  style={{ height: '32px', width: 'auto' }}
                />
              </motion.div>
              <motion.span 
                className="font-black text-3xl tracking-tighter font-display" 
                style={{ color: 'var(--text-primary)' }}
              >
                port-daddy.
              </motion.span>
            </Link>
            
            <motion.div className="space-y-6 max-w-sm">
               <motion.p className="text-xl leading-relaxed opacity-60 font-medium">
                 The definitive control plane for high-fidelity multi-agent orchestration.
               </motion.p>
               
               <div className="flex items-center gap-4">
                  <a href="https://github.com/erichowens/port-daddy" target="_blank" className="w-10 h-10 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-center hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-all">
                     <Github size={18} />
                  </a>
                  <a href="#" target="_blank" className="w-10 h-10 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-center hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-all">
                     <Twitter size={18} />
                  </a>
                  <Badge variant="teal" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest">v3.7.0 STABLE</Badge>
               </div>
            </motion.div>
          </motion.div>

          {/* Navigation Sections */}
          {sections.map((section) => (
            <div key={section.title} className="space-y-8">
              <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--brand-primary)]">
                {section.title}
              </h4>
              <ul className="space-y-4 list-none p-0 m-0">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link 
                      to={link.href} 
                      className="text-base font-medium opacity-50 hover:opacity-100 hover:text-[var(--text-primary)] transition-all no-underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </motion.div>

        {/* Bottom Bar */}
        <motion.div 
          className="pt-12 border-t border-[var(--border-subtle)] flex flex-col md:flex-row items-center justify-between gap-8 font-sans opacity-40 hover:opacity-100 transition-opacity duration-500"
        >
          <div className="flex flex-col md:flex-row items-center gap-8">
             <span className="text-sm font-bold tracking-tight">© {currentYear} Port Daddy Project</span>
             <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck size={14} className="text-[var(--p-teal-400)]" />
                <span>Anchor Protocol Verified</span>
             </div>
             <div className="flex items-center gap-2 text-sm font-medium">
                <Globe size={14} className="text-[var(--p-blue-400)]" />
                <span>Distributed by Homebrew</span>
             </div>
          </div>

          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-sm font-bold">
                <span>Built by Erich Owens</span>
                <Heart size={14} className="text-[var(--p-red-500)] fill-[var(--p-red-500)] animate-pulse" />
             </div>
             <div className="h-4 w-[1px] bg-[var(--border-strong)]" />
             <a href="#" className="text-sm font-bold hover:text-[var(--brand-primary)] transition-colors no-underline">Terms</a>
             <a href="#" className="text-sm font-bold hover:text-[var(--brand-primary)] transition-colors no-underline">Privacy</a>
          </div>
        </motion.div>
      </motion.div>
    </motion.footer>
  )
}
