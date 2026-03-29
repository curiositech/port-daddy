import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { MessageSquare, Gavel, Trash2, ArrowRight } from 'lucide-react'

export function TemplatesPage() {
  const templates = [
    {
      title: 'Encrypted Messenger',
      description: 'End-to-End Encrypted messaging between agents using asymmetric Harbor Cards and the inbox dead-drop.',
      icon: <MessageSquare className="w-6 h-6 text-brand-primary" />,
      complexity: 'Beginner',
      path: 'https://github.com/erichowens/port-daddy/tree/main/examples/inbox'
    },
    {
      title: 'Resource Auction',
      description: 'Stigmergic task allocation. Agents bid on semantic tokens using pheromones to coordinate without a master.',
      icon: <Gavel className="w-6 h-6 text-brand-secondary" />,
      complexity: 'Advanced',
      path: 'https://github.com/erichowens/port-daddy/tree/main/examples/coordination'
    },
    {
      title: 'Auto-Reaper',
      description: 'A lifecycle guard that watches for "Man Overboard" signals and automatically prunes zombie processes.',
      icon: <Trash2 className="w-6 h-6 text-brand-accent" />,
      complexity: 'Intermediate',
      path: 'https://github.com/erichowens/port-daddy/tree/main/examples/ci'
    }
  ];

  return (
    <div className="min-h-screen pt-32 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        <header className="mb-20">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl sm:text-8xl font-display font-black tracking-tighter mb-6 text-text-primary"
          >
            Built on <span className="text-brand-primary">Anchor.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl sm:text-2xl text-text-secondary max-w-3xl leading-relaxed font-bold"
          >
            Start building secure, coordinate agent swarms today. These exemplary templates show you exactly how to use our core primitives.
          </motion.p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
          {templates.map((template, i) => (
            <motion.div
              key={template.title}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
            >
            <Surface depth="raised" radius="2xl" padding="none" className="p-8 transition-all flex flex-col gap-6 group">
              <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center group-hover:scale-110 transition-transform">

                {template.icon}
              </Surface>
              <div className="space-y-4 flex-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-display font-black text-text-primary">{template.title}</h2>
                  <Badge variant="default" className="text-[8px] font-black uppercase tracking-widest bg-bg-overlay border border-border-subtle text-text-muted">{template.complexity}</Badge>
                </div>
                <p className="text-lg text-text-secondary leading-relaxed font-bold">
                  {template.description}
                </p>
              </div>

              {/* Code preview area */}
              <CodeBlock language="bash">
                {'$ pd template clone ' + template.path}
              </CodeBlock>

              <div className="mt-auto pt-4">
                <motion.a
                  className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest cursor-pointer px-6 py-3 rounded-xl"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)', color: 'var(--brand-primary)' }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  View Code <ArrowRight size={16} />
                </motion.a>
              </div>
            </Surface>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
