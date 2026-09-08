import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle, ShieldCheck, GitPullRequest, Anchor } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import { AgentAnatomy } from '@/components/agents/AgentAnatomy'

export default function FleetFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Fleet
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
          Fleet &amp; the GitHub App
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
          One YAML file, two fleets. Locally,
          <code className="mx-1 font-mono text-sm text-[var(--brand-primary)]">pd-fleet.yml</code>
          declares scheduled agents, channel-triggered agents, and watchers that the Port Daddy
          daemon runs on your machine. Install the Port Daddy GitHub App and the same file also
          crews a <strong className="text-[var(--text-primary)]">cloud fleet</strong>: reviewer
          ships, an ideation crew, and the Purser board every pull request from a Cloudflare
          Worker — no laptop awake, no CI minutes.
        </p>
      </div>

      {/* Local fleet in brief */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Local Fleet, Briefly</h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          The local half is covered in depth by the{' '}
          <Link to="/docs/cli/fleet" className="text-[var(--brand-primary)] underline">pd fleet CLI reference</Link>
          {' '}and the{' '}
          <Link to="/tutorials/fleet" className="text-[var(--brand-primary)] underline">fleet tutorial</Link>.
          The short version:
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="lw-stripe-card space-y-2 p-4 pl-5">
            <div className="font-semibold text-[var(--text-primary)]">CLI mode</div>
            <p className="text-sm text-[var(--text-secondary)]">
              Runs in your terminal until Ctrl+C. Good for development and one-off fleet runs.
            </p>
            <DocsCodeBlock
              language="bash"
              code={`pd fleet init    # First-time setup
pd fleet up      # Start (runs until Ctrl+C)
pd fleet status  # Inspect
pd fleet down    # Stop`}
            />
          </div>
          <div className="lw-stripe-card space-y-2 p-4 pl-5 [--stripe:var(--brand-accent)]">
            <div className="font-semibold text-[var(--text-primary)]">Daemon mode</div>
            <p className="text-sm text-[var(--text-secondary)]">
              The daemon auto-discovers <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">pd-fleet.yml</code> in
              every registered project on boot. Fleets survive terminal close, sleep, and
              restarts; editing the file hot-reloads.
            </p>
            <DocsCodeBlock
              language="bash"
              code={`PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"
curl "$PD_URL/fleet"                # Status
curl -XPOST "$PD_URL/fleet/reload"  # Reload configs
curl "$PD_URL/fleet/events"         # SSE stream`}
            />
          </div>
        </div>
      </div>

      {/* One real agent, labeled — the visual lead-in to the schema. */}
      <AgentAnatomy />

      {/* 1. The ship roster */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Ship Roster</h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          When a pull request opens (or synchronizes), the cloud executor parses your repo&apos;s{' '}
          <code className="font-mono text-sm text-[var(--brand-primary)]">pd-fleet.yml</code>{' '}
          deterministically — the whole document, no truncation — and launches every ship whose
          trigger matches. Three classes of ship sail:
        </p>

        {/* Reviewers */}
        <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
          <div className="font-semibold text-[var(--text-primary)]">Reviewer ships</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">code-reviewer</code>,{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">qa</code>,{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">red-team</code>, and{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">tautology-sniffer</code>{' '}
            read the diff and raise file:line objections. Each ship runs as a{' '}
            <strong className="text-[var(--text-primary)]">map-reduce over the diff</strong>: the diff is split into
            file-aligned chunks under a 12,000-character budget, the ship makes one call per chunk
            (MAP), and when the fan-out is more than one chunk a manager call merges the partial
            findings, deduplicates them, and computes the final verdict (REDUCE).
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
            <li>
              <strong className="text-[var(--text-primary)]">Findings</strong> are a fenced JSON array of{' '}
              <code className="font-mono text-[length:var(--type-meta-size)]">{'{ path, line, severity, body }'}</code>{' '}
              with severity <code className="font-mono text-[length:var(--type-meta-size)]">HIGH | MEDIUM | LOW</code>,
              posted as inline GitHub review comments — one review per PR, edited in place on
              resync, never a pile of duplicate comments.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Verdicts</strong> end every ship&apos;s output:{' '}
              <code className="font-mono text-[length:var(--type-meta-size)]">FLEET-VERDICT: PASS</code> or{' '}
              <code className="font-mono text-[length:var(--type-meta-size)]">FLEET-VERDICT: BLOCK</code>, parsed
              last-line-wins. A <em>blocking</em> ship (<code className="font-mono text-[length:var(--type-meta-size)]">blocking: true</code> in
              YAML) fails closed: a missing verdict, an errored call, or a malformed findings block
              counts as BLOCK. Advisory ships can turn the umbrella check neutral but can never
              fail it.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Surface gates run in code, before any AI spend</strong>:
              red-team only sails when the diff touches auth/crypto/secrets/capability paths,
              tautology-sniffer only when it touches test files, and reviewer ships skip
              docs-only diffs entirely. A skipped ship costs nothing and the transcript records why.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">tautology-sniffer</strong> deserves a sentence: it hunts
              tests that cannot fail (mock everything, assert the mock) and hollow evidence in the
              PR narrative — &quot;ran the tests&quot; with no command, no output, no counts.
            </li>
          </ul>
        </div>

        {/* Ideation crew */}
        <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4">
          <div className="font-semibold text-[var(--text-primary)]">Ideation crew</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">spark</code>{' '}
            (high-temperature product imagination),{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">spider</code>{' '}
            (syllogism engine: A and B are already true, therefore C),{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">lookout</code>{' '}
            (trouble-ahead watch, severity-tagged), and{' '}
            <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">snipe</code>{' '}
            (spots recurring friction worth turning into a reusable skill). They do not review the
            diff for correctness — they propose <em>forward</em> work as a validated proposal
            schema with an action of{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">roadmap | assign | skill</code>. Every
            proposal renders to a real command: a prefilled GitHub issue URL plus{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">pd roadmap upsert</code>, or{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">pd dispatch propose &quot;&lt;goal&gt;&quot;</code> with
            a ready-to-paste agent prompt. Ideation ships are always advisory — even{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">blocking: true</code> in YAML cannot make
            one gate a merge.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">And they can now code.</strong> When a proposal is small
            enough to just do — a missing null check, an off-by-one in a doc example, a test the
            diff obviously needs — the crew writes the patch itself and{' '}
            <strong className="text-[var(--text-primary)]">stacks a fix PR onto your head branch</strong> instead of
            leaving a comment that asks you to do it. See stacked PRs below for the mechanics and
            guards.
          </p>
        </div>

        {/* The Purser */}
        <div className="border-l-[length:var(--lw-stripe)] border-[var(--error)] pl-4">
          <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Anchor size={16} className="shrink-0 text-[var(--error)]" />
            The Purser — the adversarial ship
          </div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            The Purser does not review your code. It audits your <em>claim</em>. It reads the PR
            title, body, linked issues, and diff, then{' '}
            <strong className="text-[var(--text-primary)]">steel-mans the PR&apos;s stated purpose into a testable
            contract</strong> — the strongest, most complete interpretation of what this change says it
            does. Then it authors adversarial unit and integration tests against that contract:
            the empty inputs, the concurrent calls, the error paths your test plan skipped.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
            <li>
              When the Cloudflare Sandbox binding is enabled, the Purser{' '}
              <strong className="text-[var(--text-primary)]">executes its tests</strong> in an isolated sandbox and
              reports real pass/fail results. Without the binding it still authors the tests, ships
              them un-executed, and labels them as such.
            </li>
            <li>
              It opens a <strong className="text-[var(--text-primary)]">stacked pull request</strong> carrying its
              contract tests, and your PR is re-based onto it — so your branch has to satisfy the
              Purser&apos;s best interpretation of your own claim, not its laziest.
            </li>
            <li>
              It is obstreperous by design. It does not take your test plan at face value, and it
              does not soften a contract because the diff turned out to be smaller than the title.
              If your PR says &quot;handles retries&quot;, the Purser writes the test where the third retry
              fails.
            </li>
          </ul>
        </div>
      </div>

      {/* 2. Stacked PRs */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--text-primary)]">
            <GitPullRequest size={18} className="shrink-0 text-[var(--brand-primary)]" />
            Stacked PRs, Both Directions
          </h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          The fleet stacks in two directions, and they are not the same operation:
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="lw-stripe-card space-y-2 p-4 pl-5">
            <div className="font-semibold text-[var(--text-primary)]">Tests stacked <em>under</em> your PR</div>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              The Purser cuts a branch from your PR&apos;s base, pushes its contract tests to it,
              opens that branch as a PR into the base, and then{' '}
              <strong className="text-[var(--text-primary)]">base-retargets your PR</strong> onto the Purser branch.
              Your diff is now measured against the contract tests, and your CI runs your code
              against them. Merge order is enforced by construction: the contract lands first,
              then your change on top of it.
            </p>
          </div>
          <div className="lw-stripe-card space-y-2 p-4 pl-5 [--stripe:var(--brand-accent)]">
            <div className="font-semibold text-[var(--text-primary)]">Fixes stacked <em>on top</em> of your head</div>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              When the ideation crew codes a small fix, it cuts a branch from your PR&apos;s{' '}
              <em>head</em> and opens a PR targeting your head branch. Merge it and the fix is
              absorbed into your PR before it lands; close it and nothing happened. Your branch is
              never force-pushed and never rewritten — the crew only ever adds a PR you can
              decline.
            </p>
          </div>
        </div>
        <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4">
          <div className="font-semibold text-[var(--text-primary)]">The guards</div>
          <ul className="mt-1 space-y-1 text-sm text-[var(--text-secondary)]">
            <li>
              <strong className="text-[var(--text-primary)]">Same-repo only.</strong> Neither direction runs against a
              fork PR: the App&apos;s installation token has no rights on the fork, and base-retargeting
              a fork PR onto a branch it cannot see is not a thing. Fork PRs get comments, never
              branches.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Permission fallbacks.</strong> If the installation lacks{' '}
              <code className="font-mono text-[length:var(--type-meta-size)]">contents: write</code>, the executor
              cannot push branches at all — it degrades to a review comment carrying the full
              patch as a unified diff you can apply with{' '}
              <code className="font-mono text-[length:var(--type-meta-size)]">git apply</code>. The check run never
              fails because a permission is missing.
            </li>
            <li>
              <strong className="text-[var(--text-primary)]">Budget still rules.</strong> Stacking is subject to the
              same per-ship daily budgets and fleet spend ceilings as everything else.
            </li>
          </ul>
        </div>
      </div>

      {/* 3. Skill grafting */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Skill Grafting</h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          Ships can graft skills from your repo&apos;s{' '}
          <code className="font-mono text-sm text-[var(--brand-primary)]">skills/</code> catalog into their prompts:
          the skill&apos;s <code className="font-mono text-sm text-[var(--brand-primary)]">SKILL.md</code> body is
          injected into the ship&apos;s system prompt, context-cost capped. Grafts are read from{' '}
          <strong className="text-[var(--text-primary)]">trusted main</strong> — never from the PR head — so a pull
          request cannot inject prompt content into its own reviewers. Configure grafts per ship
          in <code className="font-mono text-sm text-[var(--brand-primary)]">pd-fleet.yml</code>:
        </p>
        <DocsCodeBlock
          language="bash"
          code={`fleet:
  agents:
    code-reviewer:
      trigger: pull_request:*
      blocking: true
      graft:
        - typescript-narrowing-expert   # skills/typescript-narrowing-expert/SKILL.md
        - error-handling-patterns
      prompt: |
        Review the diff for correctness. Cite ADRs.

    tautology-sniffer:
      trigger: pull_request:*
      blocking: true
      graft: [rust-code-testing]        # domain-specific test smell catalog`}
        />
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          A grafted skill is how a generic reviewer becomes <em>your</em> reviewer: graft your
          repo&apos;s testing conventions into tautology-sniffer, your error-handling doctrine into
          code-reviewer. Skills that don&apos;t exist at the named path are skipped with a transcript
          note — a typo&apos;d graft never sinks a ship.
        </p>
      </div>

      {/* 4. Squid-harnessed cloud agents */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Squid-Harnessed: Cloud Runs on the Relay Fabric</h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          Cloud ships are not a separate universe. Every cloud run is squid-harnessed: it emits
          coordination events into the PD relay fabric —{' '}
          <code className="font-mono text-sm text-[var(--brand-primary)]">run-started</code>, per-ship verdicts, and
          stacked-PR events — so your local daemon and{' '}
          <Link to="/mac-preview" className="text-[var(--brand-primary)] underline">FleetBar</Link> see cloud
          activity in the same stream as local agents. Per-ship cost and failure telemetry feeds
          the daemon&apos;s <code className="font-mono text-sm text-[var(--brand-primary)]">GET /metrics/cost</code>, so
          the FleetBar cost panel counts cloud spend next to local spend and a degraded cloud run
          surfaces to the operator instead of failing silently.
        </p>
        <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
          <div className="font-semibold text-[var(--text-primary)]">The deliberation transcript page</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            Every check run&apos;s <em>Details</em> link opens{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">/fleet/runs/:id</code> on the relay — a
            server-rendered breakdown of the whole run: which ships sailed and which were gated
            off (with the gate&apos;s reason), every MAP chunk, the REDUCE step, each ship&apos;s findings
            and verdict, and token/cost per step. Run ids are deterministic, so the link carries
            an HMAC capability token (<code className="font-mono text-[length:var(--type-meta-size)]">?t=v1.&lt;hmac&gt;</code>)
            that makes the page unguessable; GitHub&apos;s own repo ACL decides who ever sees the link
            in the first place.
          </p>
        </div>
      </div>

      {/* 5. Sign in + your runs */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Sign In and See Your Runs</h2>
        </div>
        <p className="leading-relaxed text-[var(--text-secondary)]">
          Log in with GitHub at{' '}
          <code className="font-mono text-sm text-[var(--brand-primary)]">relay.portdaddy.dev/login</code>. The relay
          is a confidential OAuth client: your GitHub token stays server-side, wrapped with
          AES-GCM, and the browser only ever holds an opaque HttpOnly session cookie — no token,
          no localStorage, ever.
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>
              <code className="font-mono text-sm text-[var(--brand-primary)]">/account/runs</code> lists every fleet
              run attributed to your GitHub identity — repo, PR, ships, conclusion, cost — newest
              first.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>
              Every run links to its deliberation receipt — the same transcript page the check
              run&apos;s Details link opens, so &quot;what did the fleet actually do&quot; is always one click
              away.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>
              The account page also carries the leaving strip: export everything or delete your
              account, both real endpoints, both immediate.
            </span>
          </li>
        </ul>

        {/* Account CTA — one door into the signed-in surface, benefit first. */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
          <div className="space-y-1">
            <div className="font-semibold text-[var(--text-primary)]">
              Your fleet&apos;s receipts, one sign-in away
            </div>
            <div className="text-sm text-[var(--text-secondary)]">
              Every run your GitHub identity can read — ships, verdicts, cost — each with a
              shareable link. Pair your devices —{' '}
              <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">pd account login</code>{' '}
              — and the CLI and FleetBar see the same runs.
            </div>
          </div>
          <a
            href="https://relay.portdaddy.dev/account/runs"
            className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
          >
            See your runs
            <ArrowRight size={16} />
          </a>
        </div>
      </div>

      {/* 6. Operator setup — honest box */}
      <div className="space-y-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <AlertCircle size={18} className="shrink-0 text-[var(--brand-accent)]" />
          Operator Setup — the Honest Version
        </h2>
        <ul className="space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          <li>
            <strong className="text-[var(--text-primary)]">The GitHub App needs <code className="font-mono">contents: write</code> for
            stacked branches.</strong> Grant it and the Purser and crew can push branches and open
            stacked PRs. Withhold it and every patch arrives as a comment with an applyable diff
            instead — the fleet still reviews, it just can&apos;t stack.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">The Cloudflare Sandbox / Containers binding is optional and
            beta.</strong> With it, the Purser executes its adversarial tests and reports real
            results. Without it, tests are authored but not run, and they are labeled un-executed.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">Nothing blocks on tests that never executed.</strong> An
            authored-but-not-run test is an advisory annotation. Only an executed, failing test —
            or a blocking reviewer&apos;s verdict — can fail the umbrella check. The fleet does not
            bluff.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">Run pages need two env values on the executor:</strong>{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">RUN_DETAILS_BASE_URL</code> and{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">RUN_PAGE_SECRET</code> (32+ chars, shared
            with the relay). Unset, check runs simply have no Details link — nothing else breaks.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">Set a budget before you sail.</strong>{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">limits.budget_usd_per_day</code> in{' '}
            <code className="font-mono text-[length:var(--type-meta-size)]">pd-fleet.yml</code> caps daily spend;
            per-ship daily budgets cap each ship. A trigger storm without a ceiling is your bill,
            not the fleet&apos;s.
          </li>
        </ul>
      </div>

      {/* Next — cobalt wash well with an ink hairline edge (story hues are
          accents, never chrome — ch. 20 rule 1). Wraps on narrow viewports. */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)]">CLI Reference</div>
          <div className="font-semibold text-[var(--text-primary)]">pd fleet</div>
          <div className="text-sm text-[var(--text-muted)]">Start, stop, and inspect your agent fleet</div>
        </div>
        <Link
          to="/docs/cli/fleet"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          CLI Reference
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
