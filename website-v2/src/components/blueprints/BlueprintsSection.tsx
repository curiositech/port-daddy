import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { BLUEPRINTS } from '@/data/blueprints'
import { ArrowRight, Code, Search, Network, Shield, Cpu, Zap, Share2 } from 'lucide-react'

const ICON_MAP: Record<string, any> = {
  pipeline: Zap,
  research: Search,
  multiplayer: Network,
  ops: Shield,
  swarm: Share2,
  remote: Cpu
}

export function BlueprintsSection() {
  return (
    <motion.section 
      className="py-32 px-4 sm:px-6 lg:px-8 bg-[var(--bg-base)] font-sans relative overflow-hidden"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      {/* Background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
         <div className="absolute top-[10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--p-amber-500)] opacity-[0.03] blur-[120px]" />
         <div className="absolute bottom-[10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--brand-primary)] opacity-[0.03] blur-[120px]" />
      </div>

      <motion.div className="max-w-7xl mx-auto font-sans relative z-10">
        <motion.div className="flex flex-col md:flex-row md:items-end justify-between gap-12 mb-32 font-sans">
          <motion.div className="max-w-3xl font-sans">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <Badge variant="teal" className="mb-10 px-6 py-2 uppercase tracking-[0.25em] text-[10px] font-black shadow-xl">Standard Templates</Badge>
            </motion.div>
            <motion.h2 
              className="text-5xl sm:text-8xl font-black tracking-tight font-display mb-10 leading-[0.95]"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              Deploy your first <br />
              <motion.span className="text-[var(--brand-primary)]">Agentic Swarm.</motion.span>
            </motion.h2>
            <motion.p 
              className="text-2xl text-[var(--text-secondary)] leading-relaxed font-sans max-w-2xl opacity-70"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.1 }}
            >
              Don't start from zero. Use these high-fidelity blueprints to launch 
              complex, self-healing coordination patterns in seconds.
            </motion.p>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Link to="/blueprints" className="no-underline">
              <motion.button 
                className="group flex items-center gap-3 px-8 py-4 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--interactive-hover)] transition-all font-black text-[10px] uppercase tracking-widest"
                whileHover={{ y: -4 }}
              >
                View Library
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </Link>
          </motion.div>
        </motion.div>

        <motion.div className="grid sm:grid-cols-2 gap-10 font-sans">
          {BLUEPRINTS.map((blueprint, i) => {
            const Icon = ICON_MAP[blueprint.hero] || Code
            return (
              <motion.div
                key={blueprint.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="group"
              >
                <Link to={`/blueprints/${blueprint.id}`} className="no-underline block h-full">
                  <motion.div 
                    className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-10"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                    whileHover={{ y: -12, borderColor: 'var(--brand-primary)', boxShadow: '0 40px 80px -20px rgba(58,173,173,0.15)' }}
                  >
                    <div className="w-full flex justify-between items-start">
                       <div className="w-20 h-20 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                          <Icon size={40} className="text-[var(--brand-primary)]" />
                       </div>
                       <div className="flex flex-wrap gap-2 justify-end max-w-[200px]">
                          {blueprint.tags.map(tag => (
                            <Badge key={tag} variant="neutral" className="text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">{tag}</Badge>
                          ))}
                       </div>
                    </div>

                    <div className="space-y-4 flex-1">
                      <h3 className="m-0 text-3xl sm:text-4xl font-display font-black leading-tight text-[var(--text-primary)]">
                        {blueprint.title}
                      </h3>
                      <p className="m-0 text-lg sm:text-xl opacity-60 leading-relaxed text-[var(--text-secondary)] group-hover:opacity-100 transition-opacity">
                        {blueprint.description}
                      </p>
                    </div>

                    <div className="w-full flex items-center justify-between pt-8 border-t border-[var(--border-subtle)] group-hover:border-[var(--brand-primary)]/20 transition-colors">
                       <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-active" />
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-60">Ready to Spawn</span>
                       </div>
                       <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-4 transition-all">
                          Inspect Template
                          <ArrowRight size={14} />
                       </div>
                    </div>
                  </motion.div>
                </Link>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Impressively long additional context */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 left-0 p-10 opacity-[0.02] pointer-events-none">
              <Share2 size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Pattern</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Built for <span className="text-[var(--p-amber-400)]">LangChain</span> & <span className="text-[var(--p-teal-400)]">CrewAI.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                Port Daddy provides the low-level discovery logic that high-level frameworks lack. Whether you are building a tool-calling swarm or a hierarchical agentic workforce, our blueprints ensure they can find each other across any network.
              </p>
           </div>

           <div className="grid sm:grid-cols-3 gap-8 w-full max-w-5xl">
              {[
                { title: 'Semantic DNS', desc: 'No more hardcoded IP addresses in your LangChain tools.', icon: Globe },
                { title: 'Cryptographic Auth', desc: 'Secure your CrewAI members with HMAC-signed harbor cards.', icon: Shield },
                { title: 'Swarm Radio', desc: 'Low-latency inter-agent signaling for real-time state sync.', icon: Radio }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center space-y-4">
                   <div className="w-12 h-12 rounded-2xl bg-[var(--brand-primary)]/10 flex items-center justify-center mx-auto">
                      <item.icon size={24} className="text-[var(--brand-primary)]" />
                   </div>
                   <h4 className="m-0 text-xl font-display font-black leading-tight">{item.title}</h4>
                   <p className="text-sm opacity-60 m-0 leading-relaxed">{item.desc}</p>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}

import { Globe, Radio } from 'lucide-react'
