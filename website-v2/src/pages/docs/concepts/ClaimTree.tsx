import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUp, ArrowDown, Folder, FileCode, Hash, Box, Bookmark, AlignLeft, CheckCircle2, AlertTriangle, Layers, Network } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

/**
 * /docs/concepts/claim-tree — Reader's guide to PD's multi-granularity
 * coordination structure. Companion to ADR-0038; ADR is the
 * specification, this is the explanation.
 *
 * Renders ten distinct visualization modes on one running example so
 * readers see what the tree feels like before any code lands.
 */
export default function ClaimTree() {
  return (
    <div className="space-y-12">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="teal">Concept</Badge>
          <Badge variant="accent">Substrate</Badge>
          <Badge variant="success">Proposed v1</Badge>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-5xl">
          The Claim Tree
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
          Port Daddy's multi-granularity coordination structure. One hierarchical
          tree of claimable units — repo, directory, file, AST symbol, AST block,
          fenced region — that lets agents work in the same codebase without
          stepping on each other, and lets operators ask{' '}
          <em className="text-[var(--text-primary)]">"where is the swarm right now?"</em>{' '}
          with a single query.
        </p>
        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link
            to="/docs/adr/0038-claim-tree"
            className="inline-flex items-center gap-1 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          >
            Read the spec (ADR-0038) <ArrowRight size={14} />
          </Link>
          <Link
            to="/docs/concepts/primitives"
            className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            See the primitives this builds on <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── Questions it answers ─────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          The questions it answers
        </h2>
        <p className="text-[var(--text-secondary)]">
          These are the questions Port Daddy's existing flat claim table can't
          answer well. The claim tree was designed so each one becomes a single
          indexed SQL query.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { q: 'Anything claimed under lib/auth/?', kind: 'push-down', icon: ArrowDown },
            { q: 'Does this commit touch a symbol another agent is editing?', kind: 'bubble-up', icon: ArrowUp },
            { q: 'Two of us want to edit auth.ts — same function or different?', kind: 'overlap', icon: AlertTriangle },
            { q: 'Show me where the swarm is concentrating right now.', kind: 'aggregate', icon: Network },
          ].map(({ q, kind, icon: Icon }) => (
            <div
              key={q}
              className="flex items-start gap-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
            >
              <Icon size={18} className="mt-0.5 shrink-0 text-[var(--brand-accent)]" />
              <div className="space-y-1">
                <p className="font-mono text-[15px] leading-snug text-[var(--text-primary)]">
                  &ldquo;{q}&rdquo;
                </p>
                <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {kind} query
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Mental model: two trees joined at the file ───────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          The mental model: two trees, joined at the file
        </h2>
        <p className="text-[var(--text-secondary)]">
          Picture your repo as two overlapping trees. The filesystem tree is
          paths; the AST tree is code structure inside each file. The claim
          tree <strong className="text-[var(--text-primary)]">joins them at the file</strong>{' '}
          — every file node has children from its AST when symbol-index data is
          available.
        </p>
        <TwoTreesDiagram />
        <p className="text-sm text-[var(--text-muted)]">
          You don't need to think about AST when you{' '}
          <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5 font-mono text-[13px]">
            pd add lib/auth.ts
          </code>
          . The tree degrades gracefully to file granularity. But when symbol
          data is available, you can claim a specific function instead of the
          whole file — and let someone else claim a different function in the
          same file without conflict.
        </p>
      </section>

      {/* ── Node kinds ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Node kinds
        </h2>
        <p className="text-[var(--text-secondary)]">
          Every node in the tree has a kind that determines what it represents
          and how stable its identity is across refactors.
        </p>
        <div className="overflow-x-auto border-2 border-[var(--border-strong)]">
          <table className="min-w-full divide-y-2 divide-[var(--border-strong)] text-sm">
            <thead className="bg-[var(--surface-raised)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Example identifier</th>
                <th className="px-4 py-3">Stability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)] bg-[var(--surface-base)]">
              <NodeKindRow
                icon={Folder}
                kind="repo"
                example="repo:port-daddy"
                stability="Stable"
                stabilityTone="success"
                desc="The repo root"
              />
              <NodeKindRow
                icon={Folder}
                kind="dir"
                example="dir:lib/auth/"
                stability="Stable (path)"
                stabilityTone="success"
                desc="Directory; descendants are its files + subdirs"
              />
              <NodeKindRow
                icon={FileCode}
                kind="file"
                example="file:lib/auth.ts"
                stability="Stable (path)"
                stabilityTone="success"
                desc="One file; descendants are its AST nodes"
              />
              <NodeKindRow
                icon={Hash}
                kind="symbol"
                example="symbol:lib/auth.ts:AuthService.signToken"
                stability="High (rename detected)"
                stabilityTone="success"
                desc="Named function / class / method. Primary claim unit."
              />
              <NodeKindRow
                icon={Box}
                kind="block"
                example="block:lib/auth.ts:signToken.body.if[0]"
                stability="High (AST-anchored)"
                stabilityTone="success"
                desc="Unnamed AST block — switch case, arrow expr, etc."
              />
              <NodeKindRow
                icon={Bookmark}
                kind="fenced"
                example="fenced:lib/auth.ts:auth-validation"
                stability="Operator-visible"
                stabilityTone="info"
                desc={`Marked region: // PD-CLAIM-BEGIN <slug> ... // PD-CLAIM-END`}
              />
              <NodeKindRow
                icon={AlignLeft}
                kind="region"
                example="region:lib/auth.ts:120-180"
                stability="Low (fallback only)"
                stabilityTone="warning"
                desc="Line range — degrades when AST unavailable. Soft-expires on file edit."
              />
            </tbody>
          </table>
        </div>
        <div className="border-l-4 border-[var(--brand-accent)] bg-[var(--surface-raised)] p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            Why not just line ranges?
          </strong>{' '}
          Line numbers are the wrong frame of reference for code. Add an import
          at the top of a file and every line shifts. Two agents that{' '}
          <em className="text-[var(--text-primary)]">should</em> be coordinating
          end up with overlapping line ranges that no longer touch the same
          code. The AST-anchored model treats{' '}
          <code className="font-mono text-[13px]">AuthService.signToken</code>{' '}
          as the stable identity; whether it lives on lines 120-180 today or
          130-190 tomorrow, claims still point at the same thing.
        </div>
      </section>

      {/* ── Claim modes (MGL) ────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Claim modes
        </h2>
        <p className="text-[var(--text-secondary)]">
          When a session claims a node, it picks a mode that signals what it
          intends to do. Modes mirror multi-granularity locking from database
          systems (Gray, 1976):
        </p>
        <div className="overflow-x-auto border-2 border-[var(--border-strong)]">
          <table className="min-w-full divide-y-2 divide-[var(--border-strong)] text-sm">
            <thead className="bg-[var(--surface-raised)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Long name</th>
                <th className="px-4 py-3">Means</th>
                <th className="px-4 py-3">Compatible with</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)] bg-[var(--surface-base)] font-mono text-[14px]">
              <ModeRow code="S" name="shared" meaning="I'll read this; others may read too" compat="S, IS" />
              <ModeRow code="X" name="exclusive" meaning="I'm writing this; nobody else should" compat="(nothing)" />
              <ModeRow code="IS" name="intention-shared" meaning="I have S on a descendant" compat="IS, IX, S" />
              <ModeRow code="IX" name="intention-exclusive" meaning="I have X on a descendant" compat="IS, IX" />
              <ModeRow code="SIX" name="shared + intention-exclusive" meaning="S on this node + X somewhere below" compat="IS" />
            </tbody>
          </table>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          For most PD work, the pattern is{' '}
          <strong className="text-[var(--text-primary)]">
            IX on the directory → IX on the file → X on the symbol
          </strong>
          . The agent never sees the modes unless they're debugging —{' '}
          <code className="font-mono text-[13px]">pd add lib/auth.ts:signToken</code>{' '}
          sets the right intention modes automatically.
        </p>
      </section>

      {/* ── Two query directions ─────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          The two query directions
        </h2>
        <p className="text-[var(--text-secondary)]">
          The tree's value is that one structure supports both directions of
          question — both are O(depth × claims), single SQL query with an index
          on{' '}
          <code className="font-mono text-[13px]">parent_id</code>.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <QueryDirectionCard
            title="Push-down: what's claimed under here?"
            direction="down"
            description={`Walk the subtree from the starting node, collect every active claim at any descendant. Returns "two sessions are active under lib/auth/."`}
          />
          <QueryDirectionCard
            title="Bubble-up: is this thing claimed anywhere?"
            direction="up"
            description={`Walk from a leaf upward; the first ancestor with a non-IS/IX claim is the most specific match. Returns the most-specific session holding a claim on or above the target.`}
          />
        </div>
      </section>

      {/* ── Running example for the gallery ──────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Running example
        </h2>
        <p className="text-[var(--text-secondary)]">
          Every visualization in the gallery below renders this same tree
          state, so you can compare how each mode reveals different things.
        </p>
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5 font-mono text-[14px] leading-relaxed">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Three sessions active
          </div>
          <SessionLegend color="oklch(0.72 0.15 280)" id="session-12abc" agent="gardener" intent="refactoring AuthService.signToken" />
          <SessionLegend color="oklch(0.72 0.18 35)" id="session-56def" agent="you" intent="adding AuthService.refreshToken" />
          <SessionLegend color="oklch(0.78 0.12 145)" id="session-78ghi" agent="qa" intent="writing tests under tests/unit/auth/" />
        </div>
      </section>

      {/* ── Visualization gallery ────────────────────────────────────── */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Visualization gallery
          </h2>
          <p className="text-[var(--text-secondary)]">
            Ten distinct ways to render the same claim-tree state. Each one
            answers a different question; pick the one that fits the question
            you're asking.
          </p>
        </div>

        <Mode
          letter="A"
          title="ASCII tree (CLI default)"
          subtitle="`pd claims tree`"
          rationale="The terminal-native view. Glyphs encode kind; ANSI color encodes conflict severity. Default output of `pd claims tree`."
        >
          <DocsCodeBlock
            label="$ pd claims tree"
            code={`repo:port-daddy                              [3 sessions, 6 claims]
├── lib/                                     [2 sessions, IX]
│   ├─● auth.ts                              [2 sessions, MEDIUM]
│   │   ├─◆ AuthService.signToken           [session-12abc gardener, X, 8m]
│   │   └─◆ AuthService.refreshToken        [session-56def you, X, NOW]
│   └─● tuples.ts                            [session-12abc, S]
└── tests/
    └── unit/
        └── auth/                            [session-78ghi, IX]
            ├─● signToken.test.ts            [session-78ghi qa, X, 3m]
            └─● refreshToken.test.ts         [session-78ghi qa, X, 3m]

Glyphs:  ● file   ▪ region   ◆ symbol   ◆▾ block-inside-symbol   ⌗ fenced
Colors:  green = S/IS    amber = IX/SIX    red = X    bold red = conflict`}
          />
        </Mode>

        <Mode
          letter="B"
          title="Annotated file tree (web sidebar)"
          subtitle="Web console default"
          rationale="Standard collapsible tree component. Each row shows claim count chips and risk severity; click for the detail pane with diff, subscribe, and DM actions."
        >
          <AnnotatedFileTreeMock />
        </Mode>

        <Mode
          letter="C"
          title="Squarified treemap"
          subtitle="Whole-repo at a glance"
          rationale='"Where is the swarm right now?" in one screen. Each file is a rectangle; area ∝ LOC; color = ownership (one hue per session); border thickness = conflict severity.'
        >
          <TreemapSvg />
        </Mode>

        <Mode
          letter="D"
          title="Sunburst / icicle"
          subtitle="Compact for deep trees"
          rationale="Radial alternative when the tree is deep. Center is the repo root; each ring outward is one level deeper; slice angle ∝ LOC."
        >
          <SunburstSvg />
        </Mode>

        <Mode
          letter="E"
          title="Force-directed graph with imports"
          subtitle="Adds coupling structure"
          rationale="Tree edges are parent-child; extra edges are imports. Color halo encodes claim ownership. Spotlights coupling — useful for asking who imports the thing you're about to change."
        >
          <ForceGraphSvg />
        </Mode>

        <Mode
          letter="F"
          title="Per-session Gantt ribbon"
          subtitle="Retrospective"
          rationale="Time on the X axis; one row per session. Horizontal bars show which claims were active during each session's lifetime. Overlapping bars at the same x-position = simultaneous claims."
        >
          <GanttSvg />
        </Mode>

        <Mode
          letter="G"
          title="Topographic contour map"
          subtitle="Claim density"
          rationale={`Each node's claim count is its "elevation"; contour lines drawn at constant elevations. Operator scan: "where are the peaks?" → coordination hotspots.`}
        >
          <ContourSvg />
        </Mode>

        <Mode
          letter="H"
          title="Calendar heatmap"
          subtitle="Per-day activity"
          rationale="GitHub-contributions-style grid; cell darkness is total claim activity that day. Reveals the project's rhythm — weekday peaks, weekend valleys, incident spikes."
        >
          <CalendarHeatmap />
        </Mode>

        <Mode
          letter="I"
          title="Sankey flow"
          subtitle="Claim lifecycle"
          rationale="Left axis: claim creation source. Right axis: claim resolution. Bands ∝ count. For monthly reports: how do claims arise and resolve? Which sources produce zombies?"
        >
          <SankeySvg />
        </Mode>

        <Mode
          letter="J"
          title="Streamgraph: claim depth over time"
          subtitle="Granularity story"
          rationale={`Stacked area showing how many claims are active at each granularity. Tells the story: "we started broad with file-level claims; by mid-day the symbol-level claims dominated."`}
        >
          <StreamgraphSvg />
        </Mode>
      </section>

      {/* ── Worked examples ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Worked examples
        </h2>

        <WorkedExample title="Two agents on the same file, different functions" tone="success">
          <ScenarioStep t="T+0:00" actor="session-A">
            <code className="font-mono text-[13px]">pd add lib/auth.ts:signToken</code>
            {' — '}claim X on the signToken symbol (auto-IX on file, dir, repo).
          </ScenarioStep>
          <ScenarioStep t="T+0:30" actor="session-B">
            <code className="font-mono text-[13px]">pd add lib/auth.ts:refreshToken</code>{' '}
            — claim X on a <em>different</em> symbol. IX on the parent file is
            compatible with another IX, so no conflict at symbol level.
            Ambient broker injects a LOW-risk warning into session-B's next
            turn naming session-A. Both proceed.
          </ScenarioStep>
          <ScenarioStep t="T+15:00" actor="session-A">
            <code className="font-mono text-[13px]">pd done</code> — releases the
            signToken claim. Session-B keeps its claim and continues.
          </ScenarioStep>
        </WorkedExample>

        <WorkedExample title="Real overlap → high-risk warning" tone="warning">
          <ScenarioStep t="T+0:00" actor="session-A">
            Claims X on <code className="font-mono text-[13px]">signToken</code>.
          </ScenarioStep>
          <ScenarioStep t="T+5:00" actor="session-B">
            Also tries to claim X on <code className="font-mono text-[13px]">signToken</code>.
            Query bubbles up; finds existing X by session-A → overlap risk
            HIGH (same symbol). Broker top-of-context for B suggests{' '}
            <code className="font-mono text-[13px]">pd inbox send session-A</code>{' '}
            or <code className="font-mono text-[13px]">pd unlock --force</code>.
            B is not hard-refused; the shim warns and proceeds if B presses
            on.
          </ScenarioStep>
        </WorkedExample>

        <WorkedExample title="Lock escalation under heavy density" tone="info">
          <ScenarioStep t="T+0:00" actor="session-A">
            Claims X on 5 files under <code className="font-mono text-[13px]">lib/</code>:
            auth.ts, jwt.ts, session.ts, cookies.ts, user.ts.
          </ScenarioStep>
          <ScenarioStep t="T+0:01" actor="daemon">
            Detects 5 sibling claims under the same parent. Emits an
            escalation suggestion to session-A:{' '}
            <code className="font-mono text-[13px]">pd add lib/ --mode SIX --intent "auth subsystem refactor"</code>.
            One parent claim replaces five child claims; ancestor queries
            find one record instead of five.
          </ScenarioStep>
        </WorkedExample>

        <WorkedExample title="Contested claim → faster GC" tone="warning">
          <ScenarioStep t="T+0:00" actor="session-A">
            Claims X on signToken. Walks away. Doesn't release.
          </ScenarioStep>
          <ScenarioStep t="T+2h, T+3h, T+6h" actor="sessions-B,C,D">
            Three other sessions attempt to touch signToken. Each gets HIGH
            overlap warnings. Contest pressure on session-A's claim = 3.
          </ScenarioStep>
          <ScenarioStep t="T+6h" actor="daemon">
            GC half-life accelerates:{' '}
            <code className="font-mono text-[13px]">contest=3 → effective_idle_threshold ≈ 12d</code>{' '}
            (down from default 30d). Top-of-context to session-A: "your claim
            is being contested by 3 other sessions. If you're done, run pd
            release."
          </ScenarioStep>
        </WorkedExample>
      </section>

      {/* ── Where it pays off / where it's overkill ──────────────────── */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 border-2 border-[var(--success)] bg-[var(--surface-raised)] p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-[var(--success)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              The tree pays off when
            </h3>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>Multiple agents work in the same repo simultaneously</li>
            <li>Refactors touch the same file but different functions</li>
            <li>Operators want to ask "where is the swarm?" questions</li>
            <li>You want to attribute cost / risk / coupling at function granularity</li>
            <li>You eventually want PD to distribute across machines (CRDT shape is ready)</li>
          </ul>
        </div>
        <div className="space-y-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-[var(--text-muted)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              The tree is overkill when
            </h3>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>You only ever want file-level claims (no symbols, no regions)</li>
            <li>You have one agent per project and no concurrent work</li>
            <li>You don't care about retrospective analytics</li>
          </ul>
        </div>
      </section>

      {/* ── Further reading ──────────────────────────────────────────── */}
      <section className="space-y-3 border-t-2 border-[var(--border-strong)] pt-8">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
          Reading further
        </h2>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <ReadingLink to="/docs/adr/0038-claim-tree" title="ADR-0038 — Claim Tree" desc="The formal specification: data structure, API, storage schema, migration phasing." />
          <ReadingLink to="/docs/adr/0037-git-access-control-and-pd-feature-verbs" title="ADR-0037 — Git access control" desc="The verb layer that produces claim-tree writes: pd feature / pd add / pd commit / pd push." />
          <ReadingLink to="/docs/concepts/primitives" title="Substrate primitives" desc="Sessions, tuples, pheromones, harbors — the layers the tree sits on top of." />
          <ReadingLink href="https://martin.kleppmann.com/papers/move-op.pdf" title="Kleppmann (2021) — Movable tree CRDTs" desc="The CRDT semantics PD's op log conforms to for future distribution." external />
        </div>
      </section>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function NodeKindRow({
  icon: Icon, kind, example, stability, stabilityTone, desc,
}: { icon: any; kind: string; example: string; stability: string; stabilityTone: 'success' | 'info' | 'warning'; desc: string }) {
  const tone = {
    success: 'border-[var(--success)] text-[var(--success)]',
    info: 'border-[var(--info)] text-[var(--info)]',
    warning: 'border-[var(--warning)] text-[var(--warning)]',
  }[stabilityTone]
  return (
    <tr>
      <td className="px-4 py-3"><Icon size={18} className="text-[var(--text-muted)]" /></td>
      <td className="px-4 py-3 align-top">
        <div className="font-mono text-[14px] font-semibold text-[var(--text-primary)]">{kind}</div>
        <div className="text-xs text-[var(--text-muted)]">{desc}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <code className="font-mono text-[13px] text-[var(--text-secondary)]">{example}</code>
      </td>
      <td className={`px-4 py-3 align-top`}>
        <span className={`inline-block border-2 px-2 py-0.5 text-xs font-semibold ${tone}`}>{stability}</span>
      </td>
    </tr>
  )
}

function ModeRow({ code, name, meaning, compat }: { code: string; name: string; meaning: string; compat: string }) {
  return (
    <tr>
      <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{code}</td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{name}</td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{meaning}</td>
      <td className="px-4 py-3 text-[var(--text-muted)]">{compat}</td>
    </tr>
  )
}

function SessionLegend({ color, id, agent, intent }: { color: string; id: string; agent: string; intent: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="inline-block h-3 w-3 shrink-0" style={{ backgroundColor: color }} aria-hidden />
      <span className="text-[var(--text-primary)]">{id}</span>
      <span className="text-[var(--text-secondary)]">({agent})</span>
      <span className="text-[var(--text-muted)]">— {intent}</span>
    </div>
  )
}

function QueryDirectionCard({ title, direction, description }: { title: string; direction: 'up' | 'down'; description: string }) {
  return (
    <div className="space-y-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
      <div className="flex items-center gap-2">
        {direction === 'down' ? <ArrowDown size={18} className="text-[var(--brand-accent)]" /> : <ArrowUp size={18} className="text-[var(--brand-accent)]" />}
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
      <pre className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-base)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
{direction === 'down' ? `lib/   ← start here
  auth.ts
    signToken    ← claim X
    refreshToken ← claim X
  tuples.ts      ← claim S` : `signToken          ← start here
  → up to file:auth.ts
    → up to dir:lib/  ← claim IX found here
      (descendant claims revealed)`}
      </pre>
    </div>
  )
}

function Mode({ letter, title, subtitle, rationale, children }: { letter: string; title: string; subtitle: string; rationale: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--brand-accent)] text-lg font-bold text-[var(--text-inverse)]">
          {letter}
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <div className="text-sm font-mono text-[var(--text-muted)]">{subtitle}</div>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed pt-1">{rationale}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function WorkedExample({ title, tone, children }: { title: string; tone: 'success' | 'warning' | 'info'; children: React.ReactNode }) {
  const border = {
    success: 'border-[var(--success)]',
    warning: 'border-[var(--warning)]',
    info: 'border-[var(--info)]',
  }[tone]
  return (
    <div className={`space-y-3 border-l-4 ${border} bg-[var(--surface-raised)] p-5`}>
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ScenarioStep({ t, actor, children }: { t: string; actor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_120px_1fr] items-baseline gap-3 text-sm">
      <span className="font-mono text-[var(--text-muted)]">{t}</span>
      <span className="font-mono text-[var(--text-primary)]">{actor}</span>
      <span className="text-[var(--text-secondary)] leading-relaxed">{children}</span>
    </div>
  )
}

function ReadingLink({ to, href, title, desc, external }: { to?: string; href?: string; title: string; desc: string; external?: boolean }) {
  const body = (
    <div className="space-y-1">
      <div className="flex items-center gap-1 font-semibold text-[var(--text-primary)]">
        {title}
        <ArrowRight size={14} className="text-[var(--text-muted)]" />
      </div>
      <div className="text-[var(--text-secondary)]">{desc}</div>
    </div>
  )
  if (external && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 hover:bg-[var(--surface-hover)]">
        {body}
      </a>
    )
  }
  return (
    <Link to={to!} className="block border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 hover:bg-[var(--surface-hover)]">
      {body}
    </Link>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Inline SVG visualizations
// ──────────────────────────────────────────────────────────────────────

const COLOR_A = 'oklch(0.72 0.15 280)'  // gardener (purple)
const COLOR_B = 'oklch(0.72 0.18 35)'   // you (orange)
const COLOR_C = 'oklch(0.78 0.12 145)'  // qa (green)
const COLOR_UNCLAIMED = 'var(--border-soft)'

function TwoTreesDiagram() {
  return (
    <svg viewBox="0 0 800 320" className="h-auto w-full border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]" aria-label="Two trees joined at the file">
      <defs>
        <marker id="join-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--brand-accent)" />
        </marker>
      </defs>
      {/* Title labels */}
      <text x="200" y="30" textAnchor="middle" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">filesystem tree</text>
      <text x="600" y="30" textAnchor="middle" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">AST tree (per file)</text>

      {/* Filesystem tree (left) */}
      <g transform="translate(60, 60)" className="font-mono text-[13px]">
        <TreeNode x={0} y={0} label="port-daddy/" />
        <TreeNode x={20} y={28} label="lib/" />
        <TreeNode x={40} y={56} label="auth.ts" highlight />
        <TreeNode x={40} y={84} label="tuples.ts" />
        <TreeNode x={40} y={112} label="pheromone.ts" />
        <TreeNode x={20} y={140} label="routes/" />
        <TreeNode x={20} y={168} label="tests/" />
        {/* connecting lines */}
        <path d="M10 14 L30 28 M30 42 L50 56 M30 42 L50 84 M30 42 L50 112 M10 14 L30 140 M10 14 L30 168" stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />
      </g>

      {/* Join arrow */}
      <path d="M 280 116 Q 380 116 440 100" stroke="var(--brand-accent)" strokeWidth="2" fill="none" markerEnd="url(#join-arrow)" strokeDasharray="4 4" />
      <text x="360" y="105" textAnchor="middle" className="fill-[var(--brand-accent)] text-xs font-semibold">join at file</text>

      {/* AST tree (right) */}
      <g transform="translate(450, 60)" className="font-mono text-[13px]">
        <TreeNode x={0} y={0} label="lib/auth.ts" highlight />
        <TreeNode x={20} y={28} label="ClassDeclaration AuthService" />
        <TreeNode x={40} y={56} label="Method signToken" />
        <TreeNode x={40} y={84} label="Method refreshToken" />
        <TreeNode x={40} y={112} label="Method validateToken" />
        <TreeNode x={20} y={140} label="FunctionDecl hashPepper" />
        <TreeNode x={20} y={168} label="ConstDecl MAX_AGE" />
        <path d="M10 14 L30 28 M30 42 L50 56 M30 42 L50 84 M30 42 L50 112 M10 14 L30 140 M10 14 L30 168" stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />
      </g>
    </svg>
  )
}

function TreeNode({ x, y, label, highlight }: { x: number; y: number; label: string; highlight?: boolean }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle cx="0" cy="14" r="3.5" className={highlight ? 'fill-[var(--brand-accent)]' : 'fill-[var(--border-strong)]'} />
      <text x="8" y="18" className={`${highlight ? 'fill-[var(--text-primary)] font-semibold' : 'fill-[var(--text-secondary)]'} text-[13px]`}>{label}</text>
    </g>
  )
}

function AnnotatedFileTreeMock() {
  return (
    <div className="grid gap-3 border border-[var(--border-soft)] md:grid-cols-[280px_1fr]">
      {/* Sidebar */}
      <div className="border-r border-[var(--border-soft)] bg-[var(--surface-raised)] p-3 font-mono text-[13px]">
        <Row label="▾ lib/" badge="2 ● 6 ◆" depth={0} />
        <Row label="▾ auth.ts" badge="2 sessions ⚠ MED" depth={1} hot warning />
        <Row label="◆ AuthService.signToken" badge="gardener X" depth={2} colorBar={COLOR_A} />
        <Row label="◆ AuthService.refreshToken" badge="you X NOW" depth={2} colorBar={COLOR_B} selected />
        <Row label="tuples.ts" badge="gardener S" depth={1} colorBar={COLOR_A} faint />
        <Row label="helpers.ts" depth={1} faint />
        <Row label="▸ routes/" depth={0} />
        <Row label="▸ tests/" badge="1 session IX" depth={0} />
      </div>
      {/* Detail pane */}
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center gap-2">
          <FileCode size={16} className="text-[var(--text-muted)]" />
          <span className="font-mono text-[var(--text-primary)]">lib/auth.ts</span>
          <Badge variant="warning">MEDIUM overlap</Badge>
        </div>
        <div className="space-y-2 border-l-4 border-[var(--border-strong)] pl-3 text-[var(--text-secondary)]">
          <div><span className="font-semibold text-[var(--text-primary)]">2 active claims · MEDIUM overlap</span></div>
        </div>
        <div className="space-y-3">
          <ClaimBlock color={COLOR_A} session="session-12abc" agent="gardener" symbol="AuthService.signToken" intent='"Refactor signing to RS256"' age="8 min ago" />
          <ClaimBlock color={COLOR_B} session="session-56def" agent="you" symbol="AuthService.refreshToken" intent="(your claim)" age="active NOW" mine />
        </div>
        <div className="border border-[var(--border-soft)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--text-muted)]">
          Overlap risk: <span className="font-semibold text-[var(--warning)]">MEDIUM</span>{' '}
          (transitive — both touch <code className="font-mono">AuthService</code> class shape).
        </div>
      </div>
    </div>
  )
}

function Row({ label, badge, depth, hot, warning, colorBar, faint, selected }: { label: string; badge?: string; depth: number; hot?: boolean; warning?: boolean; colorBar?: string; faint?: boolean; selected?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-1 ${selected ? 'bg-[var(--surface-active)]' : ''} ${faint ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
      {colorBar && <span className="inline-block h-2 w-2 shrink-0" style={{ backgroundColor: colorBar }} />}
      <span className="truncate">{label}</span>
      {badge && (
        <span className={`ml-auto shrink-0 border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${warning ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--border-soft)] text-[var(--text-muted)]'}`}>
          {badge}
        </span>
      )}
    </div>
  )
}

function ClaimBlock({ color, session, agent, symbol, intent, age, mine }: { color: string; session: string; agent: string; symbol: string; intent: string; age: string; mine?: boolean }) {
  return (
    <div className="flex gap-3 border border-[var(--border-soft)] p-3">
      <span className="mt-1 h-3 w-3 shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 text-xs">
        <div className="font-mono text-[13px] text-[var(--text-primary)]">{symbol}</div>
        <div className="text-[var(--text-muted)]">
          {session} ({agent}) · {age}
        </div>
        <div className="text-[var(--text-secondary)]">{intent}</div>
        <div className="mt-2 flex gap-2 text-[11px] font-semibold uppercase tracking-wider">
          {mine ? (
            <>
              <button className="border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-primary)]">Release</button>
              <button className="border border-[var(--border-soft)] px-2 py-0.5 text-[var(--text-muted)]">Edit intent</button>
            </>
          ) : (
            <>
              <button className="border border-[var(--border-soft)] px-2 py-0.5 text-[var(--text-muted)]">Diff</button>
              <button className="border border-[var(--border-soft)] px-2 py-0.5 text-[var(--text-muted)]">Subscribe</button>
              <button className="border border-[var(--border-soft)] px-2 py-0.5 text-[var(--text-muted)]">DM</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TreemapSvg() {
  return (
    <svg viewBox="0 0 800 380" className="h-auto w-full" aria-label="Squarified treemap of claim ownership">
      {/* lib/ super-cell */}
      <rect x="10" y="10" width="500" height="240" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
      <text x="20" y="30" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">lib/</text>
      {/* auth.ts with two claims */}
      <rect x="20" y="40" width="280" height="200" fill="var(--surface-base)" stroke={COLOR_A} strokeWidth="3" />
      <text x="30" y="60" className="fill-[var(--text-primary)] text-sm font-semibold">auth.ts</text>
      <rect x="30" y="70" width="120" height="160" fill={COLOR_A} fillOpacity="0.65" />
      <text x="40" y="92" className="fill-[var(--text-inverse)] text-xs font-bold">signToken</text>
      <text x="40" y="108" className="fill-[var(--text-inverse)] text-[11px] font-semibold uppercase tracking-wider">gardener X</text>
      <rect x="160" y="70" width="130" height="160" fill={COLOR_B} fillOpacity="0.65" />
      <text x="170" y="92" className="fill-[var(--text-inverse)] text-xs font-bold">refreshToken</text>
      <text x="170" y="108" className="fill-[var(--text-inverse)] text-[11px] font-semibold uppercase tracking-wider">you X</text>
      {/* tuples.ts (shared) */}
      <rect x="310" y="40" width="100" height="120" fill={COLOR_A} fillOpacity="0.25" stroke="var(--border-soft)" />
      <text x="320" y="60" className="fill-[var(--text-primary)] text-sm font-semibold">tuples.ts</text>
      <text x="320" y="78" className="fill-[var(--text-muted)] text-[11px] uppercase tracking-wider">gardener S</text>
      {/* pheromone.ts */}
      <rect x="310" y="170" width="100" height="70" fill="var(--surface-base)" stroke="var(--border-soft)" />
      <text x="320" y="190" className="fill-[var(--text-muted)] text-sm">pheromone.ts</text>
      {/* helpers.ts */}
      <rect x="420" y="40" width="80" height="200" fill="var(--surface-base)" stroke="var(--border-soft)" />
      <text x="430" y="60" className="fill-[var(--text-muted)] text-sm">helpers.ts</text>

      {/* tests/ */}
      <rect x="520" y="10" width="270" height="240" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
      <text x="530" y="30" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">tests/unit/auth/</text>
      <rect x="530" y="40" width="120" height="200" fill={COLOR_C} fillOpacity="0.65" />
      <text x="540" y="62" className="fill-[var(--text-inverse)] text-xs font-bold">signToken.test.ts</text>
      <text x="540" y="78" className="fill-[var(--text-inverse)] text-[11px] font-semibold uppercase tracking-wider">qa X</text>
      <rect x="660" y="40" width="120" height="200" fill={COLOR_C} fillOpacity="0.65" />
      <text x="670" y="62" className="fill-[var(--text-inverse)] text-xs font-bold">refreshToken.test.ts</text>
      <text x="670" y="78" className="fill-[var(--text-inverse)] text-[11px] font-semibold uppercase tracking-wider">qa X</text>

      {/* routes/ */}
      <rect x="10" y="260" width="780" height="110" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
      <text x="20" y="280" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">routes/ (unclaimed)</text>
      <rect x="20" y="290" width="200" height="70" fill="var(--surface-base)" stroke="var(--border-soft)" />
      <text x="30" y="320" className="fill-[var(--text-muted)] text-sm">api.ts</text>
      <rect x="230" y="290" width="300" height="70" fill="var(--surface-base)" stroke="var(--border-soft)" />
      <text x="240" y="320" className="fill-[var(--text-muted)] text-sm">whois.ts (new)</text>
      <rect x="540" y="290" width="240" height="70" fill="var(--surface-base)" stroke="var(--border-soft)" />
      <text x="550" y="320" className="fill-[var(--text-muted)] text-sm">home.ts</text>
    </svg>
  )
}

function SunburstSvg() {
  const center = { x: 400, y: 200 }
  const r1 = 60, r2 = 110, r3 = 170
  return (
    <svg viewBox="0 0 800 400" className="h-auto w-full" aria-label="Sunburst layout of claim tree">
      {/* Center: repo */}
      <circle cx={center.x} cy={center.y} r={r1} fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
      <text x={center.x} y={center.y - 4} textAnchor="middle" className="fill-[var(--text-primary)] text-sm font-semibold">repo</text>
      <text x={center.x} y={center.y + 12} textAnchor="middle" className="fill-[var(--text-muted)] text-xs">port-daddy</text>
      {/* Ring 2: dirs */}
      {arcSegment(center, r1, r2, 180, 360, 'var(--surface-raised)', 'lib/')}
      {arcSegment(center, r1, r2, 0, 90, 'var(--surface-raised)', 'tests/')}
      {arcSegment(center, r1, r2, 90, 180, 'var(--surface-raised)', 'routes/')}
      {/* Ring 3: files + symbols, colored by claim */}
      {arcSegment(center, r2, r3, 180, 270, COLOR_A, 'auth.ts (gard X)', 0.5)}
      {arcSegment(center, r2, r3, 270, 360, COLOR_B, 'auth.ts (you X)', 0.5)}
      {arcSegment(center, r2, r3, 0, 45, COLOR_C, 'signToken.test (qa X)', 0.55)}
      {arcSegment(center, r2, r3, 45, 90, COLOR_C, 'refreshToken.test (qa X)', 0.55)}
      {arcSegment(center, r2, r3, 90, 180, 'var(--surface-base)', 'whois.ts (unclaimed)')}
    </svg>
  )
}

function arcSegment(c: { x: number; y: number }, r1: number, r2: number, start: number, end: number, fill: string, label?: string, opacity = 1) {
  const toRad = (d: number) => (d - 90) * Math.PI / 180
  const x1 = c.x + r1 * Math.cos(toRad(start))
  const y1 = c.y + r1 * Math.sin(toRad(start))
  const x2 = c.x + r2 * Math.cos(toRad(start))
  const y2 = c.y + r2 * Math.sin(toRad(start))
  const x3 = c.x + r2 * Math.cos(toRad(end))
  const y3 = c.y + r2 * Math.sin(toRad(end))
  const x4 = c.x + r1 * Math.cos(toRad(end))
  const y4 = c.y + r1 * Math.sin(toRad(end))
  const large = end - start > 180 ? 1 : 0
  const mid = (start + end) / 2
  const labelR = (r1 + r2) / 2
  const lx = c.x + labelR * Math.cos(toRad(mid))
  const ly = c.y + labelR * Math.sin(toRad(mid))
  return (
    <g key={`${start}-${end}`}>
      <path d={`M ${x1} ${y1} L ${x2} ${y2} A ${r2} ${r2} 0 ${large} 1 ${x3} ${y3} L ${x4} ${y4} A ${r1} ${r1} 0 ${large} 0 ${x1} ${y1} Z`} fill={fill} fillOpacity={opacity} stroke="var(--border-strong)" strokeWidth="1" />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--text-primary)] text-[11px] font-semibold" transform={`rotate(${mid > 90 && mid < 270 ? mid + 180 : mid}, ${lx}, ${ly})`}>{label}</text>
      )}
    </g>
  )
}

function ForceGraphSvg() {
  const nodes = [
    { id: 'auth', x: 400, y: 200, label: 'auth.ts', color: 'var(--surface-base)' },
    { id: 'sign', x: 250, y: 100, label: 'signToken', color: COLOR_A },
    { id: 'refresh', x: 550, y: 100, label: 'refreshToken', color: COLOR_B },
    { id: 'svc', x: 400, y: 60, label: 'AuthService', color: 'var(--surface-base)' },
    { id: 'pepper', x: 200, y: 320, label: 'hashPepper', color: 'var(--surface-base)' },
    { id: 'testSign', x: 250, y: 350, label: 'signToken.test', color: COLOR_C },
    { id: 'testRefresh', x: 600, y: 350, label: 'refreshToken.test', color: COLOR_C },
  ]
  const edges: [string, string, 'tree' | 'import'][] = [
    ['auth', 'sign', 'tree'],
    ['auth', 'refresh', 'tree'],
    ['svc', 'sign', 'tree'],
    ['svc', 'refresh', 'tree'],
    ['sign', 'pepper', 'import'],
    ['testSign', 'sign', 'import'],
    ['testRefresh', 'refresh', 'import'],
  ]
  return (
    <svg viewBox="0 0 800 420" className="h-auto w-full" aria-label="Force-directed graph of claim ownership with imports">
      {edges.map(([from, to, kind], i) => {
        const a = nodes.find(n => n.id === from)!
        const b = nodes.find(n => n.id === to)!
        return (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={kind === 'tree' ? 'var(--border-strong)' : 'var(--brand-accent)'} strokeWidth={kind === 'tree' ? 1.5 : 1.5} strokeDasharray={kind === 'import' ? '5 4' : 'none'} />
        )
      })}
      {nodes.map(n => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <circle r="34" fill={n.color} stroke="var(--border-strong)" strokeWidth="2" />
          <text textAnchor="middle" dy="-2" className="fill-[var(--text-primary)] text-xs font-semibold">{n.label}</text>
        </g>
      ))}
      <g transform="translate(20, 380)">
        <line x1="0" y1="0" x2="30" y2="0" stroke="var(--border-strong)" strokeWidth="1.5" />
        <text x="35" y="4" className="fill-[var(--text-muted)] text-xs">tree edge</text>
        <line x1="120" y1="0" x2="150" y2="0" stroke="var(--brand-accent)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="155" y="4" className="fill-[var(--text-muted)] text-xs">import edge</text>
      </g>
    </svg>
  )
}

function GanttSvg() {
  const bars: Array<{ y: number; x: number; w: number; color: string; label: string }> = [
    { y: 30, x: 180, w: 200, color: COLOR_A, label: 'signToken (X)' },
    { y: 60, x: 280, w: 220, color: COLOR_A, label: 'tuples.ts (S)' },
    { y: 120, x: 300, w: 350, color: COLOR_B, label: 'refreshToken (X)' },
    { y: 200, x: 130, w: 80, color: COLOR_C, label: 'signToken.test (X)' },
    { y: 200, x: 220, w: 160, color: COLOR_C, label: 'refreshToken.test (X)' },
  ]
  return (
    <svg viewBox="0 0 800 280" className="h-auto w-full" aria-label="Per-session Gantt ribbon">
      {/* Axes labels */}
      <text x="50" y="20" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">time →</text>
      <text x="20" y="50" className="fill-[var(--text-primary)] text-xs font-semibold">session-12abc</text>
      <text x="20" y="65" className="fill-[var(--text-muted)] text-[11px]">gardener</text>
      <text x="20" y="135" className="fill-[var(--text-primary)] text-xs font-semibold">session-56def</text>
      <text x="20" y="150" className="fill-[var(--text-muted)] text-[11px]">you</text>
      <text x="20" y="215" className="fill-[var(--text-primary)] text-xs font-semibold">session-78ghi</text>
      <text x="20" y="230" className="fill-[var(--text-muted)] text-[11px]">qa</text>
      {/* Now line */}
      <line x1="660" y1="20" x2="660" y2="260" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="3 3" />
      <text x="668" y="20" className="fill-[var(--brand-accent)] text-[11px] font-semibold">NOW</text>
      {/* Time ticks */}
      {[120, 240, 360, 480, 600].map((x, i) => (
        <g key={i}>
          <line x1={x} y1="248" x2={x} y2="252" stroke="var(--text-muted)" />
          <text x={x} y="264" textAnchor="middle" className="fill-[var(--text-muted)] text-[10px]">{`-${3 - i * 0.6}h`}</text>
        </g>
      ))}
      {/* Bars */}
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={20} fill={b.color} fillOpacity="0.8" stroke="var(--border-strong)" strokeWidth="1" />
          <text x={b.x + 6} y={b.y + 14} className="fill-[var(--text-inverse)] text-[11px] font-semibold">{b.label}</text>
        </g>
      ))}
    </svg>
  )
}

function ContourSvg() {
  return (
    <svg viewBox="0 0 800 300" className="h-auto w-full" aria-label="Topographic contour map of claim density">
      {/* concentric ovals */}
      {[
        { cx: 400, cy: 150, rx: 280, ry: 110, color: 'var(--brand-accent)', op: 0.08, label: '1 session' },
        { cx: 400, cy: 150, rx: 200, ry: 80, color: 'var(--brand-accent)', op: 0.16, label: '2 sessions' },
        { cx: 400, cy: 150, rx: 120, ry: 55, color: 'var(--brand-accent)', op: 0.25, label: '3 sessions HOT' },
      ].map((e, i) => (
        <g key={i}>
          <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={e.color} fillOpacity={e.op} stroke="var(--brand-accent)" strokeWidth="1.5" strokeDasharray="3 4" />
        </g>
      ))}
      <text x="400" y="155" textAnchor="middle" className="fill-[var(--text-primary)] text-sm font-bold">lib/auth/</text>
      <text x="240" y="240" className="fill-[var(--text-muted)] text-xs italic">tests/unit/</text>
      <text x="540" y="240" className="fill-[var(--text-muted)] text-xs italic">cli/</text>
      <text x="20" y="20" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">claim density</text>
      <g transform="translate(620, 250)">
        <ellipse cx="0" cy="0" rx="50" ry="20" fill="var(--brand-accent)" fillOpacity="0.25" />
        <text x="0" y="4" textAnchor="middle" className="fill-[var(--text-primary)] text-[11px] font-semibold">3+</text>
        <ellipse cx="70" cy="0" rx="50" ry="20" fill="var(--brand-accent)" fillOpacity="0.16" />
        <text x="70" y="4" textAnchor="middle" className="fill-[var(--text-primary)] text-[11px] font-semibold">2</text>
        <ellipse cx="140" cy="0" rx="50" ry="20" fill="var(--brand-accent)" fillOpacity="0.08" />
        <text x="140" y="4" textAnchor="middle" className="fill-[var(--text-primary)] text-[11px] font-semibold">1</text>
      </g>
    </svg>
  )
}

function CalendarHeatmap() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  // 7 rows × 24 cols of synthetic activity
  const cells: number[][] = days.map((_, row) => Array.from({ length: 24 }, (_, col) => {
    const weekend = row >= 5
    if (weekend) return 0
    const base = Math.sin((col + row) / 3) * 5 + 6
    const noise = ((col * 13 + row * 7) % 7) - 3
    return Math.max(0, Math.round(base + noise))
  }))
  // mark "today" with the strongest value
  cells[3][23] = 18
  const colorFor = (n: number) => {
    if (n === 0) return 'var(--surface-raised)'
    if (n <= 5) return 'oklch(0.65 0.15 35 / 0.25)'
    if (n <= 15) return 'oklch(0.65 0.20 35 / 0.65)'
    return 'oklch(0.55 0.25 35 / 0.95)'
  }
  return (
    <div className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-base)] p-4">
      <svg viewBox="0 0 700 200" className="h-auto w-full" aria-label="Calendar heatmap of claim activity">
        {/* day labels */}
        {days.map((d, i) => (
          <text key={d} x="20" y={45 + i * 22} className="fill-[var(--text-muted)] text-[11px] font-semibold">{d}</text>
        ))}
        {/* cells */}
        {cells.map((row, i) => row.map((v, j) => (
          <rect key={`${i}-${j}`} x={60 + j * 24} y={32 + i * 22} width="18" height="18" fill={colorFor(v)} stroke="var(--border-soft)" strokeWidth="0.5" />
        )))}
        {/* today marker */}
        <text x={60 + 23 * 24 + 9} y={26} textAnchor="middle" className="fill-[var(--brand-accent)] text-[11px] font-bold">today</text>
        {/* legend */}
        <g transform="translate(60, 190)">
          <text x="0" y="0" className="fill-[var(--text-muted)] text-[11px]">less</text>
          {[0, 3, 10, 18].map((v, i) => (
            <rect key={i} x={30 + i * 24} y="-10" width="18" height="14" fill={colorFor(v)} stroke="var(--border-soft)" strokeWidth="0.5" />
          ))}
          <text x="130" y="0" className="fill-[var(--text-muted)] text-[11px]">more</text>
        </g>
      </svg>
    </div>
  )
}

