/**
 * Shipwright Survey
 *
 * Reads a project root and emits a structured `ProjectSurvey` JSON object
 * that drives `pd shipwright propose`. Spec: `docs/shipwright/SHIPWRIGHT-DESIGN.md §4`.
 *
 * The survey is **deterministic and cheap** by default — pure file reads,
 * no LLM, ~50ms for a typical repo. When an `LLMClient` is injected, the
 * `intent` and `purpose` fields get a Haiku-class summarization (~$0.001/project).
 * Tests skip the LLM path entirely by leaving `client` undefined.
 *
 * Survey output is the single argument to `proposeFleet()` — keep this shape
 * stable. Adding a field is fine; removing a field is a breaking change.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { detectStack } from '../detect.js';
import type { LLMClient } from '../llm-call.js';

/** Coarse classification of what kind of project this is. Drives ship class in the UI. */
export type ProjectKind = 'server-daemon' | 'web-app' | 'mobile' | 'lib' | 'cli' | 'site' | 'app' | 'unknown';

/** Activity bucket from commit cadence + recent file edits. */
export type ProjectActivity = 'hot' | 'warm' | 'cool' | 'cold';

/**
 * Doc-freshness verdict from comparing CLAUDE.md / README / manifest mtimes
 * against recent code commits in the relevant subtrees.
 */
export type DocFreshness = 'current' | 'lagging' | 'stale' | 'absent';

/**
 * Output of `surveyProject(root)`. Stable shape — `proposeFleet()` and the
 * UI both consume this. Spec: §4.2 of SHIPWRIGHT-DESIGN.md.
 */
export interface ProjectSurvey {
  /** Project name — basename of the root directory. */
  project: string;
  /** Absolute path to the surveyed root. */
  root: string;
  /** ISO-8601 timestamp of when the survey ran. */
  surveyedAt: string;
  classification: {
    kind: ProjectKind;
    languages: string[];
    frameworks: string[];
    deliveryMedium: string;
    uiSurfaces: string[];
  };
  /** One-line intent. Heuristic stub: README first heading or filled by LLM. */
  intent: string;
  /** One-line purpose. Heuristic stub: README first paragraph lede or LLM. */
  purpose: string;
  status: {
    activity: ProjectActivity;
    commitsLast30d: number;
    openPRs: number | null;
    testSuites: number;
    testsPassing: boolean | null;
    ciRed: boolean;
    docFreshness: DocFreshness;
    hasFleet: boolean;
    fleetSizeAgents: number | null;
    sentryConfigured: boolean;
  };
  /** Files with the most recent commit churn — propose can target these. */
  hotFiles: string[];
  /** Heuristic risks. LLM expands this when present. */
  risks: string[];
  /** Heuristic opportunities. LLM expands this when present. */
  opportunities: string[];
  /** Best-effort daily cost hint based on detected fleet config. */
  costHintUsdPerDay: number | null;
  /** 0..1 confidence in the survey. Lower without an LLM call. */
  confidence: number;
}

export interface SurveyOptions {
  /** Optional LLM client for intent/purpose summarization. Skipped when omitted. */
  client?: LLMClient;
  /** Model ID for the summarization call. Caller picks haiku-class. */
  model?: string;
  /** How deep to walk the source tree counting LOC. Default 3. */
  depth?: number;
  /** Inject `Date.now()` for deterministic test output. */
  now?: () => Date;
  /**
   * Inject git command runner for tests. Args are passed as an argv-style
   * array — never shell-interpolated. Defaults to `execFileSync('git', args)`
   * in the surveyed `cwd`.
   */
  runGit?: (args: readonly string[], cwd: string) => string;
}

const DEFAULT_DEPTH = 3;

const HOT_FILE_LIMIT = 10;

/**
 * Run the survey. Pure function modulo the optional LLM call — same
 * filesystem state plus same `now()` produces the same JSON, with one caveat:
 * git output (commit count, hot files) reflects whatever HEAD points at.
 *
 * @example
 *   const survey = await surveyProject('/Users/me/coding/port-daddy');
 *   console.log(survey.classification.kind, survey.status.activity);
 *   // → "server-daemon" "hot"
 */
