/**
 * Shipwright Archetype Catalog
 *
 * The closed set of agent archetypes Shipwright can propose. Each archetype
 * carries a canonical purpose, default backend/model tier, default trigger,
 * default bond, default budget, and a prompt template. The original twelve
 * roles were spec'd in `docs/shipwright/SHIPWRIGHT-DESIGN.md §5.1`; the 2026-05-20
 * fleet retool added the GitHub-output ships (`code-reviewer`, `red-team`,
 * `test-author`, `tautology-sniffer`, `tenderfoot`) and the Spider/unSpider
 * roadmap pair (ADR-0031 / ADR-0032). `cartographer` was promoted out of
 * fleet-only territory at the same time. Total: twenty.
 *
 * Why a closed catalog:
 * - FleetControl can enforce trigger handlers are real code (closed grammar).
 * - Operators can audit "what kind of agent is this?" with a single name.
 * - Skill retrieval has a stable axis to tune against.
 * - Diffs across `pd shipwright propose` runs read as archetype add/remove,
 *   not as opaque YAML noise.
 *
 * Adding a new archetype is a deliberate change, not a one-liner. The
 * three-way handoff is: (1) add the entry here, (2) wire `pd-fleet.yml` (or
 * the ship spec under `fleet/ships/`), (3) update `tests/unit/shipwright-archetypes.test.js`
 * to bump the count assertion. Skipping any leg silently breaks Shipwright
 * propose-time skill retrieval — the entry must exist on both sides.
 */

import type { FleetModelTier } from '../fleet-engine.js';

/**
 * One of the canonical archetype identifiers. Used as the `archetype:`
 * field in proposed YAML and as the join key for skill retrieval. Keep
 * in sync with `ALL_ARCHETYPES` below.
 *
 * The first twelve are the original SHIPWRIGHT-DESIGN.md §5.1 catalog.
 * The remaining eight were added on 2026-05-20:
 * - `cartographer` was promoted out of fleet-only into a first-class archetype.
 * - `spider` and `unspider` realize ADR-0031 / ADR-0032 (the roadmap
 *   surfacing + contradiction-finding pair).
 * - `code-reviewer`, `red-team`, `test-author`, `tautology-sniffer`, and
 *   `tenderfoot` came from the fleet GitHub-output retool. `tenderfoot`
 *   is the renamed retool-era "unspider" — the ADR-0032 unSpider got
 *   to keep the historical name, the outside-in onboarding critic got
 *   the new one. See `docs/fleet/2026-05-20-retool.md`.
 *
 * The fleet's pd-fleet.yml uses `qa`/`test-hunter` for what the catalog
 * calls `qa-sentinel`/`test-gap-hunter`. Those YAML keys are fleet-local
 * aliases; the archetype IDs here are canonical.
 */
export type ArchetypeId =
  | 'gardener'
  | 'qa-sentinel'
  | 'test-gap-hunter'
  | 'documentarian'
  | 'simplifier'
  | 'research-scout'
  | 'dock-master'
  | 'spark'
  | 'sentry-responder'
  | 'perf-hawk'
  | 'browser-canary'
  | 'typesafety-sweeper'
  | 'cartographer'
  | 'spider'
  | 'unspider'
  | 'code-reviewer'
  | 'red-team'
  | 'test-author'
  | 'tautology-sniffer'
  | 'tenderfoot';

/**
 * The closed trigger grammar from `docs/shipwright/SHIPWRIGHT-DESIGN.md §5.2`.
 * A new trigger kind requires a daemon-side handler, so adding one is a
 * coordinated change, not a YAML edit.
 *
 * `pull-request-merged`, `cartographer-write`, `sortie-completed`, and
 * `claim-acquired` were added 2026-05-20 to back the Spider/unSpider/
 * tenderfoot archetypes. The handlers live alongside the fleet event
 * stream (`lib/fleet-engine.ts`) and the cartographer write hook.
 */
export type TriggerKind =
  | 'cron'
  | 'git-push'
  | 'git-pr'
  | 'pull-request-merged'
  | 'file-watch'
  | 'sentry-webhook'
  | 'deploy-webhook'
  | 'ci-duration'
  | 'service-claim'
  | 'tuple-pattern'
  | 'cartographer-write'
  | 'sortie-completed'
  | 'claim-acquired'
  | 'manual';

/**
 * Default trigger spec attached to an archetype. Operators can override at
 * propose time, but every archetype ships with one sensible default so the
 * proposed YAML is runnable as-is.
 */
/**
 * A body declared as intent rather than as an id: which backend, and which rung
 * of the capability ladder. The concrete model is spliced by `resolveModel()`.
 */
export interface BackendIntent {
  backend: string;
  capability: 'cheap' | 'balanced' | 'high' | 'max-thinking' | 'code';
}

export interface ArchetypeTrigger {
  kind: TriggerKind;
  /** Cron expression — required when `kind: cron`. */
  cron?: string;
  /** Glob list — required when `kind: file-watch`. */
  paths?: string[];
}

