import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { blogPosts } from '@/data/blogData'
import { Badge } from '@/components/ui/Badge'
import { Calendar, User, ArrowRight, BookOpen, ShieldCheck, Zap, Activity } from 'lucide-react'
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
        className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-7xl mx-auto text-center relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Engineering Log</Badge>
           <motion.h1 
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <span className="text-[var(--brand-primary)]">Control Plane</span> <br /> Journal.
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Deep dives into protocol design, formal verification, and the future of autonomous coordination.
           </motion.p>
        </div>
      </motion.section>

      {/* Blog Feed */}
      <motion.main className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-5xl mx-auto w-full font-sans">
        <div className="space-y-12">
          {blogPosts.map((post, index) => (
            <motion.article 
              key={post.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group"
            >
              <Link to={`/blog/${post.slug}`} className="no-underline block">
                <motion.div 
                  className="p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-10"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  whileHover={{ y: -8, borderColor: 'var(--brand-primary)', boxShadow: '0 40px 80px -20px rgba(58,173,173,0.1)' }}
                >
                  <div className="w-full flex justify-between items-center">
                     <div className="flex items-center gap-6 text-[10px] font-black uppercase tracking-[0.2em] opacity-40 font-mono">
                        <div className="flex items-center gap-2">
                           <Calendar size={14} className="text-[var(--brand-primary)]" />
                           {post.date}
                        </div>
                        <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                        <div className="flex items-center gap-2">
                           <User size={14} className="text-[var(--p-teal-400)]" />
                           {post.author}
                        </div>
                     </div>
                     <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">Engineering</Badge>
                  </div>

                  <div className="space-y-6">
                    <h2 className="m-0 text-4xl sm:text-5xl font-display font-black leading-tight text-[var(--text-primary)] group-hover:text-[var(--brand-primary)] transition-colors">
                      {post.title}
                    </h2>
                    <p className="m-0 text-xl leading-relaxed text-[var(--text-secondary)] opacity-70 group-hover:opacity-100 transition-opacity">
                      {post.excerpt}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                     {post.tags.map(tag => (
                       <span key={tag} className="px-4 py-1.5 rounded-xl bg-[var(--bg-overlay)] text-[10px] font-bold opacity-40 uppercase tracking-widest border border-transparent group-hover:border-[var(--border-subtle)] transition-all">{tag}</span>
                     ))}
                  </div>

                  <div className="w-full flex items-center justify-between pt-8 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                     <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-active" />
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Published & Verified</span>
                     </div>
                     <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-4 transition-all">
                        Read Full Post
                        <ArrowRight size={14} />
                     </div>
                  </div>
                </motion.div>
              </Link>
            </motion.article>
          ))}
        </div>

        {/* Impressively long footer note for the blog */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <ShieldCheck size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Formal Methods</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Soundness by <span className="text-[var(--p-teal-400)]">Design.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                The Journal isn't just about features—it's about proofs. We document our journey through symbolic analysis, noise protocol implementation, and the mathematical underpinnings of agentic coordination.
              </p>
           </div>

           <div className="grid sm:grid-cols-3 gap-8 w-full max-w-4xl">
              {[
                { label: 'ProVerif 2.05', icon: ShieldCheck },
                { label: 'Noise Protocol', icon: Activity },
                { label: 'Anchor V4', icon: Zap }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
