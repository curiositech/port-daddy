import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { Clock, Play, Zap, Shield, Globe, Sparkles, Anchor, Share2, Layers, Search, Box, History, Terminal, Mail, Candy, Eye, Monitor, Workflow, Radio, Ship, Bot, Droplets } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { TUTORIALS as TUTORIALS_DATA } from '@/data/tutorials'

// Map slugs to icons
const ICON_MAP: Record<string, any> = {
  'getting-started': Sparkles,
  'multi-agent': Share2,
  'monorepo': Box,
  'debugging': Search,
  'tunnel': Globe,
  'dns': Globe,
  'session-phases': Workflow,
  'inbox': Mail,
  'sugar': Candy,
  'always-on': Eye,
  'pd-spawn': Bot,
  'harbors': Shield,
  'dashboard': Monitor,
  'time-travel': History,
  'pipelines': Layers,
  'watch': Radio,
  'remote-harbors': Ship,
  'fleet': Bot,
  'pheromone': Droplets,
}

interface TutorialWithIcon {
  slug: string
  number: string
  title: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  time: string
  tags: string[]
  href: string
  icon: any
}

const TUTORIALS: TutorialWithIcon[] = TUTORIALS_DATA.map(t => ({
  ...t,
  icon: ICON_MAP[t.slug] || Terminal,
}))

const LEVEL_BADGE: Record<string, 'teal' | 'gold' | 'red'> = {
  beginner: 'teal',
  intermediate: 'gold',
  advanced: 'red',
}

export function TutorialsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col font-sans"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Hero Section */}
      <section className="pt-24 pb-14 px-6 sm:px-8 lg:px-12 flex flex-col items-center text-center">
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-5">
          <Badge variant="red" size="lg" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em]">
            Academy of Coordination
          </Badge>

          <motion.div
            className="w-20 h-20 rounded-[28px] flex items-center justify-center"
            style={{
              background: 'var(--surface-base)',
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            <Anchor size={36} style={{ color: 'var(--brand-primary)' }} />
          </motion.div>

          <motion.h1
            className="text-5xl sm:text-7xl font-display font-black tracking-tighter leading-[0.85]"
            style={{ color: 'var(--text-primary)' }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Master the <br />
            <span style={{ color: 'var(--brand-primary)' }}>Swarm Logic.</span>
          </motion.h1>

          <motion.p
            className="text-xl sm:text-2xl max-w-3xl leading-relaxed font-semibold"
            style={{ color: 'var(--text-secondary)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            From your first port claim to multi-agent coordination. Learn to orchestrate AI agents with sessions, pub/sub, and crash recovery.
          </motion.p>
        </div>
      </section>

      {/* Tutorials Grid */}
      <main className="flex-1 py-10 px-6 sm:px-8 lg:px-12 max-w-7xl mx-auto w-full">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TUTORIALS.map((tutorial, i) => (
            <motion.div
              key={tutorial.slug}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.04 }}
              className="group h-full"
            >
              <Link to={tutorial.href} className="no-underline block h-full">
                <Surface
                  depth="raised"
                  radius="2xl"
                  padding="lg"
                  interactive
                  className="h-full flex flex-col items-center text-center gap-4"
                >
                  {/* Icon */}
                  <div
                    className="w-14 h-14 rounded-[18px] flex items-center justify-center group-hover:scale-110 transition-transform"
                    style={{
                      background: 'var(--surface-base)',
                      boxShadow: 'var(--shadow-inset)',
                    }}
                  >
                    <tutorial.icon size={26} style={{ color: 'var(--brand-primary)' }} />
                  </div>

                  {/* Level Badge */}
                  <Badge variant={LEVEL_BADGE[tutorial.level]} size="sm">
                    {tutorial.level}
                  </Badge>

                  {/* Title + Description */}
                  <div className="space-y-3 flex-1 flex flex-col items-center">
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.3em] font-mono"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Lesson {tutorial.number}
                    </span>
                    <h3
                      className="text-2xl font-display font-black leading-tight"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {tutorial.title}
                    </h3>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {tutorial.description}
                    </p>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap justify-center gap-2">
                    {tutorial.tags.map(tag => (
                      <Badge key={tag} variant="default" size="sm">{tag}</Badge>
                    ))}
                  </div>

                  {/* Footer */}
                  <div
                    className="w-full flex items-center justify-between pt-4"
                    style={{ borderTop: '1px solid var(--border-default)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Clock size={14} style={{ color: 'var(--brand-primary)' }} />
                      <span
                        className="text-[10px] font-black uppercase tracking-widest"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {tutorial.time}
                      </span>
                    </div>
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"
                      style={{
                        background: 'var(--surface-base)',
                        boxShadow: 'var(--shadow-inset)',
                      }}
                    >
                      <Play size={12} fill="currentColor" style={{ color: 'var(--brand-primary)' }} className="ml-0.5" />
                    </div>
                  </div>
                </Surface>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Verification Callout */}
        <motion.div
          className="mt-14"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
          <Surface depth="flat" radius="2xl" padding="xl" className="flex flex-col items-center text-center gap-6 relative overflow-hidden">
            {/* Ghost anchor */}
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
              <Anchor size={400} style={{ color: 'var(--text-primary)' }} />
            </div>

            <div className="space-y-4 max-w-3xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" size="lg" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em]">
                Automated Verification
              </Badge>
              <h3
                className="text-3xl sm:text-5xl font-display font-black tracking-tighter leading-[0.9]"
                style={{ color: 'var(--text-primary)' }}
              >
                Certified <span style={{ color: 'var(--brand-primary)' }}>Academy.</span>
              </h3>
              <p
                className="text-lg leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                Every lesson is backed by automated verification. We use Playwright and VHS to record live CLI sessions and ensure the code you learn today works in your harbor tomorrow.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-4xl relative z-10">
              {[
                { label: 'VHS Recorded', icon: Play },
                { label: 'Playwright Verified', icon: Shield },
                { label: 'Unit Tested', icon: Sparkles },
                { label: 'Continuous CI', icon: Zap }
              ].map((item) => (
                <Surface
                  key={item.label}
                  depth="inset"
                  radius="xl"
                  padding="md"
                  className="flex flex-col items-center gap-4 group"
                >
                  <div
                    className="w-12 h-12 rounded-[16px] flex items-center justify-center group-hover:scale-110 transition-transform"
                    style={{
                      background: 'var(--surface-raised)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <item.icon size={22} style={{ color: 'var(--brand-primary)' }} />
                  </div>
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.2em]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {item.label}
                  </span>
                </Surface>
              ))}
            </div>
          </Surface>
        </motion.div>
      </main>

      <Footer />
    </motion.div>
  )
}
