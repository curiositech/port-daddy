import { useParams, Link, Navigate } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { blogPosts } from '@/data/blogData'
import { Mermaid } from '@/components/ui/Mermaid'
import { Badge } from '@/components/ui/Badge'
import { Calendar, User, ArrowLeft, Share2, Clock, BookOpen, ShieldCheck } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const post = blogPosts.find(p => p.slug === slug)
  const { scrollYProgress } = useScroll()
  
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  if (!post) {
    return <Navigate to="/blog" replace />
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-[var(--brand-primary)] z-[100] origin-left shadow-[0_0_12px_rgba(58,173,173,0.5)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.header 
        className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center text-center gap-10">
           <Link to="/blog" className="no-underline group">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 group-hover:text-[var(--brand-primary)] transition-all">
                 <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                 Back to Journal
              </motion.div>
           </Link>

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

           <motion.h1 
             className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[1.05]"
             initial={{ opacity: 0, y: 24 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             {post.title}
           </motion.h1>

           <div className="flex flex-wrap justify-center gap-3">
              {post.tags.map(tag => (
                <Badge key={tag} variant="neutral" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">{tag}</Badge>
              ))}
           </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <motion.main className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-4xl mx-auto w-full font-sans relative">
        <motion.article 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="prose prose-invert prose-lg max-w-none 
            prose-headings:font-display prose-headings:font-black prose-headings:tracking-tight prose-headings:text-[var(--text-primary)]
            prose-h2:text-4xl prose-h2:mt-24 prose-h2:mb-10 prose-h2:pb-4 prose-h2:border-b prose-h2:border-[var(--border-subtle)]
            prose-h3:text-2xl prose-h3:mt-16 prose-h3:mb-6
            prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-p:mb-8 prose-p:text-xl
            prose-code:text-[var(--brand-primary)] prose-code:bg-[var(--interactive-active)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none prose-code:font-mono prose-code:font-bold
            prose-strong:text-[var(--text-primary)] prose-strong:font-black
            prose-ul:list-disc prose-ul:pl-8 prose-ul:mb-10 prose-ul:space-y-4
            prose-li:text-[var(--text-secondary)] prose-li:text-lg
            prose-blockquote:border-l-4 prose-blockquote:border-[var(--brand-primary)] prose-blockquote:bg-[var(--bg-surface)] prose-blockquote:py-8 prose-blockquote:px-10 prose-blockquote:rounded-r-3xl prose-blockquote:italic prose-blockquote:text-2xl"
        >
          <ReactMarkdown
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '')
                if (!inline && match && match[1] === 'mermaid') {
                  return <Mermaid chart={String(children).replace(/\n$/, '')} />
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              }
            }}
          >
            {post.content}
          </ReactMarkdown>
        </motion.article>

        {/* Impressively long additional context */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <ShieldCheck size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Protocol Safety</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Soundness is <span className="text-[var(--p-teal-400)]">Mandatory.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                This engineering post was produced as part of our commitment to transparency and mathematical rigor. We believe the future of AI coordination must be built on a foundation of formal methods and verified protocols.
              </p>
              <div className="flex flex-wrap justify-center gap-6 pt-4">
                 <div className="flex items-center gap-3 px-6 py-3 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <Share2 size={16} className="text-[var(--brand-primary)]" />
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60 text-[var(--text-primary)]">Share Protocol Insights</span>
                 </div>
              </div>
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
