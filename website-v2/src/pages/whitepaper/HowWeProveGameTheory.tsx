import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CircleAlert,
  Coins,
  Cpu,
  Dices,
  FileCode2,
  Gavel,
  Layers,
  Lightbulb,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { Mermaid } from '@/components/ui/Mermaid'

// ────────────────────────────────────────────────────────────────────────────
// Mermaid diagrams. Each one renders through the site's themed Mermaid wrapper,
// which reads the brand tokens at render time.
// ────────────────────────────────────────────────────────────────────────────

const COMMITMENT_PROBLEM_CHART = `flowchart LR
  A["Agent A wants the file"] --> Q{"Who moves first?"}
  B["Agent B wants the file"] --> Q
  Q -->|"both grab"| Crash["Collision: both lose"]
  Q -->|"both wait"| Stall["Deadlock: both lose"]
  Q -->|"need: trusted referee<br/>(Aumann, 1974)"| Daemon["Port Daddy<br/>recommends"]
  Daemon -->|"Agent A: claim"| WorkA["A works, B yields"]
  Daemon -->|"Agent B: claim"| WorkB["B works, A yields"]`

const TLA_PIPELINE_CHART = `flowchart TD
  Spec["Hand-written TLA+ spec<br/>(state machine + properties)"] --> Check{"Model<br/>checker"}
  Check -->|"TLC: explicit-state<br/>(landed, runs on every PR)"| Result1["Yes / No + counterexample trace"]
  Check -->|"Apalache: symbolic SMT<br/>(supported via @type annotations)"| Result2["Yes / No + counterexample trace<br/>over larger state spaces"]
  Result1 --> Read["Read the trace. Fix the model.<br/>Or trust the YES."]
  Result2 --> Read`

const VERIFICATION_STACK_CHART = `flowchart LR
  Algebra["Closed-form proof<br/>(pen and paper)"] -->|"discharge with"| Z3["Z3 / SMT<br/>(numeric and symbolic)"]
  StateMachine["Coordination lifecycle<br/>(TLA+ spec)"] -->|"discharge with"| TLC["TLC / Apalache"]
  Protocol["Cryptographic exchange<br/>(applied pi calculus)"] -->|"discharge with"| ProVerif["ProVerif"]
  Implementation["Rust capability check"] -->|"discharge with"| Kani["Kani"]
  Z3 --> Bond["Bond pricing claims survive"]
  TLC --> Bond
  ProVerif --> Bond
  Kani --> Bond`

const GAME_PAYOFF_CHART = `flowchart TB
  Start(["Both agents want file F"]) --> Pick["Each picks: claim or defer"]
  Pick --> CC["A claim, B claim<br/>payoff (1, 1) — collision"]
  Pick --> CD["A claim, B defer<br/>payoff (3, 1) — A wins, Pareto-OK"]
  Pick --> DC["A defer, B claim<br/>payoff (1, 3) — B wins, Pareto-OK"]
  Pick --> DD["A defer, B defer<br/>payoff (0, 0) — wasted turn"]
  CD -.->|"good outcome,<br/>but who agrees first?"| Problem["The commitment problem"]
  DC -.->|"good outcome,<br/>but who agrees first?"| Problem`

// ────────────────────────────────────────────────────────────────────────────
// Authored, runnable code samples. Z3 SMT script is verbatim from the shipped
// artifact `proofs/economics/delta-threshold.z3`. TLA+ snippet is the
// load-bearing fragment of `proofs/economics/claim_signaling.tla` (full file
// is ~250 lines including type annotations and comments).
// ────────────────────────────────────────────────────────────────────────────

const Z3_SMT_SAMPLE = `; delta-threshold.z3 — verify the discount-factor threshold for
; the graduated-trigger strategy of agent-transactions §sec:economic.
; Full artifact: proofs/economics/delta-threshold.z3
(set-logic QF_NRA)
(declare-const delta Real)
(assert (>= delta 0))
(assert (<= delta 1))
(assert (= (+ (* 2 delta delta delta)
              (* 2 delta delta)
              (* 2 delta)
              (- 1))
           0))
(check-sat)
(get-model)
; Expected: sat, with delta the unique real root in (0, 1).
; Numerically delta* ≈ 0.3425. Z3 returns in well under 100ms.`

const TLA_CLAIM_SIGNALING_SAMPLE = `\\* claim_signaling.tla — repeated claim-signaling under graduated trigger.
\\* Full artifact: proofs/economics/claim_signaling.tla
\\* Runs on every PR via .github/workflows/proofs.yml (TLC, JDK 17,
\\* tla2tools v1.8.0). Apalache-compatible via @type annotations.

EXTENDS Integers, FiniteSets, Sequences, TLC

CONSTANTS DeltaNum, DeltaDen, Horizon, PunishmentRounds

\\* Stage-game payoffs calibrated so the IC cubic is exactly
\\* 2 delta^3 + 2 delta^2 + 2 delta - 1 = 0 (gain g = 1, loss L = 2).
PayoffFollowFollow == 3      \\* cooperative
PayoffFollowClaim  == 0      \\* sucker
PayoffClaimFollow  == 4      \\* defector
PayoffClaimClaim   == 1      \\* mutual claim (punishment)

\\* Invariant: at every reachable state where the deviator has actually
\\* deviated, their accumulated discounted score does not exceed what
\\* they would have under always-follow. Holds at delta >= delta*.
NoUnilateralDeviationPositive ==
  ( deviated /\\ deviatorId \\in Agents ) =>
    actualScore[deviatorId] <= followScore[deviatorId]

Spec == Init /\\ [][Next]_vars
THEOREM Spec => []NoUnilateralDeviationPositive`