/**
 * Archetype family — coarse taxonomy used by `ARCHETYPES` ordering and
 * by Shipwright's UI hints. Definitions:
 *
 * - **generative**: surfaces new work. Spider, Spark, test-author. Bias
 *   toward output volume; trades precision for recall.
 * - **critical**: reads existing work and judges it. code-reviewer,
 *   red-team, unspider, tautology-sniffer, qa-sentinel, sentry-responder.
 *   Bias toward precision; silence is a valid output.
 * - **maintenance**: keeps the codebase honest without judging intent.
 *   gardener, simplifier, typesafety-sweeper, documentarian, perf-hawk.
 * - **observational**: reads the project from an outsider angle.
 *   tenderfoot, research-scout, browser-canary, dock-master.
 *   Often the highest-leverage finds because they catch tribal-knowledge gaps.
 * - **cartographic**: maintains the map between plan and reality.
 *   cartographer is sui generis; promoted out of `maintenance` because it's
 *   the only archetype that writes to the planning surfaces.
 */
export type ArchetypeFamily =
  | 'generative'
  | 'critical'
  | 'maintenance'
  | 'observational'
  | 'cartographic';

/**
 * Coarse-grained cost class. Backends and per-spawn LLM tokens vary, but
 * these three buckets are stable enough for budget gates and UI badges.
 *
 * - **low**: ≤$0.25/day budget. Cloudflare workers-ai class.
 * - **medium**: ≤$1.50/day. Haiku class.
 * - **high**: >$1.50/day. Sonnet/Opus class; only for novel reasoning.
 */
export type CostClass = 'low' | 'medium' | 'high';

/**
 * One archetype template. Defaults match the §5.1 table; the `select`
 * predicate is the deterministic survey→archetype mapping rule.
 *
 * Fields marked "(retool)" are optional on the original twelve archetypes
 * but populated on the eight added 2026-05-20. They carry the richer
 * metadata that ADR-0031/0032 specified and that the fleet GitHub-output
 * retool relies on. Existing call sites read them as `archetype.family ??
 * 'maintenance'` and similar — no breaking change.
 */
export interface Archetype {
  /** Stable ID. Lives in proposed YAML under `archetype:`. */
  id: ArchetypeId;
  /** Human-friendly display name. Title case, no emoji. */
  name: string;
  /** One-line purpose. Used in proposed YAML `rationale:` prefix. */
  purpose: string;
  /** Default trigger — operators may override per-project. */
  defaultTrigger: ArchetypeTrigger;
  /** Default model tier for the agent's runtime. */
  defaultModelTier: FleetModelTier;
  /** Default per-spawn bond in USD. Bond ceiling is per-project. */
  defaultBondUsd: number;
  /** Default per-day budget cap in USD. */
  defaultBudgetUsdPerDay: number;
  /**
   * (retool) Coarse family taxonomy. Used to group archetypes in `ARCHETYPES`
   * ordering and in UI surfaces. Defaults to `'maintenance'` on the
   * original twelve.
   */
  family?: ArchetypeFamily;
  /**
   * (retool) The archetype ID this one pairs with — generative↔critical
   * symmetry. `spider` ↔ `unspider`, `test-author` ↔ `tautology-sniffer`,
   * `code-reviewer` ↔ `red-team`. `null` means the archetype has no pair
   * (tenderfoot, dock-master, etc.). Pair-with-opposite is informational;
   * Shipwright does not auto-spawn pairs.
   */
  pairsWith?: ArchetypeId | null;
  /**
   * (retool) One-line description (operator-facing). Distinct from `purpose`
   * which lives in YAML; `description` is for `pd shipwright list` output
   * and similar UI. Optional — falls back to `purpose`.
   */
  description?: string;
  /**
   * (retool) Trigger event names this archetype subscribes to. The string
   * form is the fleet-engine subscription tag (e.g. `'pull_request:opened'`,
   * `'cron:nightly'`). Distinct from `defaultTrigger` which is the closed-
   * grammar kind; `triggers` carries the runtime event names that
   * lib/fleet-engine.ts and the GitHub bridge resolve against.
   */
  triggers?: readonly string[];
  /**
   * (retool) Output sinks. Stable tags consumed by `lib/fleet/github-output.ts`
   * and the future generalized output-sink registry (see active session
   * "Generalize fleet beyond GitHub: pluggable triggers + output sinks").
   * Examples: `'github:pr-comment'`, `'github:issue'`, `'github:draft-pr'`,
   * `'feedback:create'`, `'inbox:actor:user'`, `'cartographer_drafts'`.
   */
  outputs?: readonly string[];
  /**
   * (retool) Cost class for UI badges and the budget gate. Falls back
   * to a derivation from `defaultBudgetUsdPerDay`.
   */
  costClass?: CostClass;
  /**
   * (retool) Default body for the proposed YAML, as declarative intent.
   *
   * SUPPLANTED (2026-08-23): this was a slug embedding a concrete model id
   * (`'cloudflare:@cf/qwen/qwen3-30b-a3b-fp8'`), two of which named models that
   * had already been retired — the shape that lets dead ids sit unnoticed in a
   * field nothing reads yet. A (backend, capability) pair is what the proposed
   * YAML now carries, and it resolves through the registry at emit time.
   * Runtime backend resolution stays in `lib/llm-backend-resolver.ts`.
   */
  backendDefault?: BackendIntent;
  /**
   * (retool) Body to escalate to for harder cases (novel construction, big-lane
   * recommendation prose). `null` = no escalation lane.
   */
  backendEscalation?: BackendIntent | null;
  /**
   * Skills this archetype prefers when present in the catalog. Used as a
   * boost during cosine retrieval — concrete skill IDs already known to
   * apply, not a hard filter. Empty when the archetype has no canonical
   * skill anchor (e.g. `dock-master` is purely operational).
   */
  preferredSkills: string[];
  /**
   * Embedding query used for cosine retrieval against the skill catalog.
   * Worded as the kind of skill the archetype wants, not the archetype's
   * own job — embeddings work better with target-shaped text.
   */
  skillQuery: string;
  /**
   * Prompt template. `{project}`, `{purpose}`, `{rationale}`, `{skills}`,
   * `{branch}`, `{sha}` are substituted at propose time the same way
   * existing fleet template tokens are resolved (see `getTemplateVars`
   * in `fleet-engine.ts`).
   */
  promptTemplate: string;
  /**
   * Predicate over the survey JSON. Returns a non-zero score when the
   * archetype is a fit for this project; 0 means "do not include." Score
   * is used for ranking when more than 8 archetypes match (the §5
   * upper bound on fleet size).
   */
  select: (signals: ArchetypeSelectionSignals) => number;
}

