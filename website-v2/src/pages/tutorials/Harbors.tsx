import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
<<<<<<< HEAD
import { Shield, Lock, Key, Zap, ShieldCheck, AlertTriangle, Users } from 'lucide-react'
=======
import { Shield, Lock, Key, Zap, ShieldCheck, AlertTriangle } from 'lucide-react'
>>>>>>> worktree-agent-ae9460d3

export function Harbors() {
  return (
    <TutorialLayout
<<<<<<< HEAD
      title="Cryptographic Harbors"
      description="Your agents should not have unlimited access to everything. Learn to define permission boundaries and issue signed capability tokens that expire automatically."
      number={3}
      total={16}
=======
      title="Harbors (Advisory)"
      description="Define permission namespaces for agent teams. Harbors record intent and enable discovery, but enforcement is advisory in the current version."
      number="03"
      total="14"
>>>>>>> worktree-agent-ae9460d3
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Multi-Agent Flow', href: '/tutorials/multi-agent' }}
      next={{ title: 'Agent Spawning', href: '/tutorials/always-on' }}
    >
      <motion.div className="space-y-16">
<<<<<<< HEAD
        {/* Why Harbors Exist */}
=======
        {/* Advisory Notice */}
        <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-amber-500)]">
           <motion.div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={24} className="text-[var(--p-amber-400)]" />
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-xl font-display">Advisory Enforcement</motion.p>
           </motion.div>
           <motion.p className="m-0 text-base">
             Harbor enforcement is advisory in the current version. Harbors record intent and enable discovery, but the daemon does not block operations based on harbor capabilities. Agents can still make any API call regardless of their harbor assignment. Full enforcement is planned for a future release.
           </motion.p>
        </blockquote>

        {/* Concept Section */}
>>>>>>> worktree-agent-ae9460d3
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Shield className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Why Harbors Exist</motion.h2>
          </motion.div>
          <motion.p>
<<<<<<< HEAD
            When you run an AI coding agent, you typically give it full access to your project directory and all its environment variables. That is fine for a single trusted agent, but it becomes a real problem when you are running three or four agents simultaneously on the same codebase.
          </motion.p>
          <motion.p>
            Consider this scenario: you spawn a security review agent that should only <strong>read</strong> source code and write notes about what it finds. Without harbors, that agent has the same permissions as every other agent -- it can modify files, acquire locks, create tunnels, and publish to any pub/sub channel. If the agent misbehaves (or if its prompt is poorly constructed), it can accidentally overwrite files or interfere with other agents' work.
          </motion.p>
          <motion.p>
            <strong>Harbors</strong> solve this by letting you define exactly what each agent is allowed to do. A harbor is a named permission namespace -- think of it as a scoped role that you assign to a group of agents. Each harbor has a list of capabilities (like <code>code:read</code>, <code>notes:write</code>, <code>file:claim</code>), and agents inside the harbor receive a signed token that proves their permissions. The daemon verifies this token on every request.
=======
            When you run multiple AI agents on the same project, you need a way to express which agents should have access to what. Harbors are named permission namespaces that let you declare capabilities for groups of agents.
          </motion.p>
          <motion.p>
            In the current version, harbors record this intent -- they issue HMAC-signed tokens and track which agents belong to which namespace. This enables discovery ("who else is working in this harbor?") and audit trails. Capability enforcement at the daemon level is planned but not yet implemented.
>>>>>>> worktree-agent-ae9460d3
          </motion.p>
        </section>

        {/* Step 1: Creation */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <Lock className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Create a Harbor</motion.h2>
          </motion.div>

          <motion.p>
<<<<<<< HEAD
            Start by defining the boundary. We will create a harbor called <code>security-review</code> with read-only code access and the ability to write session notes. Nothing else -- no file modifications, no lock acquisition, no tunnel creation.
=======
            Create a harbor named <code>security-review</code> with specific capabilities and a TTL. The capabilities are recorded for documentation and future enforcement.
>>>>>>> worktree-agent-ae9460d3
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor create my-swarm:security-review \\
    --cap "code:read,notes:write" \\
    --ttl 2h`}
          </CodeBlock>

          <motion.p>
            The <code>--ttl 2h</code> flag is important. It means tokens issued for this harbor expire after two hours. When the token expires, the agent loses all access automatically. You do not need to remember to revoke anything. This is especially useful for short-lived review tasks where you want permissions to self-destruct.
          </motion.p>

          <motion.div className="grid sm:grid-cols-2 gap-6">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="teal">Capability: code:read</Badge>
<<<<<<< HEAD
                <motion.p className="text-sm m-0 leading-relaxed text-[var(--text-secondary)]">
                  Allows the agent to read source files and view session notes within the harbor. The agent can use <code>pd session files claim</code> to access files, but only in read mode.
                </motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="amber">Capability: notes:write</Badge>
                <motion.p className="text-sm m-0 leading-relaxed text-[var(--text-secondary)]">
                  Allows the agent to post status updates and findings to the session timeline. Other agents (including those outside this harbor) can read these notes to see the review results.
                </motion.p>
=======
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Declares that agents in this harbor intend to read source files. Currently advisory.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="amber">Capability: notes:write</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Declares that agents in this harbor intend to write session notes. Currently advisory.</motion.p>
>>>>>>> worktree-agent-ae9460d3
             </motion.div>
          </motion.div>
        </section>

        {/* Step 2: Entrance */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Key className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Enter the Harbor</motion.h2>
          </motion.div>

          <motion.p>
<<<<<<< HEAD
            When an agent enters a harbor, Port Daddy issues a <strong>Harbor Card</strong> -- an HMAC-signed JWT that encodes the agent's identity, its capabilities, and the expiration time. The agent includes this token in subsequent API requests, and the daemon verifies it before allowing the operation.
=======
            When an agent enters a harbor, Port Daddy issues a Harbor Card -- an HMAC-signed JWT that encodes the agent's identity, its declared capabilities, and the expiration time.
>>>>>>> worktree-agent-ae9460d3
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor enter my-swarm:security-review

Harbor: my-swarm:security-review
Token:  eyJhbGciOiJIUzI1NiJ9...
Caps:   code:read, notes:write
Expires: 2h from now`}
          </CodeBlock>

