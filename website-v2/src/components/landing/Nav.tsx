import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import { Sun, Moon, Github, Menu, X, Anchor, Share2, Terminal, Sparkles, Layout } from 'lucide-react'

const NAV_LINKS = [
  { label: 'Academy', href: '/tutorials', icon: Sparkles },
  { label: 'Blueprints', href: '/examples', icon: Share2 },
  { label: 'MCP', href: '/mcp', icon: Terminal },
  { label: 'SDK', href: '/docs', icon: Anchor },
  { label: 'Journal', href: '/blog', icon: Layout },
]

export function Nav() {
  const [scrolled, setScrolled] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { theme, toggle } = useTheme()
  const location = useLocation()

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.nav
      className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-500 font-sans selection:bg-[var(--brand-primary)] selection:text-white ${scrolled ? 'py-4' : 'py-8'}`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
    >
      <motion.div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-10">
        <motion.div 
          className={`rounded-[32px] border transition-all duration-500 px-8 py-4 flex items-center justify-between shadow-2xl relative overflow-hidden ${scrolled ? 'bg-[var(--bg-surface)]/80 backdrop-blur-xl border-[var(--border-subtle)]' : 'bg-transparent border-transparent shadow-none'}`}
        >
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 no-underline group relative z-10">
            <motion.div 
              className="w-10 h-10 rounded-xl bg-[var(--interactive-active)] border border-[var(--border-subtle)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform group-hover:border-[var(--brand-primary)]"
            >
               <motion.img
                src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                alt="Port Daddy"
                className="h-6 w-auto"
              />
            </motion.div>
            <motion.span className="font-black text-xl tracking-tighter text-[var(--text-primary)]">port-daddy.</motion.span>
          </Link>

          {/* Desktop Links */}
          <motion.div className="hidden md:flex items-center gap-2">
            {NAV_LINKS.map((link) => (
              <Link 
                key={link.label} 
                to={link.href} 
                className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest no-underline transition-all flex items-center gap-2 group ${location.pathname === link.href ? 'bg-[var(--brand-primary)] text-[var(--bg-base)] shadow-lg shadow-[var(--brand-primary)]/20' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)]'}`}
              >
                <link.icon size={14} className={location.pathname === link.href ? '' : 'opacity-40 group-hover:opacity-100 transition-opacity'} />
                {link.label}
              </Link>
            ))}
          </motion.div>

          {/* Actions */}
          <motion.div className="flex items-center gap-4 relative z-10">
            <motion.button
              onClick={toggle}
              className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--brand-primary)] transition-all"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </motion.button>

            <motion.button
              onClick={() => window.open('https://github.com/erichowens/port-daddy', '_blank')}
              className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--brand-primary)] transition-all hidden sm:flex"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Github size={18} />
            </motion.button>

            <motion.button
              className="md:hidden p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)]"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] overflow-hidden font-sans"
          >
            <motion.div className="px-6 py-10 space-y-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-[var(--bg-overlay)] no-underline text-lg font-bold text-[var(--text-primary)]"
                  onClick={() => setMobileOpen(false)}
                >
                  <link.icon size={20} className="text-[var(--brand-primary)]" />
                  {link.label}
                </Link>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