/**
 * Subset of the survey output that `Archetype.select()` reads. Keeping
 * this narrow lets the catalog stay portable — adding fields to the
 * survey shape doesn't ripple into every archetype predicate.
 */
export interface ArchetypeSelectionSignals {
  hasTests: boolean;
  testsPassing: boolean | null;
  ciRed: boolean;
  testSuites: number;
  hasFleet: boolean;
  hasReadme: boolean;
  hasClaudeMd: boolean;
  hasManifest: boolean;
  hasSentry: boolean;
  hasGithubActions: boolean;
  hasPlaywright: boolean;
  /** "hot" | "warm" | "cool" | "cold" from survey.status.activity. */
  activity: 'hot' | 'warm' | 'cool' | 'cold';
  commitsLast30d: number;
  /** "server-daemon" | "web-app" | "mobile" | "lib" | "cli" | "site". */
  kind: string;
  /** Lowercased framework names extracted from package.json/etc. */
  frameworks: string[];
  /** TS strict-mode on? Heuristic from tsconfig.json. */
  strictTs: boolean;
  /** Repo has documentation drift signals (CLAUDE.md older than README, etc.). */
  docDrift: boolean;
  /** Repo has explicit perf-sensitive paths (e.g. middleware/, hot-path tags). */
  perfHotPaths: boolean;
}

