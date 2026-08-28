import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUp, ArrowDown, Folder, FileCode, Hash, Box, Bookmark, AlignLeft, CheckCircle2, AlertTriangle, Layers, Network } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import { ClaimTreeHoverProvider } from './claim-tree/HoverContext'
import { SessionLegend } from './claim-tree/SessionLegend'
import { TwoTreesViz } from './claim-tree/TwoTreesViz'
import { TreemapViz } from './claim-tree/TreemapViz'
import { SunburstViz } from './claim-tree/SunburstViz'
import { ForceViz } from './claim-tree/ForceViz'
import { GanttViz } from './claim-tree/GanttViz'
import { CalendarViz } from './claim-tree/CalendarViz'
import { StreamgraphViz } from './claim-tree/StreamgraphViz'
import { SankeyViz } from './claim-tree/SankeyViz'
import { ChordViz } from './claim-tree/ChordViz'
import { ModesMatrixViz } from './claim-tree/ModesMatrixViz'
import { ClaimTreeEgoGraph } from './claim-tree/ClaimTreeEgoGraph'

export default function ClaimTree() {
  return (
    <ClaimTreeHoverProvider>
      <div className="space-y-12">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="teal">Concept</Badge>
            <Badge variant="gold">Substrate</Badge>
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
            <Link to="/docs/adr/0038-claim-tree" className="inline-flex items-center gap-1 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
              Read the spec (ADR-0038) <ArrowRight size={14} />
            </Link>
            <Link to="/docs/concepts/primitives" className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              See the primitives this builds on <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        {/* ── Questions it answers ─────────────────────────────── */}
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
              <div key={q} className="flex items-start gap-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4">
                <Icon size={18} className="mt-0.5 shrink-0 text-[var(--brand-accent)]" />
                <div className="space-y-1">
                  <p className="font-mono text-[15px] leading-snug text-[var(--text-primary)]">&ldquo;{q}&rdquo;</p>
                  <span className="inline-block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{kind} query</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Trouble, in one glance</h2>
              <p className="mt-2 max-w-3xl text-[var(--text-secondary)]">The agent receives this same bounded trouble graph as Mermaid. Pick a state to inspect the reason and next action; the console and web keep the evidence honest and the motion quiet.</p>
            </div>
            <Badge variant="warning">finite-state evidence</Badge>
          </div>
          <ClaimTreeEgoGraph />
        </section>

        {/* ── Mental model: two trees ──────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            The mental model: two trees, joined at the file
          </h2>
          <p className="text-[var(--text-secondary)]">
            Picture your repo as two overlapping trees. The filesystem tree is paths;
            the AST tree is code structure inside each file. The claim tree{' '}
            <strong className="text-[var(--text-primary)]">joins them at the file</strong>{' '}
            — every file node has children from its AST when symbol-index data is
            available. Hover the filesystem's <code className="font-mono text-[14px]">auth.ts</code>{' '}
            to see the join animate.
          </p>
          <TwoTreesViz />
          <p className="text-sm text-[var(--text-muted)]">
            You don't need to think about AST when you{' '}
            <code className="rounded bg-[var(--surface-raised)] px-1 py-0.5 font-mono text-[14px]">pd add lib/auth.ts</code>.
            The tree degrades gracefully to file granularity. But when symbol data is available,
            you can claim a specific function instead of the whole file — and let someone else
            claim a different function in the same file without conflict.
          </p>
        </section>

        {/* ── Node kinds ───────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Node kinds</h2>
          <p className="text-[var(--text-secondary)]">
            Every node has a kind that determines what it represents and how stable
            its identity is across refactors.
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
                <NodeKindRow icon={Folder} kind="repo" example="repo:port-daddy" stability="Stable" stabilityTone="success" desc="The repo root" />
                <NodeKindRow icon={Folder} kind="dir" example="dir:lib/auth/" stability="Stable (path)" stabilityTone="success" desc="Directory; descendants are its files + subdirs" />
                <NodeKindRow icon={FileCode} kind="file" example="file:lib/auth.ts" stability="Stable (path)" stabilityTone="success" desc="One file; descendants are its AST nodes" />
                <NodeKindRow icon={Hash} kind="symbol" example="symbol:lib/auth.ts:AuthService.signToken" stability="High (rename detected)" stabilityTone="success" desc="Named function / class / method. Primary claim unit." />
                <NodeKindRow icon={Box} kind="block" example="block:lib/auth.ts:signToken.body.if[0]" stability="High (AST-anchored)" stabilityTone="success" desc="Unnamed AST block — switch case, arrow expr, etc." />
                <NodeKindRow icon={Bookmark} kind="fenced" example="fenced:lib/auth.ts:auth-validation" stability="Operator-visible" stabilityTone="info" desc={`Marked region: // PD-CLAIM-BEGIN <slug> ... // PD-CLAIM-END`} />
                <NodeKindRow icon={AlignLeft} kind="region" example="region:lib/auth.ts:120-180" stability="Low (fallback only)" stabilityTone="warning" desc="Line range — degrades when AST unavailable." />
              </tbody>
            </table>
          </div>
          <div className="border-l-4 border-[var(--brand-accent)] bg-[var(--surface-raised)] p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">Why not just line ranges?</strong>{' '}
            Line numbers are the wrong frame of reference for code. Add an import at the top of a file
            and every line shifts. Two agents that <em className="text-[var(--text-primary)]">should</em> be
            coordinating end up with overlapping line ranges that no longer touch the same code. The
            AST-anchored model treats <code className="font-mono text-[14px]">AuthService.signToken</code>{' '}
            as the stable identity.
          </div>
        </section>

        {/* ── Claim modes (interactive) ────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Claim modes</h2>
          <p className="text-[var(--text-secondary)]">
            When a session claims a node, it picks a mode that signals what it intends to do.
            Modes mirror multi-granularity locking from database systems (Gray, 1976):
          </p>
          <ModesMatrixViz />
          <p className="text-sm text-[var(--text-secondary)]">
            For most PD work, the pattern is{' '}
            <strong className="text-[var(--text-primary)]">IX on the directory → IX on the file → X on the symbol</strong>.
            The agent never sees the modes unless they're debugging.
          </p>
        </section>

        {/* ── Session legend (also the cross-viz hover controller) ─ */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            One scenario, ten views
          </h2>
          <p className="text-[var(--text-secondary)]">
            Every visualization below renders the same tree state. Hover a session
            below or in any viz — and watch every other viz dim everything that
            isn't part of that session.
          </p>
          <SessionLegend />
        </section>

        {/* ── Visualization gallery ────────────────────────────── */}
        <section className="space-y-6">
          <Mode letter="A" title="ASCII tree (CLI default)" subtitle="`pd claims tree`" rationale="The terminal-native view. Glyphs encode kind; ANSI color encodes conflict severity.">
            <DocsCodeBlock label="$ pd claims tree" code={`repo:port-daddy                              [3 sessions, 6 claims]
├── lib/                                     [2 sessions, IX]
│   ├─● auth.ts                              [2 sessions, MEDIUM]
│   │   ├─◆ AuthService.signToken           [session-12abc gardener, X, 28m]
│   │   └─◆ AuthService.refreshToken        [session-56def you, X, 18m]
│   └─● tuples.ts                            [session-12abc, S, 22m]
└── tests/unit/auth/                         [session-78ghi, IX]
    ├─● signToken.test.ts                    [qa, X, 12m]
    └─● refreshToken.test.ts                 [qa, X, 9m]

Glyphs:  ● file   ▪ region   ◆ symbol   ◆▾ block   ⌗ fenced`} />
          </Mode>

          <Mode letter="B" title="Annotated file tree (web sidebar)" subtitle="Web console default" rationale="Standard collapsible tree component. Each row shows claim count chips and risk severity; click for the detail pane.">
            <AnnotatedTreeMock />
          </Mode>

          <Mode letter="C" title="Squarified treemap" subtitle="Where is the swarm right now?" rationale="Real d3.treemap with squarify tiling over the full hierarchy. Color = session ownership; border = conflict. Click a directory to zoom into its subtree; breadcrumb to zoom back.">
            <TreemapViz />
          </Mode>

          <Mode letter="D" title="Zoomable sunburst" subtitle="Drill into a subtree" rationale="Bostock's classic d3.partition pattern. Click an arc → it becomes the new root with a smooth zoom. Click the center to zoom out.">
            <SunburstViz />
          </Mode>

          <Mode letter="E" title="Force-directed graph + imports" subtitle="Coupling structure" rationale="Real d3.forceSimulation with link, charge, and collide forces. Solid edges are parent-child; dashed edges are imports. Hover a node to highlight its 1-hop neighborhood.">
            <ForceViz />
          </Mode>

          <Mode letter="F" title="Per-session Gantt ribbon" subtitle="Claim timeline" rationale="d3.scaleTime axis with proper tick formatting. Hover a bar for start/end/duration; the NOW rule pulses.">
            <GanttViz />
          </Mode>

          <Mode letter="G" title="Chord diagram: co-claimed files" subtitle="What travels together" rationale="Files frequently claimed in the same session form thick arcs. d3.chord layout; hover a file or a chord to isolate.">
            <ChordViz />
          </Mode>

          <Mode letter="H" title="Calendar heatmap" subtitle="The project's rhythm" rationale="Sequential color scale across a 28-day window. Hover a day for its claim event count; weekend valleys + weekday peaks emerge.">
            <CalendarViz />
          </Mode>

          <Mode letter="I" title="Sankey: claim lifecycle" subtitle="Where claims arise and resolve" rationale="d3-sankey with real flow conservation. Sources left, destinations right; band width = flow value. Hover a band to isolate its source-destination pair.">
            <SankeyViz />
          </Mode>

          <Mode letter="J" title="Streamgraph: claim depth over time" subtitle="Granularity story" rationale="d3.stack with stackOffsetWiggle baseline + curveBasis smoothing. Hover for a vertical guide and per-layer breakdown.">
            <StreamgraphViz />
          </Mode>
        </section>

        {/* ── Where it pays off ────────────────────────────────── */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 border-2 border-[var(--success)] bg-[var(--surface-raised)] p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-[var(--success)]" />
              <h3 className="text-base font-semibold text-[var(--text-primary)]">The tree pays off when</h3>
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
              <h3 className="text-base font-semibold text-[var(--text-primary)]">The tree is overkill when</h3>
            </div>
            <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
              <li>You only ever want file-level claims (no symbols, no regions)</li>
              <li>You have one agent per project and no concurrent work</li>
              <li>You don't care about retrospective analytics</li>
            </ul>
          </div>
        </section>

        {/* ── Further reading ──────────────────────────────────── */}
        <section className="space-y-3 border-t-2 border-[var(--border-strong)] pt-8">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Reading further</h2>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <ReadingLink to="/docs/adr/0038-claim-tree" title="ADR-0038 — Claim Tree" desc="The formal specification: data structure, API, storage schema, migration phasing." />
            <ReadingLink to="/docs/adr/0037-git-access-control-and-pd-feature-verbs" title="ADR-0037 — Git access control" desc="The verb layer that produces claim-tree writes." />
            <ReadingLink to="/docs/concepts/primitives" title="Substrate primitives" desc="Sessions, tuples, pheromones, harbors — what the tree sits on top of." />
            <ReadingLink href="https://martin.kleppmann.com/papers/move-op.pdf" title="Kleppmann (2021) — Movable tree CRDTs" desc="The CRDT semantics PD's op log conforms to." external />
          </div>
        </section>
      </div>
    </ClaimTreeHoverProvider>
  )
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function NodeKindRow({ icon: Icon, kind, example, stability, stabilityTone, desc }: any) {
  const tone = { success: 'border-[var(--success)] text-[var(--success)]', info: 'border-[var(--info)] text-[var(--info)]', warning: 'border-[var(--warning)] text-[var(--warning)]' }[stabilityTone as 'success' | 'info' | 'warning']
  return (
    <tr>
      <td className="px-4 py-3"><Icon size={18} className="text-[var(--text-muted)]" /></td>
      <td className="px-4 py-3 align-top">
        <div className="font-mono text-[14px] font-semibold text-[var(--text-primary)]">{kind}</div>
        <div className="text-xs text-[var(--text-muted)]">{desc}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <code className="font-mono text-[14px] text-[var(--text-secondary)]">{example}</code>
      </td>
      <td className="px-4 py-3 align-top">
        <span className={`inline-block border-2 px-2 py-0.5 text-xs font-semibold ${tone}`}>{stability}</span>
      </td>
    </tr>
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

function ReadingLink({ to, href, title, desc, external }: any) {
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
      <a href={href} target="_blank" rel="noreferrer" className="block border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 hover:bg-[var(--surface-hover)]">{body}</a>
    )
  }
  return (
    <Link to={to} className="block border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 hover:bg-[var(--surface-hover)]">{body}</Link>
  )
}

function AnnotatedTreeMock() {
  // Lightweight interactive mock; the real heavy lifting is in the
  // Treemap / Sunburst / Force views above. This stays a static-ish
  // sketch of the web console's eventual sidebar shape.
  return (
    <div className="grid gap-3 border border-[var(--border-soft)] md:grid-cols-[280px_1fr]">
      <div className="border-r border-[var(--border-soft)] bg-[var(--surface-raised)] p-3 font-mono text-[14px] space-y-1">
        <div>▾ lib/</div>
        <div className="pl-3 text-[var(--text-primary)]">▾ auth.ts <span className="text-[var(--warning)]">⚠ MED</span></div>
        <div className="pl-6">◆ AuthService.signToken <span className="text-[oklch(0.62_0.18_282)]">● gardener X</span></div>
        <div className="pl-6 bg-[var(--surface-active)]">◆ AuthService.refreshToken <span className="text-[oklch(0.66_0.20_35)]">● you X NOW</span></div>
        <div className="pl-3 text-[var(--text-muted)]">tuples.ts <span className="text-[oklch(0.62_0.18_282)]">● gardener S</span></div>
        <div className="pl-3 text-[var(--text-muted)]">helpers.ts</div>
        <div>▸ routes/</div>
        <div>▸ tests/ <span className="text-[var(--text-muted)]">1 session IX</span></div>
      </div>
      <div className="p-4 space-y-3 text-sm">
        <div className="font-mono text-[var(--text-primary)]">lib/auth.ts <span className="text-[var(--warning)] uppercase text-xs tracking-wider">MEDIUM overlap</span></div>
        <div className="space-y-2 text-[var(--text-secondary)]">
          <div className="flex gap-2 border border-[var(--border-soft)] p-2">
            <span className="mt-1 h-3 w-3 shrink-0 bg-[oklch(0.62_0.18_282)]" />
            <div>
              <div className="font-mono text-[14px] text-[var(--text-primary)]">AuthService.signToken</div>
              <div className="text-xs text-[var(--text-muted)]">gardener · 28m · "Refactor signing to RS256"</div>
            </div>
          </div>
          <div className="flex gap-2 border border-[var(--border-soft)] p-2">
            <span className="mt-1 h-3 w-3 shrink-0 bg-[oklch(0.66_0.20_35)]" />
            <div>
              <div className="font-mono text-[14px] text-[var(--text-primary)]">AuthService.refreshToken</div>
              <div className="text-xs text-[var(--text-muted)]">you · active NOW · "New refresh implementation"</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
