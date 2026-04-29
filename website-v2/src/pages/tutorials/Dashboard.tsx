import { CartographerGlyph, ControlPlaneGlyph, FleetGlyph, SpiderGlyph } from '@/components/PortDaddyMark'
import { ControlPlaneShowcase } from '@/components/landing/ControlPlaneShowcase'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import {
  BracketLink,
  CommandBlock,
  DocsCodeBlock,
  DocsNoteCard,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const inspectionLenses = [
  {
    label: 'Sessions',
    title: 'Who started what',
    body: 'Each run should resolve to a concrete session with an owner, a purpose, and a trail you can resume.',
  },
  {
    label: 'Notes',
    title: 'What they believed',
    body: 'Session notes are the operator-grade narrative. They expose intent, assumptions, and handoffs without forcing you to read raw logs first.',
  },
  {
    label: 'Files',
    title: 'What changed',
    body: 'Touched-file lists make the chronology actionable. They let you jump straight from an event to the code or docs that moved.',
  },
  {
    label: 'Channels',
    title: 'Why the next agent woke up',
    body: 'Channel activity ties the whole swarm together. You can see the trigger, the fan-out, and the next run without guessing.',
  },
] as const

export function Dashboard() {
  return (
    <TutorialLayout
      title="Control Plane + FleetBar"
      description="The browser control plane and FleetBar should tell the same daemon-backed story: which agents are running, what they noted, what files they touched, and which channel caused the next move."
      number={13}
      total={19}
      level="Beginner"
      readTime="7 min read"
      prev={{ title: 'Harbor Tokens (Advisory)', href: '/tutorials/harbors' }}
      next={{ title: 'Activity Log Inspection', href: '/tutorials/time-travel' }}
    >
      <section>
        <h2>1. Open the real local surface</h2>
        <p>
          Port Daddy serves its operator UI from the daemon you are actually running. The public site can
          preview the shape of those surfaces, but the real sessions, notes, channels, and file mutations
          still come from your local daemon.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] xl:grid-cols-3">
          <CommandBlock
            title="Check the daemon URL"
            label="Step 1"
            command="pd status"
            description="Confirm the daemon is up and read the URL or port it is serving locally."
          />
          <CommandBlock
            title="Open the control plane"
            label="Step 2"
            command="open <daemon-url>/fleet-ui/"
            description="Use the daemon URL from pd status and open the operator UI against that live runtime."
          />
          <CommandBlock
            title="Install FleetBar"
            label="Optional"
            command="./apps/FleetBar/install.sh"
            description="Use the native menu bar shell when you want a persistent operator view without leaving your editor."
          />
        </div>
      </section>

      <section>
        <h2>2. Two shells, one runtime</h2>
        <p>
          The browser control plane and FleetBar are not separate products. They are two views onto the
          same daemon. Use the browser when you need width, and FleetBar when you need fast situational
          awareness while coding.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] xl:grid-cols-3">
          <DocsNoteCard label="Browser" title="Wide operator canvas" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Best for flow graphs, deeper chronology, inbox triage, and project-to-project switching.
            </PanelBody>
          </DocsNoteCard>

          <DocsNoteCard label="FleetBar" title="Fast interrupt surface" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              Best for glanceable run state, recent notes, touched files, and deciding whether you need to intervene.
            </PanelBody>
          </DocsNoteCard>

          <DocsNoteCard label="Sample data" title="Preview first, trust localhost second" titleSize="nav">
            <PanelBody size="compact" className="max-w-none">
              The examples below are illustrative so you can understand the layout. Your actual swarm state still comes from the daemon on your machine.
            </PanelBody>
          </DocsNoteCard>
        </div>
      </section>

      <section>
        <h2>3. What a busy operator surface should look like</h2>
        <p>
          A healthy Port Daddy surface does not stop at “three agents active.” It shows which backend is
          running, what triggered the work, what the agent wrote down, and which file or channel to inspect next.
        </p>

        <div className="not-prose">
          <ControlPlaneShowcase variant="tutorial" />
        </div>
      </section>

      <section>
        <h2>4. What the operator needs to answer at a glance</h2>
        <p>
          If the control plane cannot answer these questions without hunting through logs, it is not done yet.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-4">
          {inspectionLenses.map((item) => (
            <DocsNoteCard key={item.label} label={item.label} title={item.title} titleSize="nav">
              <PanelBody size="compact" className="max-w-none">
                {item.body}
              </PanelBody>
            </DocsNoteCard>
          ))}
        </div>
      </section>

      <section>
        <h2>5. CLI and UI should reinforce each other</h2>
        <p>
          The screen is for scanning. The CLI is for verification, scripting, and recovery. You should be able
          to move between them without re-learning the runtime.
        </p>

        <div className="not-prose grid gap-[var(--space-4)] xl:grid-cols-[minmax(0,0.82fr)_minmax(18rem,0.58fr)]">
          <DocsCodeBlock
            code={`$ pd status
$ pd briefing
$ pd fleet status
$ open <daemon-url>/fleet-ui/

# Check the operator UI, then recover or intervene from the CLI
$ pd salvage
$ pd note "Picked up the docs follow-up from qa:findings"`}
            language="cli"
            label="Operator loop"
          />

          <SurfacePanel className="space-y-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-3)]">
              <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <ControlPlaneGlyph size={20} className="text-[var(--brand-primary)]" />
              </div>
              <div className="space-y-[var(--space-1)]">
                <PanelEyebrow>Operator loop</PanelEyebrow>
                <PanelTitle as="h3" size="nav" className="max-w-none">
                  Verify. Scan. Intervene.
                </PanelTitle>
              </div>
            </div>

            <div className="space-y-[var(--space-3)]">
              <div className="flex items-start gap-[var(--space-3)]">
                <FleetGlyph size={16} className="mt-[2px] text-[var(--brand-primary)]" />
                <PanelBody size="compact" className="max-w-none">
                  Roster view tells you which backend is running and whether the next pass is active, queued, or watching.
                </PanelBody>
              </div>
              <div className="flex items-start gap-[var(--space-3)]">
                <CartographerGlyph size={16} className="mt-[2px] text-[var(--brand-primary)]" />
                <PanelBody size="compact" className="max-w-none">
                  Chronology view ties session notes to concrete file mutations instead of leaving you in log archaeology.
                </PanelBody>
              </div>
              <div className="flex items-start gap-[var(--space-3)]">
                <SpiderGlyph size={16} className="mt-[2px] text-[var(--brand-primary)]" />
                <PanelBody size="compact" className="max-w-none">
                  Channel activity reveals why the next agent woke up and whether the swarm is behaving as intended.
                </PanelBody>
              </div>
            </div>
          </SurfacePanel>
        </div>
      </section>

      <section>
        <h2>What&apos;s next</h2>
        <p>
          Once you can see the operator story clearly, the next skill is reading it backward. The activity log
          lesson goes deeper into reconstructing what happened and why.
        </p>

        <div className="not-prose flex flex-wrap gap-[var(--space-3)]">
          <BracketLink to="/tutorials/time-travel">Activity Log Inspection</BracketLink>
          <BracketLink to="/tutorials/fleet">Fleet Agents</BracketLink>
          <BracketLink to="/docs/get-started">Get started docs</BracketLink>
        </div>
      </section>
    </TutorialLayout>
  )
}