const ALL_ARCHETYPES: readonly Archetype[] = [
  {
    id: 'gardener',
    name: 'Gardener',
    purpose: 'Remove deprecated code, tighten types, prune dead branches.',
    defaultTrigger: { kind: 'cron', cron: '0 9 * * *' },
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.50,
    preferredSkills: ['code-necromancer', 'refactoring-surgeon', 'simplify'],
    skillQuery: 'identifying and removing dead code, deprecated APIs, and unused imports while preserving behavior',
    promptTemplate: `You are the Gardener for {project}.

Purpose: {purpose}

Each daily run, scan recent diffs for: dead exports, unreferenced symbols, deprecated framework patterns, and TODO/FIXME comments older than 30 days. Open ONE small PR per run with a clear before/after summary.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      // Always-on for any project with a non-trivial codebase.
      if (s.commitsLast30d < 5) return 0;
      let score = 0.5;
      if (s.activity === 'hot' || s.activity === 'warm') score += 0.3;
      if (s.strictTs) score += 0.1;
      return score;
    },
  },
  {
    id: 'qa-sentinel',
    name: 'QA Sentinel',
    purpose: 'Run tests on every PR, triage failures, post structured triage.',
    defaultTrigger: { kind: 'git-pr' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.25,
    defaultBudgetUsdPerDay: 1.00,
    preferredSkills: ['vitest-testing-patterns', 'test-automation-expert', 'qa-automation-specialist'],
    skillQuery: 'running test suites on pull requests, parsing failures, and producing actionable triage notes',
    promptTemplate: `You are the QA Sentinel for {project}.

Purpose: {purpose}

On every PR open or push, run the full test suite. If failures occur, classify each: regression vs flake vs environment. Post a triage comment with: failing test name, suspected cause, and one suggested next step. Never mark a test as flaky without 3 consecutive runs of evidence.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasTests) return 0;
      let score = 0.7;
      if (s.testSuites >= 10) score += 0.2;
      if (s.hasGithubActions) score += 0.1;
      if (s.ciRed) score += 0.2; // urgent need
      return score;
    },
  },
  {
    id: 'test-gap-hunter',
    name: 'Test Gap Hunter',
    purpose: 'Find uncovered branches, propose tests for them.',
    defaultTrigger: { kind: 'cron', cron: '0 12 * * 0' }, // Sundays noon
    defaultModelTier: 'mid',
    defaultBondUsd: 0.20,
    defaultBudgetUsdPerDay: 0.75,
    preferredSkills: ['vitest-testing-patterns', 'test-automation-expert'],
    skillQuery: 'identifying uncovered code branches and writing focused unit tests with realistic test data',
    promptTemplate: `You are the Test Gap Hunter for {project}.

Purpose: {purpose}

Each weekly run, identify the 5 highest-traffic untested branches (by recent commit frequency × cyclomatic complexity). Open ONE PR with tests for the top branch. Skip files with existing TODO comments about tests — don't duplicate human work.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasTests) return 0;
      // Skip if test suite is already comprehensive.
      if (s.testSuites > 100) return 0.2;
      let score = 0.5;
      if (s.activity === 'hot') score += 0.2;
      return score;
    },
  },
  {
    id: 'documentarian',
    name: 'Documentarian',
    purpose: 'Sync README / CLAUDE.md / manifest when they drift from code.',
    defaultTrigger: { kind: 'file-watch', paths: ['README.md', 'CLAUDE.md', 'AGENTS.md', 'docs/**/*.md', 'features.manifest.json'] },
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.30,
    preferredSkills: ['technical-writer', 'devtool-documentation', 'api-documentation-generator'],
    skillQuery: 'detecting drift between source code and documentation and producing minimal sync commits',
    promptTemplate: `You are the Documentarian for {project}.

Purpose: {purpose}

When source files change, check whether README, CLAUDE.md, AGENTS.md, or any referenced docs need updates. Open small targeted PRs — one drift fix per PR. Never delete docs without explicit instruction.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasReadme && !s.hasClaudeMd) return 0;
      let score = 0.5;
      if (s.hasManifest) score += 0.2;
      if (s.docDrift) score += 0.3;
      return score;
    },
  },
  {
    id: 'simplifier',
    name: 'Simplifier',
    purpose: 'Propose refactors that reduce LOC without changing behavior.',
    defaultTrigger: { kind: 'cron', cron: '0 10 * * 1' }, // Mondays 10am
    defaultModelTier: 'mid',
    defaultBondUsd: 0.30,
    defaultBudgetUsdPerDay: 1.00,
    preferredSkills: ['simplify', 'refactoring-surgeon', 'high-quality-vibe-coding'],
    skillQuery: 'identifying overcomplicated code and proposing equivalent simpler implementations with measurable LOC reduction',
    promptTemplate: `You are the Simplifier for {project}.

Purpose: {purpose}

Each weekly run, pick ONE module (>200 LOC, no recent simplification) and propose a refactor that: (a) preserves all tests, (b) reduces LOC by ≥15%, (c) improves cyclomatic complexity. Show before/after metrics in the PR description.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (s.commitsLast30d < 10) return 0;
      let score = 0.4;
      if (s.activity === 'hot' || s.activity === 'warm') score += 0.2;
      return score;
    },
  },
  {
    id: 'research-scout',
    name: 'Research Scout',
    purpose: 'Scout external inspiration and best practices, file as tuples.',
    defaultTrigger: { kind: 'cron', cron: '0 15 * * 3' }, // Wednesdays 3pm
    defaultModelTier: 'low',
    defaultBondUsd: 0.05,
    defaultBudgetUsdPerDay: 0.20,
    preferredSkills: ['research-craft', 'research-analyst', 'competitive-cartographer'],
    skillQuery: 'scouting external research, blog posts, and engineering practices relevant to a project domain',
    promptTemplate: `You are the Research Scout for {project}.

Purpose: {purpose}

Each weekly run, find 3-5 external pieces (blog posts, papers, repos) directly relevant to this project's stack ({frameworks}) or domain. File each as a tuple under \`research:scout:{project}\` with: title, URL, why-relevant (1 sentence), and a confidence score.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      // Useful for any active project but not load-bearing.
      if (s.activity === 'cold') return 0;
      return 0.35;
    },
  },
  {
    id: 'dock-master',
    name: 'Dock Master',
    purpose: 'Orchestrate launches, check service health on claim.',
    defaultTrigger: { kind: 'service-claim' },
    defaultModelTier: 'low',
    defaultBondUsd: 0.05,
    defaultBudgetUsdPerDay: 0.20,
    preferredSkills: [],
    skillQuery: 'monitoring service startup health, port readiness, and dependency liveness',
    promptTemplate: `You are the Dock Master for {project}.

Purpose: {purpose}

When a service is claimed, verify: (a) the port is bound within 30s, (b) the health endpoint responds 200, (c) no port conflicts with prior claims. Post status to the service's project channel.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      // Most useful for server-daemon and web-app kinds.
      if (s.kind !== 'server-daemon' && s.kind !== 'web-app' && s.kind !== 'cli') return 0;
      return 0.5;
    },
  },
  {
    id: 'spark',
    name: 'Spark',
    purpose: 'Long-form strategy and vision refresh based on recent activity.',
    defaultTrigger: { kind: 'cron', cron: '0 9 1 * *' }, // monthly, 1st of month
    defaultModelTier: 'high',
    defaultBondUsd: 1.00,
    defaultBudgetUsdPerDay: 2.00,
    preferredSkills: ['systems-thinking', 'polya-problem-solving', 'recursive-synthesis'],
    skillQuery: 'long-form strategic synthesis of project trajectory, vision documents, and architectural direction',
    promptTemplate: `You are Spark for {project}.

Purpose: {purpose}

Each monthly run, read the last 30 days of commits, notes, and roadmap docs. Produce ONE strategy document: where this project is heading, what's blocked, and 3 concrete next bets. Land as a doc PR for human review — never auto-merge.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (s.commitsLast30d < 30) return 0;
      let score = 0.4;
      if (s.activity === 'hot') score += 0.3;
      return score;
    },
  },
  {
    id: 'sentry-responder',
    name: 'Sentry Responder',
    purpose: 'Jump on production errors as they fire.',
    defaultTrigger: { kind: 'sentry-webhook' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.50,
    defaultBudgetUsdPerDay: 2.00,
    preferredSkills: ['fullstack-debugger', 'crisis-response-protocol', 'error-handling-patterns'],
    skillQuery: 'triaging production errors from monitoring webhooks and proposing minimal hotfix patches',
    promptTemplate: `You are the Sentry Responder for {project}.

Purpose: {purpose}

When a Sentry alert fires, fetch the stack + breadcrumbs, identify the offending commit (git blame hot frame), and propose ONE of: (a) a hotfix PR if root cause is local + obvious, (b) a triage note if it needs human eyes. Never deploy without approval.

Skills available: {skills}

{rationale}`,
    select: (s) => (s.hasSentry ? 0.8 : 0),
  },
  {
    id: 'perf-hawk',
    name: 'Perf Hawk',
    purpose: 'Detect performance regressions on hot paths.',
    defaultTrigger: { kind: 'ci-duration' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.30,
    defaultBudgetUsdPerDay: 1.00,
    preferredSkills: ['performance-profiling', 'react-performance-optimizer', 'cost-optimizer'],
    skillQuery: 'analyzing CI duration deltas and runtime profiles to detect performance regressions and propose targeted fixes',
    promptTemplate: `You are the Perf Hawk for {project}.

Purpose: {purpose}

When CI duration grows >20% from baseline, identify which test suites or build steps slowed. Compare the offending commit's diff against the slowdown signature. Open ONE issue OR PR with a profile snippet and a hypothesis.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasGithubActions) return 0;
      let score = s.perfHotPaths ? 0.6 : 0.3;
      if (s.activity === 'hot') score += 0.1;
      return score;
    },
  },
  {
    id: 'browser-canary',
    name: 'Browser Canary',
    purpose: 'Playwright hot-path checks on site deploys.',
    defaultTrigger: { kind: 'deploy-webhook' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.25,
    defaultBudgetUsdPerDay: 0.75,
    preferredSkills: ['webapp-testing', 'playwright-screenshot-inspector', 'accessibility-automation-expert'],
    skillQuery: 'running headless browser smoke tests against deployed sites and reporting visual or behavioral regressions',
    promptTemplate: `You are the Browser Canary for {project}.

Purpose: {purpose}

After every deploy webhook, run Playwright in headless mode against the deployed URL. Check: (a) the homepage 200s, (b) primary CTAs render, (c) console has no errors. Report a structured failure if any check trips.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasPlaywright && s.kind !== 'web-app' && s.kind !== 'site') return 0;
      let score = 0.4;
      if (s.hasPlaywright) score += 0.3;
      if (s.kind === 'site') score += 0.2;
      return score;
    },
  },
  {
    id: 'typesafety-sweeper',
    name: 'Typesafety Sweeper',
    purpose: 'Remove `any`, tighten generics, replace assertions with guards.',
    defaultTrigger: { kind: 'file-watch', paths: ['**/*.ts', '**/*.tsx'] },
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.40,
    preferredSkills: ['typescript-advanced-patterns', 'refactoring-surgeon'],
    skillQuery: 'tightening TypeScript types by removing any, narrowing generics, and replacing type assertions with runtime guards',
    promptTemplate: `You are the Typesafety Sweeper for {project}.

Purpose: {purpose}

When .ts or .tsx files change, scan for: \`any\` annotations, \`as\` assertions on unknown shapes, untyped function returns. Open small PRs (one file each) with concrete type narrowings. Skip code that uses \`any\` intentionally with a // eslint-disable comment.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.frameworks.some((f) => /typescript|next|react|fastify|nest/i.test(f))) return 0;
      let score = 0.3;
      if (s.strictTs) score += 0.3; // already cares about types — boost
      return score;
    },
  },
  // ----------------------------------------------------------------------
  // 2026-05-20 retool additions: ADR-0031/0032 + GitHub-output fleet ships.
  // Order below is declaration order; semantic ordering (family→alpha)
  // is exposed via the `ARCHETYPES` export at the bottom of this file.
  // ----------------------------------------------------------------------
  {
    id: 'cartographer',
    name: 'Cartographer',
    purpose: 'Maintain the map between what we planned, what we built, and what remains.',
    description: 'Single writer of NEXT-CUTS / IDEAS-TROVE / DOGFOOD-FEEDBACK / CURRENT-WORK. Harvests dogfood feedback and promotes severity-tagged entries into roadmap_items.',
    family: 'cartographic',
    pairsWith: null,
    triggers: ['cron:every-30m', 'event:roadmap.feedback-open'],
    outputs: ['cartographer-state', 'roadmap_items', 'docs/recovery/*'],
    costClass: 'low',
    backendDefault: { backend: 'cloudflare', capability: 'cheap' },
    backendEscalation: null,
    defaultTrigger: { kind: 'cron', cron: '*/30 * * * *' },
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.50,
    preferredSkills: ['systems-thinking', 'technical-writer', 'recursive-synthesis'],
    skillQuery: 'maintaining a living roadmap by reconciling planning documents with commit reality and harvesting dogfood feedback into structured queue entries',
    promptTemplate: `You are the Cartographer for {project}.

Purpose: {purpose}

Each run, reconcile the roadmap against recent commits, harvest dogfood feedback into the curated trove, and promote severity-tagged entries into roadmap_items via \`pd roadmap promote\`. Do NOT rewrite the roadmap's voice. You update status fields and add notes; the roadmap is the operator's document.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasReadme && !s.hasManifest) return 0;
      let score = 0.5;
      if (s.hasManifest) score += 0.2;
      if (s.activity === 'hot' || s.activity === 'warm') score += 0.2;
      return score;
    },
  },
  {
    id: 'spider',
    name: 'Spider',
    purpose: 'Surface patterns from session activity into draft roadmap entries.',
    description: 'Generative half of the Spider/unSpider pair (ADR-0031). Reads activity, session_notes, transcripts, feedback; drafts NEXT-CUT and IDEAS entries to a `cartographer_drafts` queue that Cartographer absorbs.',
    family: 'generative',
    pairsWith: 'unspider',
    triggers: ['cron:nightly', 'event:sortie.completed:n=5', 'manual:pd spider'],
    outputs: ['cartographer_drafts'],
    costClass: 'low',
    backendDefault: { backend: 'cloudflare', capability: 'cheap' },
    backendEscalation: { backend: 'claude', capability: 'cheap' },
    defaultTrigger: { kind: 'cron', cron: '0 4 * * *' }, // 4am, before operator wakes
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.30,
    preferredSkills: ['recursive-synthesis', 'systems-thinking', 'research-craft'],
    skillQuery: 'surfacing roadmap-promotion candidates from session activity, transcripts, and feedback streams using BM25 and structural pattern detection',
    promptTemplate: `You are Spider for {project}.

Purpose: {purpose}

Read activity, session_notes, transcripts, and feedback. Find file-coupling clusters, repeated phrases, and graduating feedback. For each candidate, produce a draft with ≥3 evidence rows from ≥2 source types. Cartographer reviews and accepts/rejects. Confidence threshold 0.6.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (s.commitsLast30d < 10) return 0;
      let score = 0.4;
      if (s.hasFleet) score += 0.2;
      if (s.activity === 'hot') score += 0.2;
      return score;
    },
  },
  {
    id: 'unspider',
    name: 'unSpider',
    purpose: 'Hunt contradictions, overlaps, and stale references across the roadmap and code reality.',
    description: 'Critical half of the Spider/unSpider pair (ADR-0032). Detects roadmap collisions, sortie claim overlaps, doc-code drift, stale memory paths, duplicate feedback, orphan cuts, budget-exhausted blockers, PR merge collisions. Small severity → feedback; big → inbox:user.',
    family: 'critical',
    pairsWith: 'spider',
    triggers: ['event:cartographer.write', 'event:sortie.completed', 'event:claim.acquired', 'event:draft.created:spider', 'cron:daily', 'manual:pd unspider'],
    outputs: ['feedback:create', 'inbox:actor:user'],
    costClass: 'low',
    backendDefault: { backend: 'cloudflare', capability: 'cheap' },
    backendEscalation: { backend: 'claude', capability: 'cheap' },
    defaultTrigger: { kind: 'cartographer-write' },
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.20,
    preferredSkills: ['systems-thinking', 'logical-fallacy-detector', 'steel-man-argument'],
    skillQuery: 'detecting contradictions, overlaps, and stale references across roadmap entries, code, docs, and active session claims using structural detectors and BM25 similarity',
    promptTemplate: `You are unSpider for {project}.

Purpose: {purpose}

Sweep for the eight detector kinds (roadmap-collision, sortie-claim-overlap, doc-code-drift, stale-memory-path, duplicate-feedback, orphan-cut, budget-exhausted-blocker, pr-merge-collision). Two-evidence minimum. Small severity → feedback; big → inbox:actor:user. Detection is structural; LLM only judges ambiguous cases and writes big-lane recommendation prose.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasReadme && !s.hasManifest) return 0;
      let score = 0.4;
      if (s.docDrift) score += 0.3;
      if (s.hasFleet) score += 0.2;
      return score;
    },
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    purpose: 'Catch the bugs a diff would otherwise ship; cite ADRs when intent drifts.',
    description: 'Reads every changed file on PR open/sync. Severity tiers HIGH/MEDIUM/LOW/SCOPE; HIGH must cite a specific line or ADR. One PR comment per PR, edited in place. Signal:noise ≥ 4:1 is the bar — silence is a valid output.',
    family: 'critical',
    pairsWith: 'red-team',
    triggers: ['pull_request:opened', 'pull_request:synchronize'],
    outputs: ['github:pr-comment'],
    costClass: 'medium',
    backendDefault: { backend: 'claude', capability: 'cheap' },
    backendEscalation: { backend: 'claude', capability: 'balanced' },
    defaultTrigger: { kind: 'git-pr' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.30,
    defaultBudgetUsdPerDay: 1.50,
    preferredSkills: ['code-review-checklist', 'refactor-architect', 'typescript-advanced-patterns'],
    skillQuery: 'reading pull request diffs end-to-end and identifying bugs the diff would otherwise ship, citing specific lines and architectural decisions',
    promptTemplate: `You are the Code Reviewer for {project}.

Purpose: {purpose}

Read \`gh pr diff <N>\`, the operator's memory directory, and the ADR index for every changed file. Find bugs the diff would otherwise ship. HIGH = blocking, must cite a line or ADR. MEDIUM = resolve before merge. LOW = clustered. SCOPE = open an issue, not a PR comment. Empty findings → post nothing.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasGithubActions) return 0;
      let score = 0.5;
      if (s.activity === 'hot' || s.activity === 'warm') score += 0.2;
      if (s.strictTs) score += 0.1;
      return score;
    },
  },
  {
    id: 'red-team',
    name: 'Red Team',
    purpose: 'Try to break adversarially-interesting diffs; comment the trace, or stay silent.',
    description: 'Surface-gated: only fires when the diff touches capability code, token verification, bond logic, crypto, salvage, arbiter, or file claims. Probes capability escalation, replay, race, cost overrun, equivocation, TOCTOU, auth bypass. Posts only landed attacks.',
    family: 'critical',
    pairsWith: 'code-reviewer',
    triggers: ['pull_request:opened'],
    outputs: ['github:pr-comment'],
    costClass: 'high',
    backendDefault: { backend: 'claude', capability: 'balanced' },
    backendEscalation: null,
    defaultTrigger: { kind: 'git-pr' },
    defaultModelTier: 'high',
    defaultBondUsd: 0.50,
    defaultBudgetUsdPerDay: 1.00,
    preferredSkills: ['redteam-review', 'security-auditor', 'cryptoeconomic-protocol-security'],
    skillQuery: 'constructing concrete attacks against capability code, authentication, bond logic, file claims, and arbiter invariants with falsifiable repro pseudocode',
    promptTemplate: `You are the Red Team for {project}.

Purpose: {purpose}

The surface gate must have fired (capabilities/auth/bonds/arbiter/claims/crypto touched). For each attack category, write down a falsifiable form, repro construction, and outcome. Only LANDED attacks get posted — silence is the success state. Cite line numbers and attach the smallest repro.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasGithubActions) return 0;
      // Heuristic: high-trust projects (server-daemon kind, fleet present) are
      // worth running red-team on; pure libs/sites less so.
      if (s.kind !== 'server-daemon' && s.kind !== 'web-app' && !s.hasFleet) return 0;
      let score = 0.4;
      if (s.activity === 'hot') score += 0.2;
      return score;
    },
  },
  {
    id: 'test-author',
    name: 'Test Author',
    purpose: 'Write the tests that test-hunter flagged as missing; ship as a sibling draft PR.',
    description: 'Triggered when test-hunter flags uncovered code in the current PR or the PR carries `needs-tests`. Authors meaningful tests (spies on dependencies, asserts on values not shapes, tests error paths) and opens a draft sibling PR.',
    family: 'generative',
    pairsWith: 'tautology-sniffer',
    triggers: ['pull_request:opened', 'label:needs-tests', 'event:test-hunter.coverage-gap'],
    outputs: ['github:draft-pr', 'github:pr-comment'],
    costClass: 'medium',
    backendDefault: { backend: 'claude', capability: 'cheap' },
    backendEscalation: null,
    defaultTrigger: { kind: 'git-pr' },
    defaultModelTier: 'mid',
    defaultBondUsd: 0.30,
    defaultBudgetUsdPerDay: 1.00,
    preferredSkills: ['vitest-testing-patterns', 'test-automation-expert', 'qa-automation-specialist'],
    skillQuery: 'authoring framework-agnostic tests that spy on dependencies, assert on values, exercise error paths and boundaries, and would fail if the function body became a no-op',
    promptTemplate: `You are the Test Author for {project}.

Purpose: {purpose}

When test-hunter flags coverage-gap on a PR (or the PR carries \`needs-tests\`), write the missing tests on a branch \`test-author/<original>-tests\`. Spy on every dependency. Assert on values, not shapes. Test error paths and boundaries. RUN the tests, verify PASS, verify build. Open a draft sibling PR; comment one link on the original.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasTests || !s.hasGithubActions) return 0;
      let score = 0.4;
      if (s.testSuites < 50) score += 0.2; // low coverage = more work for test-author
      return score;
    },
  },
  {
    id: 'tautology-sniffer',
    name: 'Tautology Sniffer',
    purpose: 'Flag tests that cannot falsify — mocks asserting their own returns, coverage theater.',
    description: 'Triggered on PRs that touch test files. Scores each new/changed test on the tautology axis (mocks-all, asserts-on-mock-return, no-anchor, shape-not-value assertions). Score ≥5 = HIGH; 2-4 = MEDIUM clustered; <2 = silent.',
    family: 'critical',
    pairsWith: 'test-author',
    triggers: ['pull_request:opened'],
    outputs: ['github:pr-comment'],
    costClass: 'low',
    backendDefault: { backend: 'openai', capability: 'cheap' },
    backendEscalation: null,
    defaultTrigger: { kind: 'git-pr' },
    defaultModelTier: 'low',
    defaultBondUsd: 0.15,
    defaultBudgetUsdPerDay: 0.50,
    preferredSkills: ['vitest-testing-patterns', 'test-automation-expert', 'code-review-checklist'],
    skillQuery: 'detecting tautological tests — mocks-all combined with assertions on the mock\'s own return value, no fixture or daemon anchor, assertions on type rather than value',
    promptTemplate: `You are the Tautology Sniffer for {project}.

Purpose: {purpose}

For each new/modified test, score the tautology weight: mocks-all (+3), asserts on mocked return (+4), no anchor (+2), shape-only assertion (+2), exact-value assertion (-2), fixture/daemon read (-2), would-fail-on-noop (-3). Score ≥5 = HIGH with rewrite suggestion. Quote the offending line; cluster MEDIUMs by file. Resist the urge to simplify to a regex.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasTests || !s.hasGithubActions) return 0;
      let score = 0.4;
      if (s.testSuites >= 30) score += 0.2;
      return score;
    },
  },
  {
    id: 'tenderfoot',
    name: 'Tenderfoot',
    purpose: 'Read the project as a brand-new developer; file issues where docs lie or tribal knowledge isn\'t in the repo.',
    description: 'Renamed from the retool-era "unspider" (ADR-0032 kept that name). Outside-in critic: follows the README install steps, runs canonical examples, notes every place docs lie or required knowledge isn\'t in the repo. Files GitHub issues with label `unspider:open` (legacy label, kept for continuity).',
    family: 'observational',
    pairsWith: null, // outsider perspective is sui generis
    triggers: ['cron:weekly-monday-8am', 'pull_request:merged'],
    outputs: ['github:issue'],
    costClass: 'low',
    backendDefault: { backend: 'claude', capability: 'cheap' },
    backendEscalation: null,
    defaultTrigger: { kind: 'cron', cron: '0 8 * * 1' }, // Mondays 8am
    defaultModelTier: 'low',
    defaultBondUsd: 0.10,
    defaultBudgetUsdPerDay: 0.25,
    preferredSkills: ['technical-writer', 'devtool-documentation', 'ux-friction-analyzer'],
    skillQuery: 'reading a project as a brand-new developer would, following install instructions and tutorials, and identifying where documentation lies or tribal knowledge sits outside the repo',
    promptTemplate: `You are Tenderfoot for {project}.

Purpose: {purpose}

Pre-flight: README, AGENTS.md, CLAUDE.md, docs/tutorials/, features.manifest.json, the CLI entrypoint, and existing \`unspider:open\` issues. File an issue when docs lie, code contradicts docs, or required knowledge isn't in the repo. NOT for style preferences, missing features, or test coverage. Cite both source-of-truth and the surface that's wrong. Don't soften.

Skills available: {skills}

{rationale}`,
    select: (s) => {
      if (!s.hasReadme) return 0;
      let score = 0.4;
      if (s.docDrift) score += 0.3;
      if (s.hasClaudeMd) score += 0.1;
      return score;
    },
  },
];