export async function surveyProject(root: string, options: SurveyOptions = {}): Promise<ProjectSurvey> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Survey root does not exist or is not a directory: ${root}`);
  }
  const now = (options.now ?? (() => new Date()))();
  const runGit = options.runGit ?? defaultRunGit;
  const depth = options.depth ?? DEFAULT_DEPTH;

  const project = basename(root);
  const stack = detectStack(root);
  const packageJson = readJsonSafe(join(root, 'package.json'));
  const pyproject = existsSync(join(root, 'pyproject.toml'));
  const cargoToml = existsSync(join(root, 'Cargo.toml'));
  const goMod = existsSync(join(root, 'go.mod'));
  const gemfile = existsSync(join(root, 'Gemfile'));

  const languages = detectLanguages({ packageJson, pyproject, cargoToml, goMod, gemfile });
  const frameworks = detectFrameworks(packageJson, stack);
  const kind = classifyKind({ stack, frameworks, packageJson, hasGoMod: goMod, hasCargo: cargoToml, hasPyProject: pyproject });
  const deliveryMedium = inferDeliveryMedium({ packageJson, kind, root });
  const uiSurfaces = inferUiSurfaces(root, packageJson);

  const hasReadme = existsSync(join(root, 'README.md'));
  const hasClaudeMd = existsSync(join(root, 'CLAUDE.md'));
  const hasManifest = existsSync(join(root, 'features.manifest.json'));
  const hasSentry = detectSentry(root);
  const hasGithubActions = existsSync(join(root, '.github/workflows'));
  const strictTs = detectStrictTs(root);

  const fleetPath = join(root, 'pd-fleet.yml');
  const hasFleet = existsSync(fleetPath);
  const fleetSizeAgents = hasFleet ? countFleetAgents(fleetPath) : null;

  const commitsLast30d = countCommitsLast30d(root, runGit);
  const hotFiles = collectHotFiles(root, runGit);
  const activity = bucketActivity(commitsLast30d);
  const testSuites = countTestSuites(root, depth);
  const testsPassing = null; // expensive to actually run; left for the propose step
  const ciRed = false; // requires GitHub API; out of scope for surface-level survey
  const docFreshness = assessDocFreshness({ hasReadme, hasClaudeMd, root, runGit });

  const heuristicIntent = extractHeuristicIntent(root, hasReadme, hasClaudeMd);
  const heuristicPurpose = extractHeuristicPurpose(root, hasReadme);
  let intent = heuristicIntent;
  let purpose = heuristicPurpose;
  let confidence = 0.55;
  const llmRisks: string[] = [];
  const llmOpportunities: string[] = [];

  if (options.client && options.model) {
    try {
      const summary = await callIntentLLM({
        client: options.client,
        model: options.model,
        project,
        kind,
        frameworks,
        readmeHead: readFileHead(join(root, 'README.md'), 4000),
        claudeMdHead: readFileHead(join(root, 'CLAUDE.md'), 4000),
        agentsMdHead: readFileHead(join(root, 'AGENTS.md'), 2000),
      });
      if (summary) {
        intent = summary.intent || heuristicIntent;
        purpose = summary.purpose || heuristicPurpose;
        for (const r of summary.risks) llmRisks.push(r);
        for (const o of summary.opportunities) llmOpportunities.push(o);
        confidence = 0.82;
      }
    } catch {
      // LLM failures are silent — heuristic output is preserved and the
      // confidence score reflects that the LLM didn't contribute.
    }
  }

  const heuristicRisks = collectHeuristicRisks({ hasFleet, hasManifest, hasSentry, hasGithubActions, strictTs, activity, testSuites });
  const heuristicOpportunities = collectHeuristicOpportunities({ hasReadme, hasClaudeMd, hasManifest, hasGithubActions, strictTs, hasFleet, frameworks, languages });
  const risks = dedupePreservingOrder([...heuristicRisks, ...llmRisks]);
  const opportunities = dedupePreservingOrder([...heuristicOpportunities, ...llmOpportunities]);

  const costHintUsdPerDay = hasFleet ? readFleetBudget(fleetPath) : null;

  return {
    project,
    root,
    surveyedAt: now.toISOString(),
    classification: { kind, languages, frameworks, deliveryMedium, uiSurfaces },
    intent,
    purpose,
    status: {
      activity,
      commitsLast30d,
      openPRs: null,
      testSuites,
      testsPassing,
      ciRed,
      docFreshness,
      hasFleet,
      fleetSizeAgents,
      sentryConfigured: hasSentry,
    },
    hotFiles,
    risks,
    opportunities,
    costHintUsdPerDay,
    confidence,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultRunGit(args: readonly string[], cwd: string): string {
  // Argv form via execFileSync — never spawns a shell, so positional args
  // can't be reinterpreted as commands. Returns empty string on any failure.
  try {
    return execFileSync('git', args as string[], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return '';
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readFileHead(path: string, maxBytes: number): string {
  if (!existsSync(path)) return '';
  try {
    const buf = readFileSync(path, 'utf-8');
    return buf.slice(0, maxBytes);
  } catch {
    return '';
  }
}

function detectLanguages(opts: { packageJson: Record<string, unknown> | null; pyproject: boolean; cargoToml: boolean; goMod: boolean; gemfile: boolean }): string[] {
  const out = new Set<string>();
  const pkg = opts.packageJson;
  if (pkg) {
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    if (deps?.typescript || deps?.['@types/node']) out.add('typescript');
    else out.add('javascript');
  }
  if (opts.pyproject) out.add('python');
  if (opts.cargoToml) out.add('rust');
  if (opts.goMod) out.add('go');
  if (opts.gemfile) out.add('ruby');
  return [...out];
}

function detectFrameworks(packageJson: Record<string, unknown> | null, stack: ReturnType<typeof detectStack>): string[] {
  const out = new Set<string>();
  if (stack?.name) out.add(stack.name.toLowerCase());
  if (packageJson) {
    const deps = { ...(packageJson.dependencies as Record<string, string> | undefined), ...(packageJson.devDependencies as Record<string, string> | undefined) };
    const known = ['react', 'vue', 'next', 'nuxt', 'svelte', 'fastify', 'express', 'koa', 'hono', 'nest', 'vite', 'tailwindcss', 'jest', 'vitest', 'playwright', 'electron', 'tauri'];
    for (const dep of known) {
      if (deps?.[dep]) out.add(dep);
    }
  }
  return [...out];
}

function classifyKind(opts: {
  stack: ReturnType<typeof detectStack>;
  frameworks: string[];
  packageJson: Record<string, unknown> | null;
  hasGoMod: boolean;
  hasCargo: boolean;
  hasPyProject: boolean;
}): ProjectKind {
  const fw = new Set(opts.frameworks);
  if (fw.has('next') || fw.has('nuxt') || fw.has('svelte')) return 'web-app';
  if (fw.has('fastify') || fw.has('express') || fw.has('koa') || fw.has('hono') || fw.has('nest')) return 'server-daemon';
  if (fw.has('electron') || fw.has('tauri')) return 'app';
  if (opts.stack?.stackType === 'frontend') return 'web-app';
  if (opts.stack?.stackType === 'api' || opts.stack?.stackType === 'worker') return 'server-daemon';
  if (opts.stack?.stackType === 'ssg' || opts.stack?.stackType === 'static') return 'site';
  if (opts.stack?.stackType === 'mobile') return 'mobile';
  if (opts.hasGoMod || opts.hasCargo) return 'cli';
  if (opts.packageJson) {
    if ((opts.packageJson as { bin?: unknown }).bin) return 'cli';
    return 'lib';
  }
  return 'unknown';
}

function inferDeliveryMedium(opts: { packageJson: Record<string, unknown> | null; kind: ProjectKind; root: string }): string {
  const parts: string[] = [];
  if (opts.packageJson) parts.push('npm');
  if (existsSync(join(opts.root, 'Cargo.toml'))) parts.push('cargo');
  if (existsSync(join(opts.root, 'go.mod'))) parts.push('go module');
  if (existsSync(join(opts.root, 'Formula'))) parts.push('homebrew tap');
  if (existsSync(join(opts.root, 'launchd')) || existsSync(join(opts.root, 'systemd'))) parts.push('service unit');
  if (existsSync(join(opts.root, 'Dockerfile'))) parts.push('docker image');
  if (parts.length === 0) parts.push(opts.kind === 'site' ? 'static deploy' : 'source-only');
  return parts.join(' + ');
}

function inferUiSurfaces(root: string, packageJson: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  if (existsSync(join(root, 'public/index.html'))) out.push('web dashboard');
  if (existsSync(join(root, 'fleet-config-ui'))) out.push('fleet UI');
  if (existsSync(join(root, 'website-v2'))) out.push('marketing site');
  if (existsSync(join(root, 'apps/FleetBar'))) out.push('macOS menu bar');
  if (packageJson?.bin) out.push('CLI');
  return out;
}

function detectSentry(root: string): boolean {
  return existsSync(join(root, 'sentry.config.ts'))
    || existsSync(join(root, 'sentry.config.js'))
    || existsSync(join(root, '.sentryclirc'));
}

function detectStrictTs(root: string): boolean {
  const tsconfig = readJsonSafe(join(root, 'tsconfig.json'));
  if (!tsconfig) return false;
  const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined;
  return Boolean(compilerOptions?.strict);
}

function countFleetAgents(fleetPath: string): number | null {
  try {
    const raw = readFileSync(fleetPath, 'utf-8');
    const lines = raw.split('\n');
    let inAgents = false;
    let agentsIndent = -1;
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      if (!inAgents) {
        if (/^\s*agents:\s*$/.test(line)) {
          inAgents = true;
          agentsIndent = indent;
        }
        continue;
      }
      if (indent <= agentsIndent) break;
      if (indent === agentsIndent + 2 && /^[a-z][a-zA-Z0-9_-]*:\s*$/.test(line.trimStart())) {
        count++;
      }
    }
    return count || null;
  } catch {
    return null;
  }
}

function readFleetBudget(fleetPath: string): number | null {
  try {
    const raw = readFileSync(fleetPath, 'utf-8');
    const match = raw.match(/budget_usd_per_day:\s*([\d.]+)/);
    return match ? Number.parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

function countCommitsLast30d(root: string, runGit: (args: readonly string[], cwd: string) => string): number {
  const out = runGit(['log', '--since=30 days ago', '--oneline'], root).trim();
  if (!out) return 0;
  return out.split('\n').length;
}

function collectHotFiles(root: string, runGit: (args: readonly string[], cwd: string) => string): string[] {
  const out = runGit(['log', '--since=30 days ago', '--pretty=format:', '--name-only'], root);
  const counts = new Map<string, number>();
  for (const line of out.split('\n')) {
    const path = line.trim();
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, HOT_FILE_LIMIT)
    .map(([path]) => path);
}

function bucketActivity(commitsLast30d: number): ProjectActivity {
  if (commitsLast30d >= 50) return 'hot';
  if (commitsLast30d >= 15) return 'warm';
  if (commitsLast30d >= 3) return 'cool';
  return 'cold';
}

function countTestSuites(root: string, depth: number): number {
  let count = 0;
  walkDirShallow(root, depth, (file) => {
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(file)) count++;
  });
  return count;
}

function walkDirShallow(dir: string, remainingDepth: number, onFile: (file: string) => void): void {
  if (remainingDepth < 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    let stats;
    try { stats = statSync(full); } catch { continue; }
    if (stats.isDirectory()) walkDirShallow(full, remainingDepth - 1, onFile);
    else onFile(entry);
  }
}

function assessDocFreshness(opts: { hasReadme: boolean; hasClaudeMd: boolean; root: string; runGit: (args: readonly string[], cwd: string) => string }): DocFreshness {
  if (!opts.hasReadme && !opts.hasClaudeMd) return 'absent';
  const lastReadme = lastTouched(opts.root, opts.runGit, ['README.md']);
  const lastCode = lastTouched(opts.root, opts.runGit, ['src', 'lib']);
  if (lastReadme === null || lastCode === null) return 'current';
  const daysBehind = (lastCode - lastReadme) / 86400;
  if (daysBehind < 14) return 'current';
  if (daysBehind < 60) return 'lagging';
  return 'stale';
}

function lastTouched(root: string, runGit: (args: readonly string[], cwd: string) => string, paths: readonly string[]): number | null {
  const out = runGit(['log', '-1', '--pretty=format:%ct', '--', ...paths], root).trim();
  const ts = Number.parseInt(out, 10);
  return Number.isFinite(ts) ? ts : null;
}

function extractHeuristicIntent(root: string, hasReadme: boolean, hasClaudeMd: boolean): string {
  if (hasReadme) {
    const head = readFileHead(join(root, 'README.md'), 4000);
    const h1 = head.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
  }
  if (hasClaudeMd) {
    const head = readFileHead(join(root, 'CLAUDE.md'), 2000);
    const h1 = head.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
  }
  return basename(root);
}

function extractHeuristicPurpose(root: string, hasReadme: boolean): string {
  if (!hasReadme) return '';
  const head = readFileHead(join(root, 'README.md'), 4000);
  const lines = head.split('\n');
  let sawH1 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawH1) {
      if (trimmed.startsWith('# ')) sawH1 = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
  }
  return '';
}

function collectHeuristicRisks(opts: { hasFleet: boolean; hasManifest: boolean; hasSentry: boolean; hasGithubActions: boolean; strictTs: boolean; activity: ProjectActivity; testSuites: number }): string[] {
  const risks: string[] = [];
  if (opts.hasFleet && !opts.hasGithubActions) risks.push('Fleet runs without CI gating — regressions only catch at agent runtime.');
  if (!opts.hasManifest && opts.hasFleet) risks.push('No features.manifest.json — fleet behavior may drift from documented contract.');
  if (opts.activity === 'hot' && opts.testSuites < 10) risks.push('Hot project with thin test coverage — high risk of stealth regressions.');
  if (!opts.strictTs && opts.activity !== 'cold') risks.push('TypeScript strict mode off — type errors can hide in fleet runtime.');
  if (!opts.hasSentry && opts.activity === 'hot') risks.push('No production error monitoring on a hot project.');
  return risks;
}

function collectHeuristicOpportunities(opts: { hasReadme: boolean; hasClaudeMd: boolean; hasManifest: boolean; hasGithubActions: boolean; strictTs: boolean; hasFleet: boolean; frameworks: string[]; languages: string[] }): string[] {
  const out: string[] = [];
  if (opts.hasClaudeMd && opts.hasReadme && !opts.hasManifest) out.push('Add a features.manifest.json so docs/code parity can be enforced.');
  if (!opts.hasGithubActions) out.push('Wire GitHub Actions for test gating and fleet-driven CI insights.');
  const isReactish = opts.frameworks.includes('react') || opts.frameworks.includes('next') || opts.frameworks.includes('nuxt') || opts.frameworks.includes('svelte');
  if (isReactish && !opts.frameworks.includes('playwright')) out.push('Add Playwright for hot-path browser canaries.');
  if (!opts.strictTs && opts.languages.includes('typescript')) out.push('Enable TypeScript strict mode and run a typesafety sweep.');
  return out;
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ─── LLM intent + purpose summarization ─────────────────────────────────────

interface LLMSurveyResult {
  intent: string;
  purpose: string;
  risks: string[];
  opportunities: string[];
}

const SUMMARY_PROMPT_TEMPLATE = `You are a project surveyor. Produce a strict JSON summary of the project below.