function SankeySvg() {
  return (
    <svg viewBox="0 0 800 320" className="h-auto w-full" aria-label="Sankey flow of claim lifecycle">
      <text x="50" y="20" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">sources</text>
      <text x="650" y="20" className="fill-[var(--text-muted)] text-xs font-semibold uppercase tracking-wider">destinations</text>
      {/* Source bars */}
      <rect x="50" y="40" width="20" height="100" fill={COLOR_A} />
      <text x="80" y="55" className="fill-[var(--text-primary)] text-xs font-semibold">pd add (62%)</text>
      <rect x="50" y="160" width="20" height="60" fill={COLOR_B} />
      <text x="80" y="175" className="fill-[var(--text-primary)] text-xs font-semibold">pd feature (24%)</text>
      <rect x="50" y="240" width="20" height="40" fill="var(--brand-accent)" />
      <text x="80" y="255" className="fill-[var(--text-primary)] text-xs font-semibold">auto-IX escalation (14%)</text>
      {/* Destination bars */}
      <rect x="720" y="40" width="20" height="130" fill={COLOR_C} />
      <text x="600" y="55" textAnchor="end" className="fill-[var(--text-primary)] text-xs font-semibold">pd done (78%)</text>
      <rect x="720" y="190" width="20" height="40" fill="var(--warning)" />
      <text x="600" y="205" textAnchor="end" className="fill-[var(--text-primary)] text-xs font-semibold">reverted (12%)</text>
      <rect x="720" y="250" width="20" height="35" fill="var(--error)" />
      <text x="600" y="265" textAnchor="end" className="fill-[var(--text-primary)] text-xs font-semibold">pruned under contest (10%)</text>
      {/* Flows */}
      <path d="M70 40 C 300 40, 400 40, 720 40 L 720 140 C 400 140, 300 140, 70 140 Z" fill={COLOR_A} fillOpacity="0.35" />
      <path d="M70 160 C 300 160, 500 190, 720 190 L 720 220 C 500 220, 300 220, 70 220 Z" fill={COLOR_B} fillOpacity="0.35" />
      <path d="M70 240 C 300 240, 500 260, 720 250 L 720 285 C 500 285, 300 280, 70 280 Z" fill="var(--brand-accent)" fillOpacity="0.35" />
    </svg>
  )
}

