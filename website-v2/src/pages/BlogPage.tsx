import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { blogPosts } from '@/data/blogData'
import { Badge } from '@/components/ui/Badge'
import { Calendar, User, ArrowRight, ShieldCheck, Zap, Activity, BookOpen } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

export function BlogPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <motion.section
        className="py-12 sm:py-20 px-4 sm:px-6 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-6 sm:gap-8">
           <Badge variant="teal" className="px-6 sm:px-8 py-2 sm:py-3 text-[10px] font-black uppercase tracking-[0.25em]">Engineering Log</Badge>
           <motion.h1
             className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tighter font-display leading-[0.85] m-0 text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <br />
             <motion.span className="text-[var(--brand-primary)]">Control Plane.</motion.span>
           </motion.h1>
           <motion.p
             className="text-base sm:text-xl lg:text-2xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Deep dives into protocol design, formal verification, and the mathematical underpinnings of autonomous coordination.
           </motion.p>
        </div>
      </motion.section>

      {/* Blog Feed */}
      <motion.main id="main-content" className="flex-1 py-12 sm:py-20 px-4 sm:px-6 lg:px-10 max-w-5xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="flex flex-col items-center gap-6 sm:gap-8 w-full">
          {blogPosts.map((post, index) => (
            <motion.article
              key={post.id}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group w-full"
            >
              <Link to={`/blog/${post.slug}`} className="no-underline block">
                <motion.div
                  className="p-6 sm:p-10 lg:p-16 rounded-2xl sm:rounded-[48px] lg:rounded-[80px] transition-all duration-300 flex flex-col items-center text-center gap-6 sm:gap-8"
                  style={{
                    background: 'var(--surface-raised)',
                    boxShadow: 'var(--shadow-raised)',
                  }}
                  whileHover={{ y: -8, boxShadow: 'var(--shadow-flat)' }}
                >
                  <div className="w-full flex flex-col items-center gap-4 sm:gap-6">
                     <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] font-mono">
                        <div className="flex items-center gap-2 sm:gap-3">
                           <Calendar size={14} className="text-[var(--brand-primary)]" />
                           {post.date}
                        </div>
                        <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                        <div className="flex items-center gap-2 sm:gap-3">
                           <User size={14} className="text-[var(--p-teal-400)]" />
                           {post.author}
                        </div>
                     </div>
                     <Badge variant="default" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest">
                        <span className="text-[var(--text-primary)]">Engineering Depth</span>
                     </Badge>
                  </div>

                  <div className="space-y-4 sm:space-y-6 flex flex-col items-center">
                    <motion.h2 className="m-0 text-2xl sm:text-4xl lg:text-5xl font-display font-black tracking-tight leading-tight text-[var(--text-primary)] group-hover:text-[var(--brand-primary)] transition-colors">
                      {post.title}
                    </motion.h2>
                    <motion.p className="m-0 text-base sm:text-xl leading-relaxed text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors max-w-2xl">
                      {post.excerpt}
                    </motion.p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
                     {post.tags.map(tag => (
                       <span
                         key={tag}
                         className="px-3 sm:px-5 py-1.5 sm:py-2 rounded-xl text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest"
                         style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                       >
                         {tag}
                       </span>
                     ))}
                  </div>

                  <div className="w-full flex items-center justify-between pt-6 sm:pt-10" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                     <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-[var(--status-success)] pulse-active shadow-[0_0_12px_var(--status-success)]" />
                        <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">Protocol Verified</span>
                     </div>
                     <div className="flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-4 sm:group-hover:gap-6 transition-all">
                        Dive Deeper
                        <ArrowRight size={16} />
                     </div>
                  </div>
                </motion.div>
              </Link>
            </motion.article>
          ))}
        </div>

        {/* Vision Callout */}
        <motion.div
          className="mt-12 sm:mt-20 p-8 sm:p-16 lg:p-24 rounded-2xl sm:rounded-[60px] lg:rounded-[100px] flex flex-col items-center text-center gap-6 sm:gap-8 relative overflow-hidden w-full mx-auto"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <BookOpen size={800} />
           </div>

           <div className="space-y-6 sm:space-y-10 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-6 sm:px-8 py-2 sm:py-3 text-[10px] font-black uppercase tracking-widest">Formal Methods</Badge>
              <h3 className="text-2xl sm:text-4xl lg:text-6xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                Soundness by <br />
                <span className="text-[var(--p-teal-400)]">Design.</span>
              </h3>
              <p className="text-base sm:text-xl lg:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                The Journal isn't just about features—it's about proofs. We document our journey through symbolic analysis, noise protocol implementation, and the mathematical underpinnings of agentic coordination.
              </p>
           </div>

           <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-8 w-full max-w-5xl relative z-10">
              {[
                { label: 'ProVerif 2.05', icon: ShieldCheck },
                { label: 'Noise Protocol', icon: Activity },
                { label: 'Anchor V4', icon: Zap }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-6 sm:p-10 rounded-2xl sm:rounded-[48px] flex flex-col items-center gap-4 sm:gap-6 group transition-all"
                  style={{
                    background: 'var(--surface-sunken)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                   <div
                     className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"
                     style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                   >
                      <item.icon size={24} className="text-[var(--brand-primary)]" />
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.label}</span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
