import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'

export function Inbox() {
  return (
    <TutorialLayout
      title="The Agent Inbox"
      description="Use Port Daddy channels for shared signals and registered-agent inboxes for direct messages. Publish, subscribe, and inspect the path without inventing a side protocol."
      number={8}
      total={19}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Session Phases', href: '/tutorials/session-phases' }}
      next={{ title: 'Sugar Commands', href: '/tutorials/sugar' }}
    >
      <div className="space-y-[var(--space-7)]">
        <section className="space-y-[var(--space-4)]">
          <div className="max-w-[52rem] border-t-2 border-[var(--border-strong)] pt-[var(--space-4)]">
            <p className="m-0 text-[11px] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Channel first
            </p>
            <h2 className="!m-0 !mt-[var(--space-2)] !border-t-0 !pt-0">Broadcast when the audience is a role</h2>
          </div>

          <p>
            Use <code>pd pub</code> for events any interested worker can consume: review requested, build complete, docs changed, release blocked. The channel name is the contract. The payload is ordinary text or JSON.
          </p>

          <CodeBlock language="bash">
            {`$ pd pub swarm:analyst:main '{"task":"summarize","source":"docs/tutorials"}'\n[ok] Published to swarm:analyst:main (id: 421)`}
          </CodeBlock>

          <p>
            Subscribe with <code>pd sub</code> when you want to watch that channel live. Use JSON output when another tool or agent will parse the stream.
          </p>

          <CodeBlock language="bash">
            {`$ pd sub swarm:analyst:main -j\n{"sender":"CLI","signal":"report","payload":{"task":"summarize","source":"docs/tutorials"}}`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-4)]">
          <div className="max-w-[52rem] border-t-2 border-[var(--border-strong)] pt-[var(--space-4)]">
            <p className="m-0 text-[11px] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Direct inbox
            </p>
            <h2 className="!m-0 !mt-[var(--space-2)] !border-t-0 !pt-0">Message a known registered agent</h2>
          </div>

          <p>
            Use <code>pd inbox</code> when the target is a specific registered agent. This is not a replacement for pub/sub. It is a direct mailbox for an agent id.
          </p>

          <CodeBlock language="bash">
            {`$ pd inbox send agent-7f3a "Please review the spawn tutorial examples."\nMessage sent to agent-7f3a\n\n$ pd inbox list --agent agent-7f3a\n[unread] [12:04:38] <cli-18472> Please review the spawn tutorial examples.`}
          </CodeBlock>
        </section>

        <section className="max-w-[52rem] border-2 border-[var(--border-strong)] shadow-[var(--shadow-flat)]">
          <div className="border-b-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)]">
            <p className="m-0 text-[11px] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Operator map
            </p>
            <h2 className="!m-0 !mt-[var(--space-1)] !border-t-0 !pt-0 text-[1.35rem]">Which surface should I use?</h2>
          </div>

          <div className="divide-y-2 divide-[var(--border-strong)]">
            {[
              ['Broadcast', 'pd pub <channel> <payload>', 'For role or workflow events. Any subscriber can react.'],
              ['Subscribe', 'pd sub <channel>', 'For live inspection or simple stream consumers.'],
              ['Direct message', 'pd inbox send <agent-id> <message>', 'For a known registered agent id, not a topic.'],
            ].map(([label, command, description]) => (
              <div key={label} className="grid gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] sm:grid-cols-[9rem_minmax(0,1fr)]">
                <p className="m-0 text-[11px] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  {label}
                </p>
                <div className="space-y-[var(--space-1)]">
                  <code>{command}</code>
                  <p className="m-0 text-sm text-[var(--text-secondary)]">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </TutorialLayout>
  )
}
