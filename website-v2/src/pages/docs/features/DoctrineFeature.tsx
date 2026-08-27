import { Link } from 'react-router-dom'
import { ArrowRight, BookOpenCheck, FlaskConical, Scale, ShieldCheck } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

const loopSteps = [
  {
    icon: BookOpenCheck,
    title: 'Cite the observed decision',
    body: 'Capture a DecisionEpisode from an actual transcript, review thread, CI receipt, commit, or verifier result. Preserve the action, alternatives, and cues separately; recurring exact-class observations may also be frozen in a harvest.',
  },
  {
    icon: FlaskConical,
    title: 'Make a candidate loseable',
    body: 'State a conditional rule and preregister a discriminating experiment. For CASE-13, vary independent technical evidence separately from unresolved-thread state.',
  },
  {
    icon: ShieldCheck,
    title: 'Deliver advisory orders',
    body: 'Retrieve exact decision-class matches before a comparable choice. The retrieval receipt records what the agent saw, including the honest no-match result.',
  },
  {
    icon: Scale,
    title: 'Close with verified evidence',
    body: 'Record whether the agent followed, adapted, or rejected the packet; attach a later verified outcome or contest the packet when a boundary appears.',
  },
]

export default function DoctrineFeature() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Evidence-led doctrine
        </p>
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
          Decision rules must earn their place on the bridge.
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
          Port Daddy&apos;s CASE-13 doctrine loop turns a cited coding-agent decision into a bounded
          experiment and an inspectable advisory packet. It keeps the history, the agent&apos;s response,
          and the later result in one evidence stream instead of treating an agent&apos;s temperament as
          reusable knowledge.
        </p>
        <p className="max-w-3xl leading-relaxed text-[var(--text-secondary)]">
          The deep operator surface is the native <code>Doctrine</code> pane in pd-console. It reads and writes the
          same daemon-backed ledger as the CLI, SDK, and MCP tools; it never shells out to them and never turns advice
          into merge, deployment, or spend authority.
        </p>
      </div>

      <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-6">
        <p className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          The core evidence loop
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
          <div className="border border-[var(--border-strong)] bg-[var(--surface-base)] p-4 font-mono text-sm text-[var(--text-primary)]">Cited episode</div>
          <span className="hidden text-center text-[var(--brand-primary)] md:block">→</span>
          <div className="border border-[var(--border-strong)] bg-[var(--surface-base)] p-4 font-mono text-sm text-[var(--text-primary)]">Candidate + preregistered experiment</div>
          <span className="hidden text-center text-[var(--brand-primary)] md:block">→</span>
          <div className="border border-[var(--border-strong)] bg-[var(--surface-base)] p-4 font-mono text-sm text-[var(--text-primary)]">Advisory retrieval receipt</div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center md:pl-[34%]">
          <div className="border border-[var(--border-strong)] bg-[var(--surface-base)] p-4 font-mono text-sm text-[var(--text-primary)]">Agent application</div>
          <span className="hidden text-center text-[var(--brand-primary)] md:block">→</span>
          <div className="border border-[var(--border-strong)] bg-[var(--surface-base)] p-4 font-mono text-sm text-[var(--text-primary)]">Verified outcome or contest</div>
        </div>
        <p className="mb-0 mt-4 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)]">
          This diagram follows one candidate&apos;s core path. Harvest records recurrent evidence before proposal; explicit supersession or retirement closes a later doctrine revision without deleting its history.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {loopSteps.map((step, index) => {
          const Icon = step.icon
          return (
            <section key={step.title} className="border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5">
              <div className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[var(--border-strong)] bg-[var(--surface-base)] font-mono text-sm font-semibold text-[var(--brand-primary)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <Icon size={17} className="text-[var(--brand-primary)]" />
                    <h2 className="m-0 text-lg font-semibold text-[var(--text-primary)]">{step.title}</h2>
                  </div>
                  <p className="mb-0 mt-2 leading-relaxed text-[var(--text-secondary)]">{step.body}</p>
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <section className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The CASE-13 boundary</h2>
        </div>
        <p className="max-w-3xl leading-relaxed text-[var(--text-secondary)]">
          CASE-13 begins with a green change that stayed unmerged because a bot-review thread was unresolved.
          The transcript does not say whether the agent was responding to independent technical evidence,
          process integrity, asymmetric loss, role framing, or a ritual. A doctrine candidate makes one
          of those explanations testable; it does not declare the explanation true.
        </p>
        <DocsCodeBlock code={'# Each mutating command accepts a cited JSON input.\\npd doctrine record-episode --input @case13-episode.json\\npd doctrine propose --input @case13-candidate.json\\npd doctrine preregister --input @case13-experiment.json\\npd doctrine run doctrine-experiment_... --input @matched-control.json\\npd doctrine run doctrine-experiment_... --input @matched-treatment.json\\npd doctrine admit doctrine-candidate_... --input @admission.json\\n\\n# At a later comparable decision:\\npd doctrine orders --input @next-merge-decision.json\\npd doctrine application doctrine-retrieval_... --input @agent-response.json\\npd doctrine outcome doctrine-application_... --input @verified-outcome.json'} />
        <p className="max-w-3xl leading-relaxed text-[var(--text-secondary)]">
          MCP exposes the whole lifecycle: episode and harvest capture, candidate and experiment writes,
          admission, retrieval, application, outcome, contest, supersession, retirement, and the four audit
          reads (<code>doctrine_list</code>, <code>doctrine_get</code>, <code>doctrine_harvest_list</code>, and
          <code>doctrine_harvest_get</code>). It is not a write-only harvesting path: the retrieval receipt,
          agent response, and later outcome remain part of the same evidence trail.{' '}
          <Link className="text-[var(--brand-primary)] hover:underline" to="/docs/mcp#doctrine_orders">Browse the MCP tools.</Link>
        </p>
      </section>

      <section className="border-l-4 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-6">
        <h2 className="m-0 text-xl font-semibold text-[var(--text-primary)]">What the first slice does not claim</h2>
        <ul className="mt-4 space-y-2 leading-relaxed text-[var(--text-secondary)]">
          <li>It is advisory: an order never merges, blocks, or resolves a review thread.</li>
          <li>Prompt-only, unmatched, drifted, or same-replica replay can be recorded, but cannot admit doctrine. A qualifying control/treatment pair has matching replay context except for distinct replica IDs.</li>
          <li>The daemon derives identity from its credential and makes every first-cycle admission provisional; callers cannot self-promote a doctrine to established.</li>
          <li>One verified application is an observed result, not a fleet-wide causal effect or a claim of automatic skill improvement.</li>
          <li>Current retrieval is exact on structured decision class and project scope; it is deliberately not a lexical-only or semantic substitute.</li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)]">Continue with evidence in hand</div>
          <div className="mt-1 font-semibold text-[var(--text-primary)]">Walk the CASE-13 cycle end to end</div>
        </div>
        <Link to="/tutorials/doctrine-cycle" className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]">
          Open the tutorial
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