<<<<<<< HEAD
          <motion.p>
            You can pass this token to a spawned agent so it inherits the harbor's permissions automatically:
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend claude --model claude-haiku-4-5 \\
    --harbor my-swarm:security-review \\
    -- "Review src/auth/ for vulnerabilities"`}
          </CodeBlock>

          <motion.p>
            The spawned agent receives the Harbor Card as an environment variable and includes it in every request to the daemon. If it tries to do something its capabilities do not allow -- like acquiring a lock or creating a tunnel -- the daemon rejects the request with a clear error explaining which capability is missing.
          </motion.p>
        </section>

        {/* Step 3: What Happens When It Expires */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <AlertTriangle className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">3. Token Expiration and Revocation</motion.h2>
          </motion.div>

          <motion.p>
            When a token expires, the agent can no longer make any requests to the daemon. This is intentional -- it forces you to think about how long an agent actually needs access. A security review that should take 30 minutes does not need a 24-hour token.
          </motion.p>

          <motion.p>
            You can also revoke a token early by leaving the harbor:
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor leave my-swarm:security-review

Left harbor: my-swarm:security-review
Token JTI burned — cannot be reused.`}
          </CodeBlock>

          <motion.p>
            The "JTI burned" message means Port Daddy records the token's unique identifier in a revocation list. Even if someone copies the raw JWT string, it will be rejected because the daemon checks the JTI against the revocation list on every request.
          </motion.p>

          <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-amber-500)]">
             <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-4 text-xl font-display">Common Pitfall: Forgetting to Set a TTL</motion.p>
             <motion.p className="m-0 text-base">
               If you create a harbor without <code>--ttl</code>, tokens default to 2 hours. For production workflows, always set an explicit TTL that matches the expected duration of the task. A CI pipeline that runs in 10 minutes should use <code>--ttl 15m</code>, not the default.
             </motion.p>
          </blockquote>
        </section>

        {/* When to Use Harbors */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Users className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">When to Use Harbors</motion.h2>
          </motion.div>

          <motion.p>
            Harbors add a layer of ceremony, so they are not necessary for every workflow. Here are the cases where they provide real value:
          </motion.p>

          <motion.div className="space-y-4">
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Security-sensitive reviews</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                When you want an agent to analyze code without being able to modify it. Use <code>code:read</code> + <code>notes:write</code> and nothing else.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Untrusted or experimental agents</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                When you are testing a new agent framework or prompt and do not fully trust its behavior yet. Harbors limit the blast radius if something goes wrong.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Multi-team projects</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                When different teams have different agents working on the same monorepo and you want to ensure the frontend team's agents cannot touch the backend's database migration files.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">CI/CD pipelines</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                When you spawn agents as part of an automated pipeline and want each step to have only the permissions it needs. A test-runner agent does not need <code>tunnel:create</code>.
              </motion.p>
            </motion.div>
          </motion.div>

          <motion.p>
            If you are the only developer and you trust all your agents, you can skip harbors entirely. They are opt-in, and Port Daddy works fine without them. But the moment you add a third party -- a teammate's agent, a CI-spawned process, or an experimental LLM -- harbors become essential.
          </motion.p>
        </section>

        {/* The Formal Verification Note */}
=======
          <motion.p className="opacity-60 italic text-sm">
            Tokens expire automatically after the TTL. You can also revoke early with <code>pd harbor leave</code>.
          </motion.p>
        </section>

        {/* Implementation Detail */}
>>>>>>> worktree-agent-ae9460d3
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <ShieldCheck size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Implementation Detail</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>HMAC-SHA256 Signing</motion.h3>
<<<<<<< HEAD
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             Harbor Cards are standard JWTs signed with HMAC-SHA256 using a per-daemon secret key. The daemon generates this key on first run and stores it in the SQLite database. Tokens cannot be forged without access to the daemon's database file, and each token's JTI (unique identifier) is tracked so it can be revoked independently.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Verified Handshake Protocol
=======
           <motion.p className="text-xl max-w-xl opacity-70">
             Harbor Cards are standard JWTs signed with HMAC-SHA256 using a per-daemon secret key. The daemon generates this key on first run and stores it in the SQLite database. Each token's JTI (unique identifier) is tracked for revocation.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Advisory Mode -- Enforcement Planned
>>>>>>> worktree-agent-ae9460d3
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
