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
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <motion.section 
        className="py-20 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden flex flex-col items-center justify-center text-center" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-8">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Engineering Log</Badge>
           <motion.h1 
             className="text-4xl sm:text-6xl font-black tracking-tighter font-display leading-[0.85] m-0 text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <br />
             <motion.span className="text-[var(--brand-primary)]">Control Plane.</motion.span>
           </motion.h1>
           <motion.p 
             className="text-xl sm:text-2xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Deep dives into protocol design, formal verification, and the mathematical underpinnings of autonomous coordination.
           </motion.p>
        </div>
      </motion.section>

      {/* Blog Feed */}
      <motion.main id="main-content" className="flex-1 py-20 px-6 sm:px-8 lg:px-10 max-w-5xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="flex flex-col items-center gap-8 w-full">
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
                  className="p-16 rounded-[80px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-8 shadow-2xl"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  whileHover={{ y: -12, borderColor: 'var(--brand-primary)', boxShadow: '0 40px 80px -20px rgba(58,173,173,0.15)' }}
                >
                  <div className="w-full flex flex-col items-center gap-6">
                     <div className="flex items-center justify-center gap-8 text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] font-mono">
                        <div className="flex items-center gap-3">
                           <Calendar size={16} className="text-[var(--brand-primary)]" />
                           {post.date}
                        </div>
                        <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                        <div className="flex items-center gap-3">
                           <User size={16} className="text-[var(--p-teal-400)]" />
                           {post.author}
                        </div>
                     </div>
                     <Badge variant="default" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)] shadow-sm">
                        <span className="text-[var(--text-primary)]">Engineering Depth</span>
                     </Badge>
                  </div>

                  <div className="space-y-6 flex flex-col items-center">
                    <motion.h2 className="m-0 text-4xl sm:text-6xl font-display font-black tracking-tight leading-tight text-[var(--text-primary)] group-hover:text-[var(--brand-primary)] transition-colors">
                      {post.title}
                    </motion.h2>
                    <motion.p className="m-0 text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors max-w-2xl">
                      {post.excerpt}
                    </motion.p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3">
                     {post.tags.map(tag => (
                       <motion.span key={tag} className="px-5 py-2 rounded-xl bg-[var(--bg-overlay)] text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest border border-transparent group-hover:border-[var(--border-subtle)] transition-all shadow-sm">{tag}</motion.span>
                     ))}
                  </div>

                  <div className="w-full flex items-center justify-between pt-10 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                     <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-[var(--status-success)] pulse-active shadow-[0_0_12px_var(--status-success)]" />
                        <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">Protocol Verified</motion.span>
                     </div>
                     <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-6 transition-all">
                        Dive Deeper
                        <ArrowRight size={18} />
                     </div>
                  </div>
                </motion.div>
              </Link>
            </motion.article>
          ))}
        </div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-20 p-24 rounded-[100px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-8 relative overflow-hidden w-full shadow-2xl mx-auto"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <BookOpen size={800} />
           </div>
           
           <div className="space-y-10 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-2xl">Formal Methods</Badge>
              <h3 className="text-4xl sm:text-6xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                Soundness by <br />
                <span className="text-[var(--p-teal-400)]">Design.</span>
              </h3>
              <p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                The Journal isn't just about features—it's about proofs. We document our journey through symbolic analysis, noise protocol implementation, and the mathematical underpinnings of agentic coordination.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-5xl relative z-10">
              {[
                { label: 'ProVerif 2.05', icon: ShieldCheck },
                { label: 'Noise Protocol', icon: Activity },
                { label: 'Anchor V4', icon: Zap }
              ].map((item, i) => (
                <motion.div key={i} className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-6 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.label}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
