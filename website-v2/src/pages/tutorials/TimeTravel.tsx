import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { History, Activity, Search } from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Activity Log Inspection"
      description="When multiple agents work on the same project, the hardest question is 'what happened first?' Learn to use Port Daddy's immutable activity log to reconstruct the sequence of events."
      number={14}
      total={21}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: "Budgeted One-Shot Agents", href: "/tutorials/pd-spawn" }}
      next={{ title: "Reactive Pipelines", href: "/tutorials/pipelines" }}
    >
      <div className="space-y-12">
        {/* Concept Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <History className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Why Event Ordering Matters</h2>
          </div>
          <p>
            In a multi-agent system, events from different agents are
            interleaved. Agent A claims a file at 12:04:01, Agent B publishes a
            message at 12:04:03, then Agent A writes a note at 12:04:05. Bugs
            hide in the ordering of these events, not in any single event.
          </p>
          <p>
            Port Daddy records every inter-agent event into an append-only
            SQLite database. Port claims, file claims, pub/sub messages, session
            notes, lock acquisitions, and heartbeats all go into the same
            timeline.
          </p>
        </section>

        {/* Step 1: Querying */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Search className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Query the Activity Log</h2>
          </div>

          <p>
            The <code>pd log</code> command shows recent activity. You can also
            query the REST API directly for more control.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`PD_URL="\${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://127.0.0.1:#')}"

# View recent activity via CLI
$ pd log

# Query the REST API with a limit
$ curl "$PD_URL/activity?limit=20"

# Get a summary grouped by type
$ curl "$PD_URL/activity/summary"

# Get activity statistics
$ curl "$PD_URL/activity/stats"
# Expected result: each request returns recent activity rows, grouped summaries, or JSON stats from the daemon.`}
          </CodeBlock>

          <div className="space-y-2 overflow-hidden bg-[var(--code-bg)] p-5 font-mono text-[length:var(--type-meta-size)] text-[var(--code-text)]">
            <div className="flex items-center gap-4">
              <span className="w-20">12:04:01</span>
              <span className="text-[var(--brand-secondary)]">[infra]</span>
              <span>Agent 'planner' claimed port 3102</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="w-20">12:04:05</span>
              <span className="text-[var(--brand-accent)]">[radio]</span>
              <span className="font-bold">
                swarm:task:new {"->"} {"{id: 42}"}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="w-20">12:04:12</span>
              <span className="text-[var(--brand-secondary)]">[note]</span>
              <span>'planner': Started decomposition</span>
            </div>
          </div>
        </section>

        {/* Step 2: Diagnosing */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Activity className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Diagnose Common Problems</h2>
          </div>

          <p>
            The activity log is most useful for diagnosing race conditions
            between agents, finding lost work after crashes, and understanding
            why a service stopped responding.
          </p>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            <strong>Post-mortem integrity:</strong> the log is append-only, so an
            agent cannot delete an event to hide a mistake. What happened stays
            on the record for later inspection.
          </p>
        </section>

        {/* Design Principle Callout */}
        <Surface
          depth="raised"
          radius="none"
          className="p-6 text-center space-y-4 relative overflow-hidden"
        >
          <p
            className="text-[length:var(--type-panel-title-nav-size)] font-bold m-0"
            style={{ color: "var(--text-primary)" }}
          >
            An append-only log
          </p>
          <p className="max-w-xl mx-auto text-[var(--text-secondary)] m-0">
            Because events are never rewritten, the timeline is a durable record
            of what each agent did and when. You can replay a sequence to see how
            two agents collided, and use that record to tune how they coordinate.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
