import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import { Sun, Moon, Github, Menu, X, Anchor, Share2, Terminal, Sparkles, Layout, Compass, LayoutGrid } from 'lucide-react'

const NAV_LINKS = [
  { label: 'Academy', href: '/tutorials', icon: Sparkles },
  { label: 'Blueprints', href: '/examples', icon: Share2 },
  { label: 'Templates', href: '/templates', internal: true, icon: LayoutGrid },
  { label: 'MCP', href: '/mcp', icon: Terminal },
  { label: 'SDK', href: '/docs', icon: Anchor },
  { label: 'Blog', href: '/blog', icon: Layout },
  { label: 'Roadmap', href: '/roadmap', internal: true, icon: Compass },
]

export function Nav() {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { theme, toggle } = useTheme()
  const location = useLocation()

  return (
    <nav className="sticky top-0 left-0 right-0 z-[100] transition-all duration-500 font-sans bg-bg-base/80 backdrop-blur-xl border-b border-border-subtle">
      <div className="max-w-[1400px] mx-auto px-6 sm:px-8 lg:px-12 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 no-underline group relative z-10">
            <motion.div 
              className="w-10 h-10 rounded-xl bg-bg-overlay border border-border-subtle flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform group-hover:border-brand-primary"
            >
               <motion.img
                src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                alt="Port Daddy"
                className="h-6 w-auto"
              />
            </motion.div>
            <motion.span className="font-black text-xl tracking-tighter text-text-primary">port-daddy.</motion.span>
          </Link>

          {/* Desktop Links */}
          <div className="hidden xl:flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = location.pathname === link.href;
              return (
                <Link 
                  key={link.label} 
                  to={link.href} 
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest no-underline transition-all flex items-center gap-2 group ${isActive ? 'bg-brand-primary text-brand-on-primary shadow-lg' : 'text-text-muted hover:text-text-primary hover:bg-bg-overlay'}`}
                >
                  <link.icon size={14} className={isActive ? '' : 'opacity-40 group-hover:opacity-100 transition-opacity'} />
                  {link.label}
                </Link>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4 relative z-10">
            <motion.button
              onClick={toggle}
              className="p-3 rounded-xl border border-border-subtle bg-bg-overlay text-text-muted hover:text-text-primary hover:border-brand-primary transition-all"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </motion.button>

            <motion.button
              onClick={() => window.open('https://github.com/erichowens/port-daddy', '_blank')}
              className="p-3 rounded-xl border border-border-subtle bg-bg-overlay text-text-muted hover:text-text-primary hover:border-brand-primary transition-all hidden sm:flex"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Github size={18} />
            </motion.button>

            <motion.button
              className="xl:hidden p-3 rounded-xl border border-border-subtle bg-bg-overlay text-text-muted"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="xl:hidden bg-bg-surface border-b border-border-subtle overflow-hidden font-sans"
          >
            <div className="px-6 py-10 space-y-4">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-bg-overlay no-underline text-lg font-bold text-text-primary"
                  onClick={() => setMobileOpen(false)}
                >
                  <link.icon size={20} className="text-brand-primary" />
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
