import { ArrowRight } from 'lucide-react'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import {
  BracketLink,
  DocsCodeBlock,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const fleetModes = [
  {
    label: 'Reactive',
    title: 'Trigger on events',
    description: 'Agents wake up when messages arrive on named pub/sub channels.',
  },
  {
    label: 'Scheduled',
    title: 'Run on a timer',
    description: 'Cron-style intervals handle steady background work without extra scripting.',
  },
  {
    label: 'Chained',
    title: 'Agents talk to agents',
    description: 'One agent can publish a result that becomes another agent’s starting gun.',
  },
] as const

const guardrails = [
  {
    label: 'DAG validation',
    text: 'The trigger graph is checked for cycles before any agent starts, so bad chains fail at config time.',
  },
  {
    label: 'Singletons',
    text: '`singleton: true` prevents duplicate runs when the same trigger lands again mid-flight.',
  },
  {
    label: 'Scoped tools',
    text: '`allowedTools` limits what each agent can do so read-only jobs cannot silently mutate the repo.',
  },
  {
    label: 'Immutable notes',
    text: 'Session notes survive crashes and misbehavior, giving operators an audit trail instead of vibes.',
  },
] as const

export function Fleet() {
  return (
    <TutorialLayout
      title="Fleet: Agents That Run While You Sleep"
      description="Declare your background agent fleet in YAML. Wire it to git commits. Watch QA, docs, and idea engines run automatically on every push."
      number={18}
      total={19}
      level="Intermediate"
      readTime="12 min read"
      prev={{ title: 'Multiplayer Localhost', href: '/tutorials/remote-harbors' }}
      next={{ title: 'Pheromone Trails', href: '/tutorials/pheromone' }}
    >
      <section>
        <h2>Why a Fleet?</h2>
        <p>
          You commit code. Then you wait. Someone has to review it, update the docs, check test
          coverage, and keep the roadmap honest. A fleet moves that work from human memory into a
          daemon-backed system.
        </p>
        <p>
          A <strong>fleet</strong> is a set of background AI agents declared in a YAML file. Each
          agent has a job, a trigger, and a communication channel. When something happens, the right
          agents wake up and do their work.
        </p>
        <p>No cron scripts. No CI glue. One local manifest, one control plane, and visible runs.</p>

        <div className="not-prose grid gap-[var(--space-4)] lg:grid-cols-3">
          {fleetModes.map((mode) => (
            <DocsNoteCard key={mode.label} label={mode.label} title={mode.title} titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                {mode.description}
              </PanelBody>
            </DocsNoteCard>
          ))}
        </div>
      </section>

      <section>
        <h2>1. Write Your Fleet YAML</h2>
        <p>
          Create <code>pd-fleet.yml</code> at your project root. This manifest declares the agents,
          how they wake up, and where their outputs flow next.
        </p>

        <div className="not-prose">
          <DocsCodeBlock
            code={`fleet:
  name: my-project
  harbor: "{project}:fleet"

  agents:
    qa:
      trigger: git:committed
      backend: ollama
      model: qwen2.5-coder:7b
      prompt: |
        Review the most recent commit. Read every changed file.
        If you find bugs, write a test that exposes each one.
        If clean, say CLEAN.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    docs:
      trigger: git:committed
      backend: codex
      model: gpt-5.4-mini
      prompt: |
        Check if docs match the code. Update anything stale.
      identity: "{project}:fleet:docs"

    gardener:
      schedule: "*/10 * * * *"
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status
      identity: "{project}:fleet:gardener"

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa, docs]

    qa:clean:
      description: "QA found no issues"

    qa:findings:
      description: "QA found bugs"`}
            language="text"
            label="pd-fleet.yml"
          />
        </div>

        <p>Three things to notice:</p>
        <ul>
          <li>
            <strong>Triggers</strong> are pub/sub channel names. When a message appears on{' '}
            <code>git:committed</code>, both <code>qa</code> and <code>docs</code> fire.
          </li>
          <li>
            <strong>Schedules</strong> are cron expressions. The gardener runs every 10 minutes even
            if nobody commits.
          </li>
          <li>
            <strong>Channels</strong> define the communication topology. Agents publish results and
            other agents consume them.
          </li>
        </ul>

        <div className="not-prose mt-[var(--space-4)]">
          <DocsNoteCard label="Template variables" title="Scoped at fleet startup" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              <code>{'{project}'}</code> resolves to your directory name. <code>{'{branch}'}</code>{' '}
              becomes the current git branch, and <code>{'{sha}'}</code> the current commit hash.
              Those values bind when the fleet starts so every agent gets a stable identity scoped to
              this project.
            </PanelBody>
          </DocsNoteCard>
        </div>
      </section>

      <section>
        <h2>2. Wire Git to the Fleet</h2>
        <p>
          The fleet triggers on <code>git:committed</code>, so you need one local hook that
          publishes commit metadata after every successful commit.
        </p>

        <div className="not-prose">
          <DocsCodeBlock
            code={`#!/usr/bin/env zsh
# Fire-and-forget: publish commit info to Port Daddy
PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"

SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=%s)
AUTHOR=$(git log -1 --pretty=%an)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | head -20 | tr '\\n' ', ')

curl -s -X POST "\${PD_URL}/msg/git:committed" \\
  -H 'Content-Type: application/json' \\
  -d "{\\"payload\\": {\\"sha\\": \\"\${SHA}\\", \\"message\\": \\"\${MSG}\\"}}" \\
  --connect-timeout 2 --max-time 3 \\
  >/dev/null 2>&1 &

exit 0`}
            language="text"
            label="post-commit hook"
          />
        </div>

        <p>
          Save that to <code>.git/hooks/post-commit</code> and make it executable. The publish call
          runs in the background, so your commit stays fast while the fleet wakes up behind the
          scenes.
        </p>

        <div className="not-prose mt-[var(--space-4)]">
          <DocsNoteCard label="Flow" title="What happens next?" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              You commit. The hook publishes to <code>git:committed</code>. Port Daddy fans that
              message out to every matching agent. Each agent runs, records its session notes, and
              publishes whatever comes next.
            </PanelBody>
          </DocsNoteCard>
        </div>
      </section>

      <section>
        <h2>3. Triggers vs. Schedules</h2>
        <p>
          A useful fleet mixes reactive agents and periodic agents. One responds to events; the
          other keeps the system warm when the repo is quiet.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] xl:grid-cols-2">
          <DocsNoteCard label="Triggered" title="Triggered agents" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Fire when a message arrives on their channel. Use them for code review, docs updates,
              test coverage, and other event-driven work.
            </PanelBody>
            <DocsCodeBlock
              code={`qa:
  trigger: git:committed
  backend: ollama
  model: qwen2.5-coder:7b`}
              language="text"
              label="triggered agent"
            />
          </DocsNoteCard>

          <DocsNoteCard label="Scheduled" title="Scheduled agents" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Run on a cron interval. Use them for health checks, cleanup, indexing, and idea
              generation that should keep happening even when nobody commits.
            </PanelBody>
            <DocsCodeBlock
              code={`gardener:
  schedule: "*/10 * * * *"
  backend: custom`}
              language="text"
              label="scheduled agent"
            />
          </DocsNoteCard>
        </div>

        <p>
          An agent can have both. Spark can wake up every 30 minutes and Spider can still trigger
          whenever Spark publishes a new idea.
        </p>
      </section>

      <section>
        <h2>4. Agents That Talk to Each Other</h2>
        <p>The real leverage shows up when one agent’s output becomes another agent’s trigger.</p>

        <div className="not-prose grid gap-[var(--space-4)] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-stretch">
          <DocsNoteCard label="Spark" title="Proposes an idea" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Runs on a timer and publishes an idea to <code>spark:idea</code>.
            </PanelBody>
          </DocsNoteCard>

          <div className="hidden items-center justify-center xl:flex">
            <ArrowRight className="h-[var(--space-5)] w-[var(--space-5)] text-[var(--text-secondary)]" />
          </div>

          <DocsNoteCard label="Spider" title="Finds the connections" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Triggers on <code>spark:idea</code>, reads the repo, and publishes its findings to{' '}
              <code>spider:connections</code>.
            </PanelBody>
          </DocsNoteCard>

          <div className="hidden items-center justify-center xl:flex">
            <ArrowRight className="h-[var(--space-5)] w-[var(--space-5)] text-[var(--text-secondary)]" />
          </div>

          <DocsNoteCard label="Spark" title="Reads the artifact on the next pass" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Spark does not trigger on Spider directly. It reads Spider’s files on its next run,
              which avoids accidental infinite loops.
            </PanelBody>
          </DocsNoteCard>
        </div>

        <p>
          That asymmetry matters. Spider <em>triggers</em> on Spark’s channel, but Spark only{' '}
          <em>reads</em> Spider’s output files. Port Daddy validates the trigger graph as a DAG
          before the fleet starts.
        </p>
      </section>

      <section>
        <h2>5. See What They Did</h2>
        <p>
          Fleet runs are only useful if you can inspect them. The daemon gives you both shell status
          and a browser control plane against the same live runtime.
        </p>

        <div className="not-prose">
          <DocsCodeBlock
            code={`pd fleet up
pd fleet status
pd fleet down`}
            language="cli"
            label="fleet commands"
          />
        </div>

        <p>
          Open the Fleet Control Center or the daemon-served control plane at <code>/fleet-ui/</code>{' '}
          to inspect Flow, Activity, Channels, Inbox, and Sorties in one shell instead of hopping
          between one-off tools.
        </p>

        <div className="not-prose mt-[var(--space-4)]">
          <DocsNoteCard label="FleetBar" title="Native menu bar shell" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Build the macOS menu bar app from <code>apps/FleetBar</code>. It opens the same
              daemon-backed control plane without introducing a second truth source.
            </PanelBody>
          </DocsNoteCard>
        </div>
      </section>

      <section>
        <h2>6. Guardrails</h2>
        <p>
          Background agents need operator-grade boundaries. The fleet model bakes those checks into
          startup and execution instead of trusting every prompt.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] md:grid-cols-2">
          {guardrails.map((item) => (
            <DocsNoteCard key={item.label} label={item.label} title={item.label} titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                {item.text}
              </PanelBody>
            </DocsNoteCard>
          ))}
        </div>
      </section>

      <section>
        <h2>Quick Start</h2>
        <p>If you want the shortest path from zero to a working fleet, do this in order:</p>

        <div className="not-prose">
          <SurfacePanel className="space-y-[var(--space-4)]">
            <PanelTitle as="h3" size="nav" className="max-w-none">
              Fleet launch checklist
            </PanelTitle>
            <ol className="ml-[var(--space-4)] space-y-[var(--space-3)] font-sans text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
              <li>Create <code>pd-fleet.yml</code> at your project root.</li>
              <li>Add a post-commit hook that publishes to <code>git:committed</code>.</li>
              <li>Run <code>pd fleet up</code>.</li>
              <li>Commit something and watch the agents fire.</li>
              <li>Open the Fleet Control Center or <code>/fleet-ui/</code> to inspect the run.</li>
            </ol>
          </SurfacePanel>
        </div>
      </section>

      <section>
        <h2>What&apos;s Next</h2>
        <p>Fleet makes the background system legible. The next lesson explains the ambient signals that let fleets coordinate without constant direct messaging.</p>

        <div className="not-prose flex flex-wrap gap-[var(--space-3)]">
          <BracketLink to="/tutorials/pheromone">Pheromone Trails</BracketLink>
          <BracketLink to="/tutorials/session-phases">Session Phases</BracketLink>
          <BracketLink to="/tutorials/remote-harbors">Multiplayer Localhost</BracketLink>
        </div>
      </section>
    </TutorialLayout>
  )
}