PROJECT: {project}
KIND: {kind}
FRAMEWORKS: {frameworks}

README (truncated):
{readme}

CLAUDE.md (truncated):
{claudeMd}

AGENTS.md (truncated):
{agentsMd}

Return JSON exactly matching this shape, with no prose, no code fences:
{
  "intent": "one-line statement of what the project does",
  "purpose": "one-line statement of why it exists",
  "risks": ["concrete risk 1", "concrete risk 2"],
  "opportunities": ["concrete opportunity 1", "concrete opportunity 2"]
}

Each field MUST be present. Risks and opportunities each return 2-4 strings. Intent and purpose under 200 chars each.`;

async function callIntentLLM(opts: {
  client: LLMClient;
  model: string;
  project: string;
  kind: ProjectKind;
  frameworks: string[];
  readmeHead: string;
  claudeMdHead: string;
  agentsMdHead: string;
}): Promise<LLMSurveyResult | null> {
  const prompt = SUMMARY_PROMPT_TEMPLATE
    .replace('{project}', opts.project)
    .replace('{kind}', opts.kind)
    .replace('{frameworks}', opts.frameworks.join(', ') || '(none detected)')
    .replace('{readme}', opts.readmeHead || '(absent)')
    .replace('{claudeMd}', opts.claudeMdHead || '(absent)')
    .replace('{agentsMd}', opts.agentsMdHead || '(absent)');

  const result = await opts.client.complete({ prompt, model: opts.model, maxTokens: 600 });
  if (!result.ok || !result.text) return null;

  const trimmed = result.text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
  const purpose = typeof parsed.purpose === 'string' ? parsed.purpose.trim() : '';
  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.filter((x): x is string => typeof x === 'string').slice(0, 6)
    : [];
  const opportunities = Array.isArray(parsed.opportunities)
    ? parsed.opportunities.filter((x): x is string => typeof x === 'string').slice(0, 6)
    : [];

  if (!intent || !purpose) return null;

  return { intent, purpose, risks, opportunities };
}
