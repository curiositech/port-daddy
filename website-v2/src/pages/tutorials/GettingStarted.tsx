import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import {
  BracketLink,
  CommandBlock,
  DocsCodeBlock,
  DocsNoteCard,
  PanelBody,
} from '@/components/site/primitives'

export function GettingStarted() {
  return (
    <TutorialLayout
      title="Getting Started"
      description="Install Port Daddy, start the daemon, and see how two AI agents coordinate on the same project without stepping on each other."
      number={1}
      total={19}
      level="Beginner"
      readTime="10 min read"
      next={{ title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent' }}
    >
      <section>
        <h2>What is Port Daddy?</h2>
        <p>
          You built one agent and it worked. Then you built a second one and the coordination debt
          showed up immediately: port collisions, broken DNS assumptions, and shell conventions that
          no longer scale.
        </p>
        <p>
          <strong>Port Daddy solves the second-agent problem.</strong> It runs as a local daemon and
          provides the shared coordination primitives your agents need: deterministic port assignment,
          file claims, pub/sub messaging, session notes, and salvage when an agent dies mid-task.
        </p>
        <p>
          Port Daddy is not the orchestration framework itself. It is the local control plane that
          sits underneath whatever agent framework or runtime you already use.
        </p>
      </section>

      <section>
        <h2>1. Install</h2>

        <div className="not-prose grid gap-[var(--space-4)] md:grid-cols-2">
          <CommandBlock
            title="npm"
            label="Recommended"
            command="npm install -g port-daddy"
            tone="paper"
            description="Use the package manager path when you want the fastest local install."
          />

          <CommandBlock
            title="from source"
            label="Source"
            command={`git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
npm install
npm link`}
            tone="paper"
            description="Use the source path when you need to hack on the daemon or CLI directly."
          />
        </div>

        <div className="not-prose mt-[var(--space-4)]">
          <DocsNoteCard label="Verification" title="Start the daemon" titleSize="nav">
            <DocsCodeBlock code="pd start" language="cli" label="Start daemon" />
            <PanelBody size="compact" className="max-w-none">
              The daemon now listens on <code>localhost:9876</code> and becomes the local control
              authority for your agents.
            </PanelBody>
          </DocsNoteCard>
        </div>
      </section>

      <div className="grid gap-[var(--space-6)] xl:grid-cols-2 xl:items-start">
        <section>
          <h2>2. Claim Your Identity</h2>
          <p>
            Stop thinking in raw port numbers. Name services as <code>project:stack:context</code> and
            let the daemon assign the same port every time.
          </p>

          <div className="not-prose">
            <DocsCodeBlock
              code={`$ pd claim myapp:api:main
  Port 3100 assigned to myapp:api:main

$ pd claim myapp:frontend:main
  Port 3101 assigned to myapp:frontend:main

$ pd find 'myapp:*'
  myapp:api:main       → localhost:3100
  myapp:frontend:main  → localhost:3101`}
              language="cli"
              label="Semantic identity"
            />
          </div>

          <p>
            The segments let you query by project, stack, or context. <code>pd find &apos;myapp:*&apos;</code>
            returns everything in the project. <code>pd find &apos;*:api:*&apos;</code> returns every
            API across projects.
          </p>
        </section>

        <section>
          <h2>3. Start a Session</h2>
          <p>
            Sessions track what each agent is doing. They preserve notes, claims, and timestamps so
            another agent can recover the work if the first one crashes.
          </p>

          <div className="not-prose">
            <DocsCodeBlock
              code={`$ pd begin --identity myapp:api --purpose "Building auth endpoints"
  Session started: session-a1b2c3d4
  Agent registered with heartbeat

$ pd note "Implementing JWT validation for /login"
  Note added to session

$ pd done
  Session completed. Notes preserved.`}
              language="cli"
              label="Session lifecycle"
            />
          </div>

          <p>
            If an agent dies instead of calling <code>pd done</code>, the session moves into salvage.
            Another agent can continue the same thread with <code>pd salvage claim</code>.
          </p>
        </section>
      </div>

      <section>
        <h2>What&apos;s Next</h2>
        <p>
          Keep moving through the coordination model instead of treating this lesson as a one-off
          install checklist.
        </p>

        <div className="not-prose flex flex-wrap gap-[var(--space-3)]">
          <BracketLink to="/tutorials/dns">DNS Resolver</BracketLink>
          <BracketLink to="/tutorials/multi-agent">Multi-Agent Orchestration</BracketLink>
          <BracketLink to="/tutorials/fleet">Fleet Agents</BracketLink>
        </div>
      </section>
    </TutorialLayout>
  )
}