/** Lookup by archetype ID. Throws on unknown — defensive at the caller level. */
const INDEX = new Map<ArchetypeId, Archetype>(ALL_ARCHETYPES.map((a) => [a.id, a]));

/** Returns the archetype for an ID. Throws on unknown ID — fail loud. */
export function getArchetype(id: ArchetypeId): Archetype {
  const archetype = INDEX.get(id);
  if (!archetype) throw new Error(`Unknown archetype ID: ${id}`);
  return archetype;
}

/** All archetypes in catalog declaration order. */
export function listArchetypes(): readonly Archetype[] {
  return ALL_ARCHETYPES;
}

/**
 * Family-ordering for `ARCHETYPES`. Generative first (forward-pressure),
 * then critical (back-pressure), then maintenance and observational, then
 * the lone cartographic role. This mirrors how the operator describes the
 * fleet's loop in `docs/fleet/2026-05-20-retool.md`: ideas surface,
 * adversaries judge, maintenance keeps the substrate honest, outsiders
 * catch what insiders normalized, and cartographer keeps the map current.
 */
const FAMILY_ORDER: readonly ArchetypeFamily[] = [
  'generative',
  'critical',
  'maintenance',
  'observational',
  'cartographic',
];

/**
 * Resolve an archetype's family, defaulting to `'maintenance'` for the
 * original twelve that predate the family taxonomy. Keeps the catalog
 * legal without retroactively reclassifying every entry.
 */