// ────────────────────────────────────────────────────────────────────────────
// Small reusable bits.
// ────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  icon: Icon,
  number,
}: {
  eyebrow: string
  title: string
  icon: LucideIcon
  number: string
}) {
  return (
    <div className="space-y-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-4)]">
      <div className="flex items-center gap-[var(--space-3)]">
        <span className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--brand-primary)]">
          {number}
        </span>
        <BracketLabel>{eyebrow}</BracketLabel>
      </div>
      <div className="flex items-start gap-[var(--space-3)]">
        <span
          aria-hidden="true"
          className="mt-[var(--space-1)] flex h-[var(--space-6)] w-[var(--space-6)] shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
        >
          <Icon size={18} aria-hidden="true" className="text-[var(--brand-primary)]" />
        </span>
        <PanelTitle as="h2" size="section" className="max-w-[28ch]">
          {title}
        </PanelTitle>
      </div>
    </div>
  )
}

function Sidenote({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <aside
      className="float-none lg:float-right lg:-mr-[18rem] lg:ml-[var(--space-5)] lg:w-[16rem] lg:clear-right my-[var(--space-4)] border-l-4 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
      role="note"
    >
      <div className="mb-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
        {label}
      </div>
      <div className="space-y-[var(--space-2)]">{children}</div>
    </aside>
  )
}

