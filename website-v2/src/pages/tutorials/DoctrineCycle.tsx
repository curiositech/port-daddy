import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { BookOpenCheck, FlaskConical, Scale, ScrollText, ShieldCheck } from 'lucide-react'

export function DoctrineCycle() {
  return (
    <TutorialLayout
      title="Test a Decision Rule Before Reusing It"
      description="Turn one cited incident into an advisory evidence loop: capture what happened, challenge a candidate explanation, retrieve it before a comparable decision, and preserve what happened next."
      number={22}
      total={22}
      level="Advanced"
      readTime="14 min read"
      prev={{ title: 'PD Tube', href: '/tutorials/pd-tube' }}
      next={undefined}
    >
      <div className="space-y-12">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <BookOpenCheck className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">A logbook, not a personality test</h2>
          </div>
          <p>
            A repeated agent choice can be worth studying without turning it into a folk story.
            Port Daddy calls the resulting, falsifiable choice rule <strong>doctrine</strong>: a
            claim about when one action should be preferred over another, why, and where the rule
            stops applying. It is not &ldquo;the Steward is cautious.&rdquo;
          </p>
          <p>
            CASE-13 starts with a real integration decision: a green change stayed unmerged because
            a bot review thread was unresolved. The question is whether the agent was reacting to
            independent technical evidence, process integrity, asymmetric loss, role framing, or a
            ritual. The old transcript cannot settle that by itself.
          </p>
          <div className="border-l-2 border-[var(--brand-primary)] bg-[var(--surface-raised)] px-5 py-4 text-[var(--text-secondary)]">
            The doctrine loop is advisory. Nothing here merges, blocks, resolves a review thread, or
            changes enforcement policy.
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <ScrollText className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Capture the observed decision first</h2>
          </div>
          <p>
            Start from durable evidence: a transcript span, a review-thread link, CI receipt, commit,
            or verifier result. The episode records the historical action, alternatives, and cues
            separately so a later test can vary one thing without quietly rewriting everything else.
          </p>
          <CodeBlock language="bash">
            {`pd doctrine record-episode --input @case13-episode.json
pd doctrine propose --input @case13-candidate.json

# Every evidence input names:
# projectDir, actorId, citations, and the fields appropriate to this step.`}
          </CodeBlock>
          <p>
            A candidate is useful only if it can lose. For this case: &ldquo;when a merge is otherwise
            ready, inspect whether an unresolved thread contains independent technical evidence
            before treating thread state itself as a veto.&rdquo;
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <FlaskConical className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">2. Preregister a maneuver that can discriminate</h2>
          </div>
          <p>
            Record the hypothesis, control, treatment, primary outcome, and optional sham before
            reading the result. For CASE-13, vary technical concern and review-thread state separately.
            That distinguishes a response to evidence from a response to the interface state.
          </p>
          <CodeBlock language="bash">
            {`pd doctrine preregister --input @case13-experiment.json
pd doctrine run doctrine-experiment_... --input @case13-control.json
pd doctrine run doctrine-experiment_... --input @case13-treatment.json
pd doctrine admit doctrine-candidate_... --input @case13-admission.json`}
          </CodeBlock>
          <p>
            Factual fidelity is not a formality. A prompt-only reconstruction or a factual replay
            that no longer behaves like the observed case is still worth recording, but it cannot
            establish doctrine. Admission requires matched factual control and treatment runs from
            the candidate&apos;s own preregistered experiment.
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <ShieldCheck className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">3. Deliver orders before the next decision</h2>
          </div>
          <p>
            An admitted doctrine is a packet of cited advisory evidence. The important part is the
            receipt: Port Daddy records what was shown before the agent acts, including the honest
            case where no matching packet is available.
          </p>
          <CodeBlock language="bash">
            {`pd doctrine candidates --status provisional --decision-class integration.merge
pd doctrine orders --input @next-merge-decision.json

# The response contains a doctrine-retrieval receipt id.
pd doctrine application doctrine-retrieval_... --input @agent-response.json`}
          </CodeBlock>
          <p>
            Follow, adapt, and reject are all valid responses. A receipt does not prove that the
            advice was right; it makes the later judgment inspectable instead of guessing whether
            an agent even saw it.
          </p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Scale className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">4. Close the after-action loop honestly</h2>
          </div>
          <p>
            Attach an outcome only when a person or verifier can name its evidence. A later success
            is one observed application, not a fleet-wide effect size. If the case exposes a boundary
            or harm, contest the doctrine rather than deleting its history.
          </p>
          <CodeBlock language="bash">
            {`pd doctrine outcome doctrine-application_... --input @verified-outcome.json
pd doctrine contest doctrine:integration:independent-evidence --input @contrary-case.json
pd doctrine show doctrine:integration:independent-evidence`}
          </CodeBlock>
          <p>
            The read-back joins the episode, experiment, retrieval receipts, agent applications,
            outcomes, and contest history from one append-only Harbor evidence stream. That is the
            difference between writing doctrine down and giving the next agent something it can read,
            challenge, and improve.
          </p>
        </section>

        <section className="space-y-4 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-6">
          <h2 className="m-0">MCP and SDK carry the same cargo</h2>
          <p className="m-0">
            The loop is not a CLI-only ritual. MCP has explicit tools to record the episode,
            candidate, preregistration, treatment runs, admission, orders, application, outcome,
            and contest; the SDK has matching methods. Both retain the evidence chain and both
            refuse to admit an unmatched or prompt-only replay.
          </p>
        </section>

        <section className="space-y-4 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-6">
          <h2 className="m-0">What this first slice proves</h2>
          <p className="m-0">
            It proves a complete, inspectable evidence trail can exist. It does not prove a causal
            mechanism, transfer across models or projects, or automatic skill improvement. Those
            claims need faithful replay adapters, planted-cause calibration, independent cases, and
            held-out evaluation. Read the full CASE-13 walkthrough in the documentation before
            presenting a stronger result.
          </p>
        </section>
      </div>
    </TutorialLayout>
  )
}