function StreamgraphSvg() {
  // Five granularity layers stacked over 8 time buckets.
  const layers: Array<{ color: string; label: string; values: number[] }> = [
    { color: 'var(--surface-raised)', label: 'repo', values: [1, 1, 1, 1, 1, 1, 1, 1] },
    { color: 'oklch(0.8 0.04 280 / 0.8)', label: 'dir', values: [2, 3, 3, 4, 4, 4, 3, 3] },
    { color: COLOR_A, label: 'file', values: [3, 4, 5, 6, 6, 7, 6, 5] },
    { color: COLOR_B, label: 'symbol', values: [0, 1, 2, 4, 6, 8, 8, 7] },
    { color: COLOR_C, label: 'region/block', values: [0, 0, 1, 2, 2, 3, 4, 3] },
  ]
  const bucketW = 700 / (layers[0].values.length - 1)
  const baseY = 280
  const heightScale = 12
  // Stacked
  const tops: number[][] = layers.map((l, i) => l.values.map((v, j) => {
    let acc = 0
    for (let k = 0; k <= i; k++) acc += layers[k].values[j]
    return baseY - acc * heightScale
  }))
  return (
    <svg viewBox="0 0 800 320" className="h-auto w-full" aria-label="Streamgraph of claim depth over time">
      {layers.map((l, i) => {
        const top = tops[i]
        const bot = i === 0 ? Array(top.length).fill(baseY) : tops[i - 1]
        const points = [...top.map((y, j) => `${50 + j * bucketW},${y}`), ...bot.slice().reverse().map((y, j) => `${50 + (bot.length - 1 - j) * bucketW},${y}`)]
        return (
          <polygon key={l.label} points={points.join(' ')} fill={l.color} stroke="var(--border-strong)" strokeWidth="0.5" />
        )
      })}
      {layers.map((l, i) => (
        <text key={`${l.label}-label`} x="760" y={tops[i][tops[i].length - 1] + 4} textAnchor="end" className="fill-[var(--text-primary)] text-[11px] font-semibold">{l.label}</text>
      ))}
      {/* X axis ticks */}
      {['9 AM', '11', '1 PM', '3', '5', '7 PM', '9', 'now'].map((t, i) => (
        <text key={t} x={50 + i * bucketW} y="300" textAnchor="middle" className="fill-[var(--text-muted)] text-[10px]">{t}</text>
      ))}
    </svg>
  )
}
