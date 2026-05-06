/**
 * Shipwright Archetype Catalog
 *
 * The closed set of agent archetypes Shipwright can propose. Twelve roles
 * spec'd in `docs/shipwright/SHIPWRIGHT-DESIGN.md §5.1`. Each archetype
 * carries a canonical purpose, default backend/model tier, default trigger,
 * default bond, default budget, and a prompt template.
 *
 * Why a closed catalog:
 * - FleetControl can enforce trigger handlers are real code (closed grammar).
 * - Operators can audit "what kind of agent is this?" with a single name.
 * - Skill retrieval has a stable axis to tune against.
 * - Diffs across `pd shipwright propose` runs read as archetype add/remove,
 *   not as opaque YAML noise.
 *
 * Adding a 13th archetype is a deliberate change, not a one-liner.
 */

import type { FleetModelTier } from '../fleet-engine.js';

/**
 * One of the twelve canonical archetype identifiers. Used as the
 * `archetype:` field in proposed YAML and as the join key for skill
 * retrieval. Keep in sync with `ALL_ARCHETYPES` below.
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
  | 'typesafety-sweeper';

/**
 * The closed trigger grammar from `docs/shipwright/SHIPWRIGHT-DESIGN.md §5.2`.
 * A new trigger kind requires a daemon-side handler, so adding one is a
 * coordinated change, not a YAML edit.
 */
export type TriggerKind =
  | 'cron'
  | 'git-push'
  | 'git-pr'
  | 'file-watch'
  | 'sentry-webhook'
  | 'deploy-webhook'
  | 'ci-duration'
  | 'service-claim'
  | 'tuple-pattern'
  | 'manual';

/**
 * Default trigger spec attached to an archetype. Operators can override at
 * propose time, but every archetype ships with one sensible default so the
 * proposed YAML is runnable as-is.
 */
export interface ArchetypeTrigger {
  kind: TriggerKind;
  /** Cron expression — required when `kind: cron`. */
  cron?: string;
  /** Glob list — required when `kind: file-watch`. */
  paths?: string[];
}

/**
 * One archetype template. Defaults match the §5.1 table; the `select`
 * predicate is the deterministic survey→archetype mapping rule.
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
];

/** Lookup by archetype ID. Throws on unknown — defensive at the caller level. */
const INDEX = new Map<ArchetypeId, Archetype>(ALL_ARCHETYPES.map((a) => [a.id, a]));

/** Returns the archetype for an ID. Throws on unknown ID — fail loud. */
export function getArchetype(id: ArchetypeId): Archetype {
  const archetype = INDEX.get(id);
  if (!archetype) throw new Error(`Unknown archetype ID: ${id}`);
  return archetype;
}

/** All twelve archetypes in catalog declaration order. */
export function listArchetypes(): readonly Archetype[] {
  return ALL_ARCHETYPES;
}

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