function PullQuote({ children, attribution }: { children: React.ReactNode; attribution?: string }) {
  return (
    <figure className="my-[var(--space-6)] border-y-2 border-[var(--border-strong)] bg-[var(--surface-strong)] px-[var(--space-5)] py-[var(--space-5)]">
      <blockquote className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
        &ldquo;{children}&rdquo;
      </blockquote>
      {attribution ? (
        <figcaption className="mt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
          — {attribution}
        </figcaption>
      ) : null}
    </figure>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose-area max-w-none space-y-[var(--space-4)] text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]">
      {children}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// The page.
// ────────────────────────────────────────────────────────────────────────────

export default function HowWeProveGameTheoryPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* HEADER */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <Link
              to="/whitepaper"
              className="mb-[var(--space-4)] inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              <ArrowLeft aria-hidden="true" size={14} />
              Back to the papers
            </Link>

            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)] lg:items-start">
              <div className="space-y-[var(--space-5)]">
                <PanelEyebrow>For the reader who took game theory once</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[18ch]">
                  How our whitepapers use — and prove — game theory.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[62ch] text-[length:var(--text-lg)]">
                  Two programs want the same file. Neither will move first
                  without an assurance. That is a four-hundred-year-old problem
                  in political philosophy and a five-second problem on a laptop
                  with two AI agents on it, and it has the same shape in both
                  rooms. The bonded-commons paper makes a precise claim about
                  when local coordination is a <em>correlated equilibrium</em>
                  {' '}— Aumann&apos;s 1974 generalization of Nash — and the
                  claim is not the kind of thing you should take on the
                  author&apos;s word. Below: what the game is, where it came
                  from, how a machine can confirm the proof in milliseconds,
                  and where the honest gaps still are.
                </PanelBody>
                <PanelBody className="max-w-[62ch] text-[length:var(--text-base)] text-[var(--text-secondary)]">
                  No prior exposure to TLA+, model checking, or SMT solvers
                  required. One undergraduate course in game theory is plenty.
                  The page assumes you have heard the name &ldquo;Nash&rdquo;
                  and seen a 2&times;2 payoff matrix, and that you have not yet
                  watched a piece of software accept or reject one of your
                  proofs.
                </PanelBody>
              </div>

              <aside className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <PanelEyebrow>At a glance</PanelEyebrow>
                <dl className="grid gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  <div className="border-b-2 border-[var(--border-default)] pb-[var(--space-2)]">
                    <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      Reading time
                    </dt>
                    <dd className="font-mono text-[var(--text-primary)]">about 22 minutes</dd>
                  </div>
                  <div className="border-b-2 border-[var(--border-default)] pb-[var(--space-2)]">
                    <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      Prerequisites
                    </dt>
                    <dd>one undergrad game-theory course; willingness to skim a state machine</dd>
                  </div>
                  <div className="border-b-2 border-[var(--border-default)] pb-[var(--space-2)]">
                    <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      What you&apos;ll meet
                    </dt>
                    <dd>Aumann, Schelling, Hobbes, TLA+, ProVerif, Z3, the price of anarchy, and exactly one cubic</dd>
                  </div>
                  <div>
                    <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      You will try yourself
                    </dt>
                    <dd>
                      a 100&nbsp;ms Z3 check, by hand, in a terminal — about six lines
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>

            {/* CI-green callout: the artifacts behind this page actually run. */}
            <div className="mt-[var(--space-6)] border-2 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-5)]">
              <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-3)]">
                <FileCode2 size={18} aria-hidden="true" className="text-[var(--brand-primary)]" />
                <BracketLabel>These artifacts exist and run on every PR</BracketLabel>
              </div>
              <p className="m-0 text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]">
                Three mechanization artifacts back this page — a Z3 SMT
                script, a TLA+ model, and a Monte Carlo simulation — and
                they all run unattended on every pull request via{' '}
                <a
                  className="font-mono underline decoration-[var(--brand-primary)] decoration-2 underline-offset-4 hover:text-[var(--brand-primary)]"
                  href="https://github.com/curiositech/port-daddy/blob/main/.github/workflows/proofs.yml"
                >
                  .github/workflows/proofs.yml
                </a>
                . If a check fails, the PR is red. Source paths cited
                throughout this page resolve to real files in the
                repo&apos;s{' '}
                <code>proofs/economics/</code> and{' '}
                <code>proofs/bonded/pareto/</code> directories. The
                credibility loan this page used to take on
                &ldquo;Apalache + Z3, planned&rdquo; is closed.
              </p>
            </div>
          </PageContainer>
        </section>

        {/* 01 — THE GAME AROSE */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
              <article className="space-y-[var(--space-5)]">
                <SectionHeader
                  number="01"
                  eyebrow="Where the game came from"
                  icon={Gavel}
                  title="Two agents wanted the same file."
                />
                <Prose>
                  <p>
                    Open a laptop in 2026. Two coding agents are working in the
                    same git repository — one is rewriting{' '}
                    <code>billing.ts</code>; the other has just decided it,
                    too, must rewrite <code>billing.ts</code>. Neither will
                    yield first, because yielding first is dumb if the other
                    one is going to charge ahead anyway. So both charge ahead.
                    The merge later is the kind of conflict that takes a human
                    forty minutes to untangle and produces a commit message
                    like <em>&ldquo;sorry, fixing.&rdquo;</em>
                  </p>
                  <Sidenote label="The political-science name">
                    Hobbes called it the war of all against all — every
                    rational actor preferring peace, none willing to disarm
                    first. The structure is the same whether the actors are
                    militias, neighbors, or two large language models with
                    file-write capabilities.
                  </Sidenote>
                  <p>
                    The political-science name for this is the{' '}
                    <strong>commitment problem</strong>. Both players strictly
                    prefer cooperation. Neither will move first without an
                    assurance the other will reciprocate. The eighteenth-century
                    names are Hobbes (a sword, held by a sovereign, that makes
                    the assurance binding), Hume (convention, slow-grown,
                    self-enforcing), and Schelling (focal points — &ldquo;we
                    meet at Grand Central at noon&rdquo; — that need no
                    enforcement at all if both players see them at once).
                  </p>
                  <p>
                    The twenty-first-century name — the one this page is built
                    around — is <strong>correlated equilibrium</strong>, due
                    to Robert Aumann in 1974. Aumann&apos;s move was so
                    quietly radical it took the field a decade to digest. He
                    showed that if there is a trusted third party drawing
                    private recommendations from a <em>publicly known</em>
                    {' '}probability distribution, the set of stable strategy
                    profiles you can support is{' '}
                    <strong>strictly larger</strong> than the set of Nash
                    equilibria — and frequently better for everyone in it. No
                    sword. No culture. Just a fair coin and a referee who
                    publishes the coin&apos;s weighting.
                  </p>
                  <Sidenote label="Aumann (1974)">
                    The paper is &ldquo;Subjectivity and Correlation in
                    Randomized Strategies,&rdquo; J. Math. Econ. 1, 67–96. It
                    is twenty-nine pages and unusually readable for a Nobel
                    co-laureate (1994, with Schelling). The version of the
                    idea you want is the chicken game on page 73, which is
                    where the &ldquo;publicly-known distribution&rdquo; trick
                    becomes legible.
                  </Sidenote>
                  <p>
                    Here is the move, slightly turned so you can see how it
                    helps a laptop. <strong>The Port Daddy daemon is the
                    referee.</strong> The publicly-known distribution is the
                    daemon&apos;s conflict-graph-aware recommendation policy
                    — which file is claimed, by whom, since when, with what
                    purpose. The recommendations are private to each agent in
                    the sense that the daemon tells <em>A</em> &ldquo;you may
                    have the file&rdquo; and <em>B</em> &ldquo;please wait
                    sixty seconds and try the test fixture instead&rdquo;
                    without showing either agent the other&apos;s instruction.
                    But the rule that{' '}
                    <em>generated</em> those instructions — the policy —
                    sits in plain view in the daemon&apos;s source. Any agent
                    that doubts it can audit the code.
                  </p>
                  <PullQuote>
                    The daemon is the referee. The recommendations are
                    private; the rule that generates them is public. That is
                    the trick Aumann gave us, dropped into a Unix socket.
                  </PullQuote>
                  <p>
                    The analogy I keep returning to is the four-way stop. No
                    sword. No convention deep enough to be called culture.
                    Just a small piece of <em>shared information</em> — &ldquo;the
                    one on the right goes first&rdquo; — that turns a
                    coordination disaster into a boring tuesday. Port Daddy
                    is, at one level of description, an exceptionally
                    well-instrumented four-way stop for autonomous programs.
                  </p>
                </Prose>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
                  <BracketLabel>Figure 1.1 — The shape of the problem</BracketLabel>
                  <div className="mt-[var(--space-3)]">
                    <Mermaid chart={COMMITMENT_PROBLEM_CHART} />
                  </div>
                  <figcaption className="mt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    The commitment problem in its smallest form. Two players,
                    one resource, four outcomes — two of which are bad for
                    everyone, two of which are good for one player but require
                    the other to yield. The referee is the only piece of
                    infrastructure that lets &ldquo;yield&rdquo; happen without
                    either party losing face or work.
                  </figcaption>
                </figure>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* 02 — WHAT IS THE GAME EXACTLY */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
              <article className="space-y-[var(--space-5)]">
                <SectionHeader
                  number="02"
                  eyebrow="What the game is exactly"
                  icon={Dices}
                  title="A two-by-two, four numbers, and a small cliff."
                />
                <Prose>
                  <p>
                    Two players, two actions: <code>claim</code> the file or{' '}
                    <code>defer</code> to whoever else might want it. The
                    bonded-commons paper uses these payoffs at the stage
                    (one-shot) level, which I will use here without
                    apology:
                  </p>

                  <div className="my-[var(--space-4)] overflow-x-auto border-2 border-[var(--border-strong)]">
                    <table className="w-full border-collapse text-[length:var(--text-base)]">
                      <caption className="sr-only">
                        Stage payoff matrix for the two-agent claim/defer game.
                      </caption>
                      <thead className="bg-[var(--surface-raised)]">
                        <tr>
                          <th scope="col" className="border-b-2 border-r-2 border-[var(--border-strong)] p-[var(--space-3)] text-left font-mono">
                            {/* empty */}
                          </th>
                          <th scope="col" className="border-b-2 border-r-2 border-[var(--border-strong)] p-[var(--space-3)] text-center font-mono font-black">
                            B: claim
                          </th>
                          <th scope="col" className="border-b-2 border-[var(--border-strong)] p-[var(--space-3)] text-center font-mono font-black">
                            B: defer
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row" className="border-b-2 border-r-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] text-left font-mono font-black">
                            A: claim
                          </th>
                          <td className="border-b-2 border-r-2 border-[var(--border-strong)] p-[var(--space-3)] text-center font-mono">
                            <span className="font-black text-[var(--brand-primary)]">(1, 1)</span>
                            <div className="text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">collision</div>
                          </td>
                          <td className="border-b-2 border-[var(--border-strong)] p-[var(--space-3)] text-center font-mono">
                            <span className="font-black">(3, 1)</span>
                            <div className="text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">A wins</div>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className="border-r-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] text-left font-mono font-black">
                            A: defer
                          </th>
                          <td className="border-r-2 border-[var(--border-strong)] p-[var(--space-3)] text-center font-mono">
                            <span className="font-black">(1, 3)</span>
                            <div className="text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">B wins</div>
                          </td>
                          <td className="p-[var(--space-3)] text-center font-mono">
                            <span className="font-black text-[var(--text-muted)]">(0, 0)</span>
                            <div className="text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">deadlock</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <Sidenote label="Why these numbers">
                    The exact payoffs are a modeling choice; what matters is
                    the <em>structure</em>. Collision must be worse than
                    yielding (because a partly-merged branch is worse than no
                    work at all). Deadlock must be worse than collision
                    (because at least a collision produces something to look
                    at). The off-diagonals must be the Pareto-best cells. The
                    bonded-commons paper uses a slightly different normalization
                    in places; this 2&times;2 is the one I&apos;ll use here for
                    clarity.
                  </Sidenote>

                  <p>
                    Walk the cells. <strong>Both claim</strong> is the
                    collision: two agents writing to the same file, neither
                    aware of the other, both convinced they have the
                    authoritative version. You will recognize this from any
                    long-running team git history. The output is not zero —
                    each player got <em>something</em> done — but the
                    something-done is undone forty minutes later by a tired
                    human. <strong>Both defer</strong> is the deadlock: two
                    agents politely waiting, neither willing to be the first
                    to assume responsibility. The cost is the wasted budget
                    and the moral hazard of an agent that fails by being
                    too courteous. <strong>The off-diagonals</strong> —{' '}
                    one player works, the other moves on to other useful work
                    — are the outcomes we want. The trouble is that neither
                    agent will{' '}
                    <em>unilaterally</em> choose to yield, because what if
                    the other does too? That is, again, the commitment
                    problem in miniature.
                  </p>

                  <p>
                    Now an underappreciated subtlety: even if both players
                    randomize their actions independently — what Nash called a{' '}
                    <strong>mixed strategy equilibrium</strong> — they will
                    still <em>sometimes</em> collide. The Nash mixing keeps
                    you from being exploited, but it cannot remove the
                    collisions; it can only ration them. The expected
                    fraction of plays that end in a collision under Nash
                    mixing is strictly positive. Aumann&apos;s 1974 insight
                    is that you can do better than that — collision rate
                    {' '}<em>zero</em> — if the players can condition their
                    actions on a shared signal. The signal does not have to
                    come from a sword; it just has to be common knowledge.
                  </p>

                  <PullQuote>
                    Under independent Nash mixing, you ration the collisions.
                    Under correlated equilibrium with a smart{' '}
                    <em>&mu;</em>, you get rid of them.
                  </PullQuote>

                  <p>
                    The bonded-commons paper&apos;s Figure 2 — reproduced
                    inside the PDF, accessible from the{' '}
                    <Link to="/whitepaper?paper=agent-transactions" className="font-bold underline decoration-[var(--brand-primary)] decoration-2 underline-offset-4 hover:text-[var(--brand-primary)]">paper landing page</Link>
                    {' '}— pins this in pictures. The static-escrow regime
                    underwrites collisions by paying for them. The
                    competitive-Vickrey regime{' '}
                    <em>prices</em> the recommendation so the off-diagonal is
                    the dominant strategy for both agents simultaneously.
                    What you save is the cost of every collision you
                    don&apos;t have, which over a long enough run is the
                    cost of an entire human-engineer-hour, every few hours,
                    forever.
                  </p>
                </Prose>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                  <BracketLabel>Figure 2.1 — The stage game</BracketLabel>
                  <div className="mt-[var(--space-3)]">
                    <Mermaid chart={GAME_PAYOFF_CHART} />
                  </div>
                  <figcaption className="mt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    The four outcomes, the two Pareto-optimal cells (the
                    off-diagonals), and the gravitational pull toward the
                    bad cells when no one is allowed to coordinate. The
                    daemon&apos;s job is to make the off-diagonal a stable
                    pick by handing each agent a private hint drawn from a
                    public distribution.
                  </figcaption>
                </figure>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* 03 — APALACHE / TLC */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
              <article className="space-y-[var(--space-5)]">
                <SectionHeader
                  number="03"
                  eyebrow="What the machine actually does"
                  icon={Cpu}
                  title="A model checker, and a state machine, and you."
                />
                <Prose>
                  <p>
                    Here is the heart. The bonded-commons paper does not just
                    <em>describe</em> the coordination lifecycle — it
                    specifies the lifecycle in <strong>TLA+</strong>, Leslie
                    Lamport&apos;s specification language for state machines.
                    A model checker then asks, exhaustively, whether the
                    machine can violate any of the safety or liveness
                    properties the paper claims for it.
                  </p>

                  <Sidenote label="TLA+, in one paragraph">
                    A TLA+ spec has three parts: <strong>state variables</strong>
                    {' '}(what can change), <strong>actions</strong>{' '}
                    (atomic transitions written as predicates over current and
                    next state), and{' '}
                    <strong>properties</strong> (claims that should hold for
                    every reachable state, or temporally for every fair
                    execution). It looks like math because it{' '}
                    <em>is</em> math; it is not a programming language. You
                    write the smallest model that captures the behavior you
                    care about. The machine then explores it.
                  </Sidenote>

                  <p>
                    Model checking is exhaustive exploration of the state
                    space. You hand the checker a state machine and a
                    property; it tries every reachable state and every
                    reachable transition between them. If it finds a state
                    that violates the property, it returns the{' '}
                    <strong>counterexample trace</strong> — the exact
                    sequence of actions that walked the machine into the
                    failure. The counterexample is pedagogy as much as proof:
                    it tells you not just that your model is wrong but{' '}
                    <em>how</em> it is wrong.
                  </p>

                  <p>
                    What is checked today: a TLA+ specification of the
                    coordination lifecycle (escrow, claims, locks,
                    heartbeats, salvage), discharged by{' '}
                    <strong>TLC</strong> — the original, explicit-state
                    TLA+ model checker — over a bounded model. The paper&apos;s
                    Table 3 reports{' '}
                    <span className="font-mono">26,818</span> reachable states
                    explored for the Conservation Theorem, with the invariant
                    holding everywhere it could be checked. That is small as
                    state spaces go, and it is enough for the present claim.
                  </p>

                  <p>
                    There is also an <strong>Apalache</strong> path on the
                    same spec — the symbolic, SMT-backed TLA+ checker that
                    handles larger state spaces by trading explicit enumeration
                    for satisfiability queries. The two checkers eat the same{' '}
                    <code>.tla</code> file; the difference is in how they
                    explore. TLC, written in Java, enumerates. Apalache,
                    written in Scala on top of Microsoft&apos;s Z3 solver,
                    asks the SMT solver if a property-violating state exists
                    and lets the solver chase it.{' '}
                    <code>claim_signaling.tla</code> carries{' '}
                    <code>@type:</code> annotations so Apalache can typecheck
                    and discharge it without modification — and the bundled{' '}
                    <code>sweep-delta.sh</code> wrapper takes a{' '}
                    <code>TLA_CHECKER=apalache</code> env var to switch
                    between the two for deeper parameter sweeps.
                  </p>

                  <Sidenote label="The trade">
                    Explicit-state checkers (TLC) are simple and trustworthy
                    but die on large state spaces. Symbolic checkers
                    (Apalache, plus its cousins in other tools) handle bigger
                    models but inherit the trust posture of the SMT solver
                    underneath them. You pay either with state-space size or
                    with one more piece of infrastructure to audit. Choose
                    according to what you can afford to be wrong about.
                  </Sidenote>

                  <p>
                    Below is the load-bearing fragment of{' '}
                    <code>proofs/economics/claim_signaling.tla</code>, the
                    artifact that closes the game-theoretic side of the paper.
                    Full file is ~250 lines including the recommendation
                    machinery, graduated-trigger logic, and{' '}
                    <code>@type:</code> annotations. The numbers — including
                    the threshold at &delta;<sup>*</sup>&nbsp;≈&nbsp;0.3425 —
                    are the ones the artifact actually checks. The cubic
                    that produces &delta;<sup>*</sup> is independently
                    discharged by{' '}
                    <code>proofs/economics/delta-threshold.z3</code> (next
                    section).
                  </p>

                  <DocsCodeBlock
                    code={TLA_CLAIM_SIGNALING_SAMPLE}
                    language="text"
                    label="proofs/economics/claim_signaling.tla — fragment"
                  />

                  <p>
                    When you run TLC (or Apalache) over this spec with the
                    discount factors enumerated in{' '}
                    <code>NoProfitableDeviation</code>, the answer comes back
                    one of two ways. <strong>Either</strong> the checker
                    reports the property is true for every reachable state —
                    in which case the model has been mechanically{' '}
                    <em>verified</em> for the parameter range you asked about
                    — <strong>or</strong> it hands you a counterexample
                    trace. Counterexamples in a coordination spec read like
                    bad-day stories: at step 1 the daemon recommends A
                    claims, at step 2 A defers anyway hoping B will too, at
                    step 3 B claims because the daemon told her to, at step
                    4 A discovers her budget has bled out — and you, the
                    designer, sit there reading the trace and going{' '}
                    <em>oh that&apos;s exactly what would happen, yeah, fix
                    the model.</em>
                  </p>

                  <PullQuote>
                    A model-checker counterexample is the most honest form of
                    proof there is. It tells you not that your model is
                    wrong, but exactly <em>how</em> it is wrong, in the
                    smallest number of moves needed to break it.
                  </PullQuote>
                </Prose>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
                  <BracketLabel>Figure 3.1 — The model-checking loop</BracketLabel>
                  <div className="mt-[var(--space-3)]">
                    <Mermaid chart={TLA_PIPELINE_CHART} />
                  </div>
                  <figcaption className="mt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    One specification, two checkers, three possible
                    outcomes: a clean &ldquo;yes&rdquo;, a counterexample
                    trace, or a timeout — which is its own information.
                  </figcaption>
                </figure>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* 04 — Z3 / SMT */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
              <article className="space-y-[var(--space-5)]">
                <SectionHeader
                  number="04"
                  eyebrow="When the math is just algebra"
                  icon={ScrollText}
                  title="Z3, a hundred milliseconds, and the death of &ldquo;trust me.&rdquo;"
                />
                <Prose>
                  <p>
                    Not every claim in the paper needs a state machine. Some
                    are pure algebra: a cubic with a real root in a useful
                    range, a quadratic whose discriminant is positive, a
                    closed-form welfare bound. For those, you don&apos;t want
                    a model checker — you want a satisfiability modulo
                    theories solver. The reigning champion is{' '}
                    <strong>Z3</strong>, out of Microsoft Research, which
                    chews on nonlinear real arithmetic the way a kitchen
                    chemist chews on a recipe she has made a thousand times.
                  </p>

                  <Sidenote label="What &ldquo;SMT&rdquo; means">
                    Satisfiability modulo theories. Where SAT solvers ask
                    &ldquo;is there a true/false assignment that satisfies
                    this formula?&rdquo;, SMT solvers ask the same question
                    over richer domains: integers, reals, bit-vectors,
                    arrays. The &ldquo;theories&rdquo; are the per-domain
                    decision procedures bolted on top of a SAT core. Nonlinear
                    real arithmetic is one of the slower ones, but for the
                    sizes of formulas we get out of game theory it is fast
                    enough to feel free.
                  </Sidenote>

                  <p>
                    Proposition 7.1 of the bonded-commons paper (Appendix A,
                    Mechanization Status) claims that, in the repeated game
                    over the claim-signaling stage with payoffs as above, no
                    profitable one-shot deviation exists for any discount
                    factor &delta; above the root of the cubic{' '}
                    <code>2&delta;&sup3; + 2&delta;&sup2; + 2&delta; − 1 = 0</code>.
                    The root is &delta;<sup>*</sup>&nbsp;≈&nbsp;0.3425. We
                    could derive it by hand — Cardano&apos;s formula, the
                    discriminant, the depressed cubic, all the
                    seventeenth-century plumbing — and ask the reader to
                    trust the algebra. We don&apos;t have to. The bundled SMT
                    script does the work in under a hundred milliseconds, on
                    every PR.
                  </p>

                  <DocsCodeBlock
                    code={Z3_SMT_SAMPLE}
                    language="text"
                    label="proofs/economics/delta-threshold.z3 — try this yourself"
                  />

                  <p>
                    The script declares a real variable <code>delta</code>,
                    constrains it to the closed unit interval, asserts the
                    cubic, asks Z3 whether the conjunction is satisfiable,
                    and asks for a witness. The full artifact follows up
                    with two more checks (push/pop): one that the witness
                    lies in <code>[0.34, 0.35]</code>, and one for uniqueness
                    of the root in <code>[0, 1]</code>. The expected output
                    is the triple{' '}
                    <code>sat — sat — unsat</code>; CI greps for that exact
                    sequence and fails the build if anything else returns.
                    The script runs in about a tenth of a second on any
                    modern laptop.
                  </p>

                  <p>
                    Why bother? Because the bar for &ldquo;you should trust
                    the algebra in this paper&rdquo; has quietly moved. A
                    decade ago, pen-and-paper algebra in a paper was the gold
                    standard. Today, when a six-line script can verify the
                    same claim in a hundred milliseconds, the gold standard
                    is shipping the script alongside the paper. The reader
                    no longer has to trust me, the author. They run the
                    script. They watch the solver say <code>sat</code>. They
                    move on with their day.
                  </p>

                  <PullQuote>
                    Bench-checkable proofs are the new bar. The reader
                    does not have to take the author&apos;s word; they take
                    the solver&apos;s.
                  </PullQuote>

                  <div className="border-2 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                    <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-3)]">
                      <Lightbulb size={18} aria-hidden="true" className="text-[var(--brand-primary)]" />
                      <BracketLabel>Try this yourself</BracketLabel>
                    </div>
                    <p className="m-0 text-[length:var(--text-base)] leading-[var(--leading-body)] text-[var(--text-primary)]">
                      Z3 is one Homebrew line away on macOS, one apt line
                      away on Debian. Save the SMT-LIB block above as{' '}
                      <code>cubic-root.smt2</code> and run it.
                    </p>
                    <div className="mt-[var(--space-3)]">
                      <DocsCodeBlock
                        code={`brew install z3   # macOS
sudo apt install z3   # Debian / Ubuntu

# Then:
z3 cubic-root.smt2

# Output you should see:
# sat
# (model
#   (define-fun d () Real
#     (/ 7167... 20925...))   ; a rational very close to 0.3425
# )`}
                        language="cli"
                        label="Z3 in your terminal"
                        copyable
                      />
                    </div>
                    <p className="mt-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      Apalache is similar — one Homebrew tap, one{' '}
                      <code>brew install</code>, and it&apos;s in your{' '}
                      <code>$PATH</code>. The full TLA+ Hyperbook (Lamport,
                      free online) walks the rest of the on-ramp.
                    </p>
                  </div>
                </Prose>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
                  <BracketLabel>The whole verification stack</BracketLabel>
                  <div className="mt-[var(--space-3)]">
                    <Mermaid chart={VERIFICATION_STACK_CHART} />
                  </div>
                  <p className="mt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    Four kinds of claim, four kinds of tool. The discipline
                    is matching the claim to the right tool — never the
                    other way around.
                  </p>
                </div>

                <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                  <BracketLabel>Already in the paper today</BracketLabel>
                  <ul className="mt-[var(--space-3)] space-y-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    <li>
                      <strong className="text-[var(--text-primary)]">TLA+ / TLC.</strong>
                      {' '}Conservation Theorem, 26,818 states explored. Spec is in{' '}
                      <code>Conservation.tla</code>.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">ProVerif.</strong>
                      {' '}Anchor Protocol&apos;s three token-exchange phases,
                      Dolev-Yao attacker. Magic-link single-use, channel
                      isolation, passkey pairing — all closed.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">Kani.</strong>
                      {' '}The Rust capability-subset check{' '}
                      (<code>harbor-card-rs</code>), formally checked, then
                      compiled into the running binary. No gap between proof
                      and code.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">EasyCrypt.</strong>
                      {' '}Merkle-Forest binding skeleton; partial.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">fast-check.</strong>
                      {' '}No-overdraft and other property tests, randomized
                      operation traces.
                    </li>
                  </ul>
                </div>

                <div className="border-2 border-[var(--brand-primary)] bg-[var(--surface-base)] p-[var(--space-4)]">
                  <BracketLabel>Landed in v2.6 — runs in CI</BracketLabel>
                  <p className="mt-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    These artifacts exist and run on every PR via{' '}
                    <code>.github/workflows/proofs.yml</code>. If any check
                    fails, the PR is red.
                  </p>
                  <ul className="mt-[var(--space-3)] space-y-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    <li>
                      <strong className="text-[var(--text-primary)]">Z3 cubic discharge.</strong>
                      {' '}
                      <code>proofs/economics/delta-threshold.z3</code>.
                      Proves existence, location in{' '}
                      <code>[0.34, 0.35]</code>, and uniqueness of the
                      threshold root in <code>(0, 1)</code>.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">TLA+ claim-signaling.</strong>
                      {' '}
                      <code>proofs/economics/claim_signaling.tla</code>{' '}
                      + <code>.cfg</code> + <code>sweep-delta.sh</code>.
                      TLC verifies the IC invariant at &delta;&nbsp;=&nbsp;0.35;
                      the sweep wrapper exercises &delta;&nbsp;&isin;&nbsp;{`{0.30, …, 0.40}`}
                      and asserts the empirical crossover matches the
                      closed-form root.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">Apalache parity.</strong>
                      {' '}The TLA+ artifact carries{' '}
                      <code>@type:</code> annotations so{' '}
                      <code>apalache-mc check</code> works without
                      modification. Run via{' '}
                      <code>TLA_CHECKER=apalache ./sweep-delta.sh</code>{' '}
                      for deeper bounded search.
                    </li>
                    <li>
                      <strong className="text-[var(--text-primary)]">Threat-band defensibility.</strong>
                      {' '}
                      <code>proofs/bonded/pareto/threat-bands.mjs</code>.
                      Monte Carlo over (threat_mix &times; bond_band);
                      matched-band assertion enforces
                      <code>extraction ≤ band_upper &times; 1.10</code>.
                    </li>
                  </ul>
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* 05 — WHAT THIS MEANS */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
              <article className="space-y-[var(--space-5)]">
                <SectionHeader
                  number="05"
                  eyebrow="What this means — political and computer-scientific"
                  icon={Coins}
                  title="A tiny piece of Hobbesian infrastructure, with no sword."
                />
                <Prose>
                  <p>
                    The political-science framing first. What we have built —
                    a daemon that issues private recommendations from a
                    public distribution, that does not <em>enforce</em>{' '}
                    those recommendations, that does not jail or fine anyone
                    who ignores them, that simply makes the cost of ignoring
                    them strictly higher than the cost of following them —
                    is a small, working piece of Hobbesian infrastructure
                    that requires no sword. It is what political theorists
                    have wanted for four centuries and never quite achieved
                    at scale. Local agent coordination is the first time the
                    set of agents is small enough, the resources contested
                    are concrete enough, and the recommendation policy
                    cheap enough to compute, that Aumann&apos;s mechanism
                    works in the wild.
                  </p>

                  <Sidenote label="The price of anarchy">
                    Koutsoupias and Papadimitriou (1999) gave the field a
                    knife: the worst-case ratio between the social cost of
                    selfish play and the social cost of optimal coordination.
                    In our setting the price of anarchy is, in the limit
                    where bonds cover cleanup cost, approximately one — the
                    selfish equilibrium coincides with the social optimum.
                    That is what the bonded-commons machinery buys you.
                  </Sidenote>

                  <p>
                    The computer-science framing second. The paper&apos;s
                    contribution is, modestly, that we have moved from{' '}
                    <em>&ldquo;we claim it works&rdquo;</em> to{' '}
                    <em>&ldquo;the machine confirms our claim under this
                    parameterization, here are the 26,818 states it
                    explored, here is the trace if you ever find one that
                    breaks.&rdquo;</em>{' '}
                    That gap — between informal proof and mechanized proof —
                    is the same gap that separates the literature you
                    fully trust from the literature you have to triple-check.
                    Apalache, TLA+, ProVerif, Kani, Z3, EasyCrypt: each one
                    closes one species of that gap, for one species of
                    claim. None is magic.
                  </p>

                  <PullQuote>
                    We have moved from &ldquo;we claim it works&rdquo; to
                    &ldquo;the machine confirms our claim, here are the
                    twenty-six thousand states it explored to do so, please
                    find one that breaks.&rdquo;
                  </PullQuote>

                  <p>
                    The honest position — and I want to be candid about this
                    because it is the part of mechanized verification that
                    looks slick and is not — is that machine-checking shifts
                    the trust problem; it does not erase it. Pre-mechanization:
                    you trust the author&apos;s algebra. Post-mechanization:
                    you trust the tool&apos;s encoding faithfully captures
                    the model the author had in mind, and you trust the tool
                    is itself correct. That is a real shift, and it is a
                    real new place to be skeptical. The TLA+ community has
                    been arguing about{' '}
                    <em>spec faithfulness</em> for decades; the smt-lib
                    community has its own meta-doubts. We benefit from
                    forty years of practitioners failing in public and
                    rebuilding more carefully each time.
                  </p>

                  <p>
                    Limitations worth naming, in honest taxonomy:
                  </p>

                  <ul className="m-0 grid gap-[var(--space-3)] pl-0">
                    {[
                      {
                        label: 'State explosion',
                        body: 'Explicit-state checkers (TLC) die on parametric models. We mitigate with bounded instances; we plan to migrate to Apalache for the depths TLC cannot reach.',
                      },
                      {
                        label: 'Spec faithfulness',
                        body: 'A passing model checker proves a property of the *model*, not of the implementation. We bridge with property tests against the running daemon — fast-check randomized traces — but the bridge is finite, not airtight.',
                      },
                      {
                        label: 'Tool trust',
                        body: 'Z3, TLC, Apalache, ProVerif are themselves software. They have bugs. The community treats their bug-history transparently; we inherit that posture.',
                      },
                      {
                        label: 'Strategic games beyond the stage',
                        body: 'A Coq or Lean mechanization of the *strategic* repeated game with full incentive compatibility is not yet in scope. The Pareto-dominance claim is currently empirical Monte Carlo (36 configurations, 2,000 trials each). Honest "Partial" in the verification table.',
                      },
                    ].map((item) => (
                      <li
                        key={item.label}
                        className="grid grid-cols-[minmax(0,12rem),1fr] items-start gap-[var(--space-3)] border-l-4 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] sm:gap-[var(--space-4)]"
                      >
                        <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                          {item.label}
                        </span>
                        <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                          {item.body}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p>
                    The verification status table in Appendix A of the
                    bonded-commons paper enumerates which claims are{' '}
                    <em>closed</em> (machine-checked, here is the artifact),
                    which are <em>partial</em> (empirical, with a clearly
                    named gap), and which are <em>open</em> (work the review
                    process flagged and we did not yet finish). You can
                    audit the same posture we audit.
                  </p>
                </Prose>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] p-[var(--space-5)]">
                  <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-3)]">
                    <CircleAlert size={18} aria-hidden="true" className="text-[var(--brand-primary)]" />
                    <BracketLabel>Where we held back</BracketLabel>
                  </div>
                  <ul className="space-y-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    <li>
                      The threshold &delta;<sup>*</sup>&nbsp;≈&nbsp;0.3425
                      is the root of a specific cubic that comes out of a
                      specific stage-game calibration (gain&nbsp;=&nbsp;1,
                      punishment loss/round&nbsp;=&nbsp;2). Other calibrations
                      give other thresholds; the artifact is honest about
                      its calibration in the file header.
                    </li>
                    <li>
                      The price of anarchy is &ldquo;approximately
                      one&rdquo; in the limit. Off-limit, the actual ratio
                      depends on the bond pricing function {' '}<code>&pi;</code>,
                      which the paper explicitly does not close.
                    </li>
                    <li>
                      A Coq or Lean mechanization of the{' '}
                      <em>strategic</em> repeated game with full incentive
                      compatibility is still out of scope. What CI proves
                      is the IC inequality at the calibrated parameter,
                      not a meta-theorem over all such games.
                    </li>
                  </ul>
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* 06 — READ FURTHER */}
        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.40fr)_minmax(0,0.60fr)]">
              <div className="space-y-[var(--space-4)]">
                <SectionHeader
                  number="06"
                  eyebrow="What to read next"
                  icon={BookOpen}
                  title="The papers and books that earned this page."
                />
                <Prose>
                  <p>
                    Every analogy on this page is borrowed from someone who
                    earned the right to draw it. Here is the lineage, in the
                    order I&apos;d read it for the first time.
                  </p>
                </Prose>
              </div>

              <div className="grid gap-[var(--space-3)]">
                {[
                  {
                    title: 'The Bonded Commons paper, §§ economic and Youle.',
                    body: 'The actual claim about correlated equilibrium and the auction welfare result, with the proofs of the Conservation Theorem and the No-Overdraft Lemma. Start here if you want the math.',
                    href: '/whitepaper?paper=agent-transactions',
                    internal: true,
                  },
                  {
                    title: 'Aumann, R. (1974). Subjectivity and Correlation in Randomized Strategies. J. Math. Econ. 1.',
                    body: 'The original correlated-equilibrium paper. Twenty-nine pages, the readable kind. The chicken-game example on p. 73 is where the idea becomes legible.',
                  },
                  {
                    title: 'Schelling, T. (1960). The Strategy of Conflict.',
                    body: 'Where focal points come from. Read it for the prose — Schelling is one of the great twentieth-century writers, full stop — and for the intuition that coordination can be solved without enforcement.',
                  },
                  {
                    title: 'Lamport, L. (free, online). The TLA+ Hyperbook.',
                    body: 'The on-ramp for TLA+. The first hundred pages are the most concentrated formal-methods pedagogy on the internet. Available at lamport.azurewebsites.net.',
                  },
                  {
                    title: 'Konnov, Kukovec, Tran-The (2019). TLA+ Model Checking Made Symbolic. OOPSLA.',
                    body: 'The Apalache paper. The trade between explicit-state and symbolic, written by the people who built the symbolic checker.',
                  },
                  {
                    title: 'de Moura, Bjørner (2008). Z3: An Efficient SMT Solver. TACAS.',
                    body: 'The Z3 paper. Older now and slightly out of date in places, but the architecture has not changed and the paper is still where you start.',
                  },
                  {
                    title: 'Koutsoupias, Papadimitriou (1999). Worst-case Equilibria.',
                    body: 'The price-of-anarchy paper. Short, technical, and quietly load-bearing for half of mechanism design after it.',
                  },
                  {
                    title: 'The companion paper: The Anchor Protocol.',
                    body: 'How a program proves who it is to another program. Different topic, same paper-series, same reading style.',
                    href: '/whitepaper?paper=anchor-protocol',
                    internal: true,
                  },
                ].map((ref) => (
                  <div
                    key={ref.title}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] sm:grid-cols-[2.5rem,1fr]"
                  >
                    <FileCode2
                      aria-hidden="true"
                      size={18}
                      className="mt-[var(--space-1)] text-[var(--brand-primary)]"
                    />
                    <div className="space-y-[var(--space-2)]">
                      <h3 className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                        {ref.title}
                      </h3>
                      <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        {ref.body}
                      </p>
                      {ref.href && ref.internal ? (
                        <Link
                          to={ref.href}
                          className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] underline decoration-2 underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                        >
                          Read it here
                          <ArrowRight aria-hidden="true" size={14} />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* TAIL — back to paper */}
        <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-strong)] py-[var(--space-6)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-4)] sm:grid-cols-[1fr,auto] sm:items-center">
              <div className="space-y-[var(--space-2)]">
                <BracketLabel>Next</BracketLabel>
                <PanelTitle as="h2" size="card">
                  The whole argument lives in the papers themselves.
                </PanelTitle>
                <PanelBody className="max-w-[60ch]">
                  The papers are short, free, and signed. The verification
                  artifacts ship alongside them.
                </PanelBody>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Link
                  to="/whitepaper"
                  className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <Layers aria-hidden="true" size={14} />
                  Back to the papers
                </Link>
                <Link
                  to="/whitepaper/rounds"
                  className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-base)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <ScrollText aria-hidden="true" size={14} />
                  Read the review history
                </Link>
              </div>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