export function archetypeFamily(a: Archetype): ArchetypeFamily {
  if (a.family) return a.family;
  // Sensible defaults for the original twelve based on their purpose. These
  // are advisory only — the closed-catalog tests don't depend on them.
  switch (a.id) {
    case 'spark':
      return 'generative';
    case 'qa-sentinel':
    case 'sentry-responder':
      return 'critical';
    case 'browser-canary':
    case 'dock-master':
    case 'research-scout':
      return 'observational';
    default:
      return 'maintenance';
  }
}

/**
 * The canonical fleet roster — every archetype Shipwright can propose,
 * ordered family → alphabetical. Stable iteration order so `pd shipwright
 * list`, generated docs, and the Fleet Control UI all read the same way.
 *
 * This is the source of truth consumers should bind to when they want a
 * deterministic ordering. `listArchetypes()` returns declaration order
 * (kept for back-compat with the original tests).
 */
export const ARCHETYPES: readonly Archetype[] = [...ALL_ARCHETYPES].sort((a, b) => {
  const familyDelta = FAMILY_ORDER.indexOf(archetypeFamily(a)) - FAMILY_ORDER.indexOf(archetypeFamily(b));
  if (familyDelta !== 0) return familyDelta;
  return a.id.localeCompare(b.id);
});

/**
 * Score every archetype against a survey's selection signals. Returns
 * archetypes with a non-zero score in descending score order. The caller
 * applies the §5 fleet-size bounds (3 minimum, 8 maximum) by truncation.
 *
 * @example
 *   const ranked = rankArchetypes({ hasTests: true, testSuites: 50, ... });
 *   const proposed = ranked.slice(0, 8);
 */
export function rankArchetypes(signals: ArchetypeSelectionSignals): Array<{ archetype: Archetype; score: number }> {
  return ALL_ARCHETYPES
    .map((archetype) => ({ archetype, score: archetype.select(signals) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}
