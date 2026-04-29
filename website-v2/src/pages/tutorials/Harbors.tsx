import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Shield, Lock, Key, Zap, AlertTriangle, Users } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Harbors() {
  return (
    <TutorialLayout
      title="Cryptographic Harbors"
      description="Your agents should not have unlimited access to everything. Learn to define permission boundaries and issue signed capability tokens that expire automatically."
      number={12}
      total={19}
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'pd spawn: One-Shot Agents', href: '/tutorials/pd-spawn' }}
      next={{ title: 'Control Plane + FleetBar', href: '/tutorials/dashboard' }}
    >
      <div className="space-y-12">
        {/* Why Harbors Exist */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Shield className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">Why Harbors Exist</h2>
          </div>
          <p>
            When you run an AI coding agent, you typically give it full access to your project directory and all its environment variables. That is fine for a single trusted agent, but it becomes a real problem when you are running three or four agents simultaneously on the same codebase.
          </p>
          <p>
            Consider this scenario: you spawn a security review agent that should only <strong>read</strong> source code and write notes about what it finds. Without harbors, that agent has the same permissions as every other agent -- it can modify files, acquire locks, create tunnels, and publish to any pub/sub channel. If the agent misbehaves (or if its prompt is poorly constructed), it can accidentally overwrite files or interfere with other agents' work.
          </p>
          <p>
            <strong>Harbors</strong> solve this by letting you define exactly what each agent is allowed to do. A harbor is a named permission namespace -- think of it as a scoped role that you assign to a group of agents. Each harbor has a list of capabilities (like <code>code:read</code>, <code>notes:write</code>, <code>file:claim</code>), and agents inside the harbor receive a signed token that proves their permissions. The daemon verifies this token on every request.
          </p>
          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong>Soundness by Design:</strong> In Port Daddy v3.7, every harbor operation is verified against a mathematical state machine. If an agent tries to claim a port it doesn't own, the daemon rejects the request instantly.
            </p>
          </Surface>
        </section>

        {/* Step 1: Creation */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Lock className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">1. Create a Harbor</h2>
          </div>

          <p>
            Start by defining the boundary. We will create a harbor called <code>security-review</code> with read-only code access and the ability to write session notes. Nothing else -- no file modifications, no lock acquisition, no tunnel creation.
          </p>

          <CodeBlock language="bash">
            {`$ pd harbor create my-swarm:security-review \\
    --cap "code:read,notes:write" \\
    --ttl 2h`}
          </CodeBlock>

          <p>
            The <code>--ttl 2h</code> flag is important. It means tokens issued for this harbor expire after two hours. When the token expires, the agent loses all access automatically. You do not need to remember to revoke anything. This is especially useful for short-lived review tasks where you want permissions to self-destruct.
          </p>

          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-[var(--surface-sunken)]">
              <Badge variant="teal">Capability: code:read</Badge>
              <p className="text-sm m-0 mt-2 leading-relaxed text-[var(--text-secondary)]">
                Allows the agent to read source files and view session notes within the harbor. The agent can use <code>pd session files claim</code> to access files, but only in read mode.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--surface-sunken)]">
              <Badge variant="gold">Capability: notes:write</Badge>
              <p className="text-sm m-0 mt-2 leading-relaxed text-[var(--text-secondary)]">
                Allows the agent to post status updates and findings to the session timeline. Other agents (including those outside this harbor) can read these notes to see the review results.
              </p>
            </div>
          </div>
        </section>

        {/* Step 2: Entrance */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Key className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Enter the Harbor</h2>
          </div>

          <p>
            When an agent enters a harbor, the daemon issues a unique <strong>Harbor Card</strong>--an HMAC-signed JWT that proves the agent's identity and permissions.
          </p>

          <CodeBlock language="bash">
            {`$ pd harbor enter my-swarm:security-review

Harbor: my-swarm:security-review
Token:  eyJhbGciOiJIUzI1NiJ9...
Caps:   code:read, notes:write
Expires: 2h from now`}
          </CodeBlock>

          <p>
            You can pass this token to a spawned agent so it inherits the harbor's permissions automatically:
          </p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend claude --model claude-haiku-4-5 \\
    --harbor my-swarm:security-review \\
    -- "Review src/auth/ for vulnerabilities"`}
          </CodeBlock>

          <p>
            The spawned agent receives the Harbor Card as an environment variable and includes it in every request to the daemon. If it tries to do something its capabilities do not allow -- like acquiring a lock or creating a tunnel -- the daemon rejects the request with a clear error explaining which capability is missing.
          </p>
        </section>

        {/* Step 3: What Happens When It Expires */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center border border-[var(--brand-accent)]">
              <AlertTriangle className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">3. Token Expiration and Revocation</h2>
          </div>

          <p>
            When a token expires, the agent can no longer make any requests to the daemon. This is intentional -- it forces you to think about how long an agent actually needs access. A security review that should take 30 minutes does not need a 24-hour token.
          </p>

          <p>
            You can also revoke a token early by leaving the harbor:
          </p>

          <CodeBlock language="bash">
            {`$ pd harbor leave my-swarm:security-review

Left harbor: my-swarm:security-review
Token JTI burned — cannot be reused.`}
          </CodeBlock>

          <p>
            The "JTI burned" message means Port Daddy records the token's unique identifier in a revocation list. Even if someone copies the raw JWT string, it will be rejected because the daemon checks the JTI against the revocation list on every request.
          </p>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong>Common Pitfall: Forgetting to Set a TTL.</strong> If you create a harbor without <code>--ttl</code>, tokens default to 2 hours. For production workflows, always set an explicit TTL that matches the expected duration of the task. A CI pipeline that runs in 10 minutes should use <code>--ttl 15m</code>, not the default.
            </p>
          </Surface>
        </section>

        {/* When to Use Harbors */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Users className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">When to Use Harbors</h2>
          </div>

          <p>
            Harbors add a layer of ceremony, so they are not necessary for every workflow. Here are the cases where they provide real value:
          </p>

          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">Security-sensitive reviews</p>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                When you want an agent to analyze code without being able to modify it. Use <code>code:read</code> + <code>notes:write</code> and nothing else.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">Untrusted or experimental agents</p>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                When you are testing a new agent framework or prompt and do not fully trust its behavior yet. Harbors limit the blast radius if something goes wrong.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">Multi-team projects</p>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                When different teams have different agents working on the same monorepo and you want to ensure the frontend team's agents cannot touch the backend's database migration files.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">CI/CD pipelines</p>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                When you spawn agents as part of an automated pipeline and want each step to have only the permissions it needs. A test-runner agent does not need <code>tunnel:create</code>.
              </p>
            </div>
          </div>

          <p>
            If you are the only developer and you trust all your agents, you can skip harbors entirely. They are opt-in, and Port Daddy works fine without them. But the moment you add a third party -- a teammate's agent, a CI-spawned process, or an experimental LLM -- harbors become essential.
          </p>
        </section>

        {/* The Formal Verification Note */}
        <Surface depth="raised" radius="xl" className="p-6 space-y-4">
           <div className="flex items-center gap-3">
             <Zap size={18} className="text-[var(--brand-primary)]" />
             <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Implementation Detail</p>
           </div>
           <p className="m-0 text-[var(--text-secondary)]">
             Harbor Cards are standard JWTs signed with HMAC-SHA256 using a per-daemon secret key. The daemon generates this key on first run and stores it in the SQLite database. Tokens cannot be forged without access to the daemon's database file, and each token's JTI (unique identifier) is tracked so it can be revoked independently.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
