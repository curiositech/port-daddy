import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { PRODUCT_FEATURES } from '@/data/product'
import { 
  Shield, History, Radio, 
  Anchor, Code, Cpu, Share2, Terminal, Sparkles, Zap
} from 'lucide-react'

const ICON_MAP: Record<string, any> = {
  'ports': Anchor,
  'coordination': Radio,
  'security': Shield,
  'observability': History,
  'agents': Cpu,
  'intelligence': Sparkles
}

const CATEGORY_COLORS: Record<string, string> = {
  'ports': 'var(--p-blue-400)',
  'coordination': 'var(--p-teal-400)',
  'security': 'var(--p-amber-400)',
  'observability': 'var(--p-red-400)',
  'agents': 'var(--p-purple-400)',
  'intelligence': 'var(--p-blue-300)'
}

export function Features() {
  return (
    <motion.section 
      id="features" 
      className="py-48 px-6 sm:px-8 lg:px-10 font-sans selection:bg-[var(--brand-primary)] selection:text-white bg-[var(--bg-base)]"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto font-sans flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-40 flex flex-col items-center gap-12"
        >
          <div className="flex flex-col items-center gap-6">
             <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] font-sans shadow-xl">The Enumeration</Badge>
             <motion.h2 className="text-6xl sm:text-9xl font-bold font-display tracking-tight leading-[0.9] m-0" style={{ color: 'var(--text-primary)' }}>
               The Definitive <br />
               <motion.span className="text-[var(--brand-primary)]">Control Plane.</motion.span>
             </motion.h2>
          </div>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans opacity-70" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy provides the foundational primitives required to turn a collection of 
            AI scripts into a production-grade, autonomous organization.
          </motion.p>
        </motion.div>

        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12 w-full">
          {PRODUCT_FEATURES.map((feature, i) => {
            const Icon = ICON_MAP[feature.category] || Code
            const color = CATEGORY_COLORS[feature.category] || 'var(--brand-primary)'
            
            return (
              <motion.div
                key={feature.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className="group relative"
              >
                <motion.div 
                  className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-10"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  whileHover={{ y: -12, borderColor: color, boxShadow: `0 40px 80px -20px ${color}15` }}
                >
                  <motion.div 
                    className="w-20 h-20 rounded-[32px] flex items-center justify-center border transition-colors group-hover:scale-110 duration-[var(--p-transition-spring)]"
                    style={{ background: `${color}10`, borderColor: `${color}20` }}
                  >
                    <Icon size={40} style={{ color }} />
                  </motion.div>
                  
                  <div className="space-y-4 flex-1">
                    <div className="flex flex-col items-center gap-3">
                      <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                        {feature.title}
                      </motion.h3>
                      {feature.status !== 'core' && (
                        <Badge variant={feature.status === 'new' ? 'teal' : 'amber'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                          {feature.status}
                        </Badge>
                      )}
                    </div>
                    
                    <motion.p className="m-0 text-lg leading-relaxed font-sans opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                      {feature.description}
                    </motion.p>
                  </div>

                  <motion.div 
                    className="w-full p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-between group-hover:border-[var(--border-strong)] transition-colors"
                  >
                    <motion.code className="font-mono text-xs font-bold" style={{ color: 'var(--brand-primary)' }}>
                      {feature.cli}
                    </motion.code>
                    <Terminal size={16} className="opacity-20 group-hover:opacity-40 transition-opacity" />
                  </motion.div>
                </motion.div>
              </motion.div>
            )
          })}
        </motion.div>
        
        {/* Swarm Call to Action */}
        <motion.div 
          className="mt-48 p-24 rounded-[100px] border border-dashed border-[var(--border-strong)] text-center flex flex-col items-center gap-12 relative overflow-hidden shadow-2xl w-full"
          style={{ borderColor: 'var(--brand-primary)', background: 'var(--bg-overlay)' }}
        >
          <motion.div 
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            animate={{ rotate: -360 }}
            transition={{ duration: 180, repeat: Infinity, ease: 'linear' }}
          >
             <Share2 size={1200} className="text-[var(--brand-primary)]" />
          </motion.div>
          <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-2xl">Deployment Ready</Badge>
          <motion.h3 className="text-6xl sm:text-8xl font-display font-black m-0 tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
            One daemon to <br />
            <motion.span className="text-[var(--brand-primary)]">rule the swarm.</motion.span>
          </motion.h3>
          <motion.p className="text-2xl sm:text-3xl max-w-3xl font-sans opacity-70">
            Port Daddy is free, open-source, and installs in seconds. Start building your autonomous organization today.
          </motion.p>
          <motion.div className="flex flex-wrap justify-center gap-10 pt-6">
             <motion.button 
               className="px-16 py-8 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-2xl shadow-[0_32px_64px_rgba(58,173,173,0.3)] transition-all flex items-center gap-4"
               whileHover={{ scale: 1.05, y: -6, boxShadow: '0 40px 80px rgba(58,173,173,0.4)' }}
               whileTap={{ scale: 0.95 }}
               onClick={() => window.location.href = '/tutorials/getting-started'}
             >
               GET STARTED NOW
               <Zap size={28} />
             </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
