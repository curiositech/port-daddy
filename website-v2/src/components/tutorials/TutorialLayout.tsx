import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Clock, BookOpen, ChevronRight, Home, Layout, List, ArrowLeft, ArrowRight, Zap, Shield, Globe, Share2 } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

interface TutorialLayoutProps {
  title: string
  description: string
  number: string
  total: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  readTime: string
  children: React.ReactNode
  prev?: { title: string; href: string }
  next?: { title: string; href: string }
}

export function TutorialLayout({
  title,
  description,
  number,
  total,
  level,
  readTime,
  children,
  prev,
  next
}: TutorialLayoutProps) {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen font-sans flex flex-col selection:bg-[var(--brand-primary)] selection:text-white" 
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', paddingTop: 'var(--nav-height)' }}
    >
      {/* Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-[var(--brand-primary)] z-[100] origin-left shadow-[0_0_12px_rgba(58,173,173,0.5)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.section
        className="py-32 px-4 sm:px-6 lg:px-8 border-b relative overflow-hidden shrink-0"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        {/* Abstract background shapes */}
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.12] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full blur-[100px] opacity-[0.08] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--p-amber-500) 0%, transparent 70%)' }} 
          animate={{ scale: [1, 1.2, 1], x: [0, -30, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        <motion.div className="max-w-4xl mx-auto relative z-10 text-center flex flex-col items-center">
          <motion.nav className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] mb-14 font-sans" style={{ color: 'var(--text-muted)' }}>
            <Link to="/" className="hover:text-[var(--text-primary)] transition-all no-underline flex items-center gap-1.5 font-sans group">
              <Home size={12} className="group-hover:scale-110 transition-transform" />
              Home
            </Link>
            <ChevronRight size={12} className="opacity-30" />
            <Link to="/tutorials" className="hover:text-[var(--text-primary)] transition-all no-underline flex items-center gap-1.5 font-sans group">
              <BookOpen size={12} className="group-hover:scale-110 transition-transform" />
              Academy
            </Link>
            <ChevronRight size={12} className="opacity-30" />
            <motion.span style={{ color: 'var(--brand-primary)' }} className="flex items-center gap-1.5 font-sans font-black">
              <Layout size={12} />
              Lesson {number}
            </motion.span>
          </motion.nav>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <motion.div className="flex items-center gap-5 mb-10 font-sans">
              <Badge variant={level === 'Beginner' ? 'teal' : level === 'Intermediate' ? 'amber' : 'neutral'} className="px-5 py-2 text-[9px] font-black uppercase tracking-widest shadow-xl shadow-[var(--brand-primary)]/5">
                {level}
              </Badge>
              <motion.div className="h-[1px] w-12 bg-[var(--border-strong)] opacity-20" />
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] opacity-60 font-mono">
                <Clock size={14} className="text-[var(--brand-primary)]" />
                {readTime}
              </motion.div>
            </motion.div>

            <motion.h1 className="text-6xl sm:text-8xl font-bold mb-10 tracking-tighter font-display" style={{ color: 'var(--text-primary)', lineHeight: 0.95 }}>
              {title}
            </motion.h1>
            <motion.p className="text-xl sm:text-2xl max-w-3xl leading-relaxed mb-14 mx-auto font-sans opacity-80" style={{ color: 'var(--text-secondary)' }}>
              {description}
            </motion.p>

            <motion.div className="flex flex-wrap items-center justify-center gap-10 font-sans opacity-60">
               <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                 <Zap size={14} className="text-[var(--p-amber-400)]" />
                 Instant Port
               </motion.div>
               <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                 <Shield size={14} className="text-[var(--p-teal-400)]" />
                 Secure DNS
               </motion.div>
               <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                 <Share2 size={14} className="text-[var(--p-blue-400)]" />
                 P2P Tunnel
               </motion.div>
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.section>

      {/* Main Content Area */}
      <motion.main className="flex-1 max-w-4xl mx-auto w-full px-6 sm:px-8 lg:px-10 py-24 font-sans relative">
        <motion.article 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="prose prose-invert prose-lg max-w-none 
            prose-headings:font-display prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-[var(--text-primary)]
            prose-h2:text-4xl prose-h2:mt-24 prose-h2:mb-10 prose-h2:pb-4 prose-h2:border-b prose-h2:border-[var(--border-subtle)]
            prose-h3:text-2xl prose-h3:mt-16 prose-h3:mb-6
            prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-8 prose-p:text-xl
            prose-code:text-[var(--brand-primary)] prose-code:bg-[var(--interactive-active)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none prose-code:font-mono prose-code:font-bold
            prose-strong:text-[var(--text-primary)] prose-strong:font-black
            prose-ul:list-disc prose-ul:pl-8 prose-ul:mb-10 prose-ul:space-y-4
            prose-li:text-[var(--text-secondary)] prose-li:text-lg
            prose-blockquote:border-l-4 prose-blockquote:border-[var(--brand-primary)] prose-blockquote:bg-[var(--bg-surface)] prose-blockquote:py-4 prose-blockquote:px-8 prose-blockquote:rounded-r-2xl prose-blockquote:italic"
        >
          {children}
        </motion.article>

        {/* Lessons Navigation */}
        <motion.nav 
          className="mt-32 pt-16 border-t grid sm:grid-cols-2 gap-8 font-sans mb-16"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {prev ? (
            <Link to={prev.href} className="group no-underline block">
              <motion.div 
                className="h-full p-10 rounded-[40px] border transition-all duration-[var(--p-transition-spring)] hover:border-[var(--brand-primary)] hover:bg-[var(--interactive-hover)] flex flex-col items-start gap-4"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                whileHover={{ x: -8 }}
              >
                <motion.span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] opacity-40 font-sans group-hover:opacity-100 group-hover:text-[var(--brand-primary)] transition-all">
                  <ArrowLeft size={14} />
                  Previous
                </motion.span>
                <motion.h4 className="m-0 text-2xl font-display font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{prev.title}</motion.h4>
              </motion.div>
            </Link>
          ) : <div />}

          {next ? (
            <Link to={next.href} className="group no-underline block">
              <motion.div 
                className="h-full p-10 rounded-[40px] border-2 transition-all duration-[var(--p-transition-spring)] hover:bg-[var(--interactive-hover)] flex flex-col items-end text-right gap-4"
                style={{ borderColor: 'var(--brand-primary)', background: 'var(--bg-surface)' }}
                whileHover={{ x: 8 }}
              >
                <motion.span className="flex items-center justify-end gap-2 text-[10px] font-black uppercase tracking-[0.25em] font-sans text-[var(--brand-primary)]">
                  Next Up
                  <ArrowRight size={14} />
                </motion.span>
                <motion.h4 className="m-0 text-2xl font-display font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{next.title}</motion.h4>
              </motion.div>
            </Link>
          ) : (
            <motion.div 
              className="sm:col-span-2 p-16 rounded-[60px] border border-dashed flex flex-col items-center text-center gap-8 relative overflow-hidden"
              style={{ borderColor: 'var(--brand-primary)', background: 'var(--bg-overlay)' }}
            >
              <motion.div 
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                animate={{ rotate: 360 }}
                transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
              >
                <Globe size={600} />
              </motion.div>
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Certification Ready</Badge>
              <motion.h3 className="text-5xl font-bold font-display m-0" style={{ color: 'var(--text-primary)' }}>Mastery Achieved.</motion.h3>
              <motion.p className="text-xl max-w-xl font-sans opacity-70">You've completed the core coordination series. Your harbor is ready for deployment.</motion.p>
              <Button size="lg" className="px-12 py-8 rounded-full text-lg font-black tracking-wide" onClick={() => window.location.href = '/docs'}>
                EXPLORE THE SDK REFERENCE
              </Button>
            </motion.div>
          )}
        </motion.nav>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
