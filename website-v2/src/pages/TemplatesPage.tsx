import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { MessageSquare, Gavel, Trash2, ArrowRight } from 'lucide-react'

const REPO = 'https://github.com/curiositech/port-daddy'

export function TemplatesPage() {
  const templates = [
    {
      title: 'Encrypted Messenger',
      description: 'Agent-to-agent DMs using the inbox dead-drop. Each agent gets a private inbox that other agents can write to.',
      icon: <MessageSquare className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />,
      complexity: 'Beginner',
      dir: 'examples/inbox',
      files: ['agent-dm.sh', 'inbox-monitor.ts'],
    },
    {
      title: 'File Edit Guard',
      description: 'Coordination protocol that uses session file claims to prevent two agents from editing the same file simultaneously.',
      icon: <Gavel className="w-6 h-6" style={{ color: 'var(--brand-secondary)' }} />,
      complexity: 'Intermediate',
      dir: 'examples/coordination',
      files: ['file-edit-guard.ts', 'agent-protocol.ts'],
    },
    {
      title: 'CI Integration',
      description: 'GitHub Actions workflow that uses Port Daddy to coordinate parallel test runners and prevent port collisions.',
      icon: <Trash2 className="w-6 h-6" style={{ color: 'var(--brand-accent)' }} />,
      complexity: 'Beginner',
      dir: 'examples/ci',
      files: ['github-actions.yml'],
    }
  ];

  return (
    <div className="min-h-screen pt-32 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-4xl mx-auto px-6 lg:px-8">
        <header className="mb-16">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl font-display font-black tracking-tighter mb-6"
            style={{ color: 'var(--text-primary)' }}
          >
            Example <span style={{ color: 'var(--brand-primary)' }}>Templates.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg max-w-2xl leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Working examples from the repo. Clone them, run them, modify them.
          </motion.p>
        </header>

        <div className="space-y-8">
          {templates.map((template, i) => (
            <motion.div
              key={template.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              viewport={{ once: true }}
            >
              <Surface depth="raised" radius="2xl" padding="lg" className="space-y-5">
                <div className="flex items-start gap-4">
                  <Surface depth="inset" radius="xl" padding="none" className="w-12 h-12 flex items-center justify-center shrink-0">
                    {template.icon}
                  </Surface>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
                        {template.title}
                      </h2>
                      <Badge variant="default" size="sm">{template.complexity}</Badge>
                    </div>
                    <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
                      {template.description}
                    </p>
                  </div>
                </div>

                <CodeBlock language="bash">{`# Clone and explore
git clone ${REPO}.git
cd port-daddy/${template.dir}
ls ${template.files.join(' ')}`}</CodeBlock>

                <a
                  href={`${REPO}/tree/main/${template.dir}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer"
                  style={{ color: 'var(--brand-primary)' }}
                >
                  View on GitHub <ArrowRight size={14} />
                </a>
              </Surface>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
