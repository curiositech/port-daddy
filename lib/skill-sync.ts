import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { skillSyncGitPolicy } from './skill-sync-git.js';

export type SkillSyncScope = 'user' | 'project';

export interface SkillCatalogRoot {
  label: string;
  path: string;
}

export interface RuntimeSkillTarget {
  label: string;
  path: string;
}

export interface SkillEntry {
  id: string;
  path: string;
  skillFile: string;
  sourceLabel: string;
  sourceRoot: string;
  quality: number;
}

export interface SkillCollision {
  id: string;
  kept: string;
  skipped: string;
  keptSource: string;
  skippedSource: string;
}

export interface SkillUnion {
  roots: SkillCatalogRoot[];
  skills: SkillEntry[];
  collisions: SkillCollision[];
}

export interface SkillLinkAuditExample {
  skill: string;
  runtime: string;
  target: string;
  source: string;
  current?: string;
  error?: string;
}

export interface SkillLinkAudit {
  expectedLinks: number;
  currentLinks: number;
  missingLinks: number;
  staleSymlinks: number;
  blockedNonSymlinks: number;
  errors: Array<{ target: string; error: string }>;
  freshnessPct: number;
  examples: {
    missing: SkillLinkAuditExample[];
    staleSymlinks: SkillLinkAuditExample[];
    blockedNonSymlinks: SkillLinkAuditExample[];
    errors: SkillLinkAuditExample[];
  };
}

export interface SyncAgentSkillsOptions {
  baseDir: string;
  projectRoot: string;
  scope: SkillSyncScope;
  dryRun?: boolean;
  statusOnly?: boolean;
  sourceRoots?: SkillCatalogRoot[];
  targets?: RuntimeSkillTarget[];
}

export interface SyncAgentSkillsResult {
  scope: SkillSyncScope;
  baseDir: string;
  dryRun: boolean;
  statusOnly: boolean;
  sources: SkillCatalogRoot[];
  targets: RuntimeSkillTarget[];
  skillCount: number;
  collisions: SkillCollision[];
  created: number;
  replaced: number;
  alreadyLinked: number;
  skippedExisting: Array<{ target: string; reason: string }>;
  errors: Array<{ target: string; error: string }>;
  audit: SkillLinkAudit;
}

const MAX_DISCOVERY_DEPTH = 3;
const MAX_AUDIT_EXAMPLES = 10;

function expandHome(path: string, home = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

function existingRoot(label: string, path: string, home = homedir()): SkillCatalogRoot | null {
  const candidate = path.trim();
  if (!candidate) return null;
  const expanded = expandHome(candidate, home);
  try {
    if (!existsSync(expanded) || !statSync(expanded).isDirectory()) return null;
    return { label, path: expanded };
  } catch {
    return null;
  }
}

export function defaultSkillCatalogRoots(projectRoot: string, home = homedir()): SkillCatalogRoot[] {
  const roots: Array<SkillCatalogRoot | null> = [];
  const envRoots = process.env.PORT_DADDY_SKILL_SOURCE_ROOTS
    ?.split(':')
    .map((entry, index) => existingRoot(`env:${index + 1}`, entry, home)) ?? [];

  roots.push(...envRoots);
  roots.push(
    existingRoot('port-daddy', join(projectRoot, 'skills'), home),
    existingRoot('port-daddy-claude-mirror', join(projectRoot, '.claude', 'skills'), home),
    existingRoot('some-claude-skills', '~/coding/some_claude_skills/.claude/skills', home),
    existingRoot('user-claude', '~/.claude/skills', home),
    existingRoot('user-agents', '~/.agents/skills', home),
  );

  const seen = new Set<string>();
  return roots
    .filter((root): root is SkillCatalogRoot => !!root)
    .filter((root) => {
      const real = safeRealpath(root.path) ?? resolve(root.path);
      if (seen.has(real)) return false;
      seen.add(real);
      return true;
    });
}

export function runtimeSkillTargets(baseDir: string, scope: SkillSyncScope): RuntimeSkillTarget[] {
  const common: RuntimeSkillTarget[] = [
    { label: 'AGENTS universal', path: join(baseDir, '.agents', 'skills') },
    { label: 'agy', path: join(baseDir, '.agy', 'skills') },
    { label: 'Codex', path: join(baseDir, '.codex', 'skills') },
    { label: 'Claude', path: join(baseDir, '.claude', 'skills') },
    { label: 'Gemini skills', path: join(baseDir, '.gemini', 'skills') },
    { label: 'Gemini Port Daddy extension', path: join(baseDir, '.gemini', 'extensions', 'port-daddy', 'skills') },
    { label: 'Cursor', path: join(baseDir, '.cursor', 'skills') },
    { label: 'Continue', path: join(baseDir, '.continue', 'skills') },
    { label: 'Windsurf', path: join(baseDir, '.windsurf', 'skills') },
    { label: 'Roo', path: join(baseDir, '.roo', 'skills') },
    { label: 'OpenCode', path: join(baseDir, '.opencode', 'skills') },
    { label: 'Trae', path: join(baseDir, '.trae', 'skills') },
    { label: 'Qoder', path: join(baseDir, '.qoder', 'skills') },
    { label: 'CodeBuddy', path: join(baseDir, '.codebuddy', 'skills') },
    { label: 'Agent', path: join(baseDir, '.agent', 'skills') },
    { label: 'Kiro steering', path: join(baseDir, '.kiro', 'steering') },
  ];

  if (scope === 'user') {
    common.push(
      { label: 'Cline', path: join(baseDir, '.config', 'cline', 'skills') },
      { label: 'Codeium Windsurf legacy', path: join(baseDir, '.codeium', 'windsurf', 'skills') },
    );
  }

  return common;
}

export function collectSkillUnion(roots: SkillCatalogRoot[]): SkillUnion {
  const byId = new Map<string, SkillEntry>();
  const collisions: SkillCollision[] = [];

  for (const root of roots) {
    for (const entry of discoverSkills(root)) {
      const current = byId.get(entry.id);
      if (!current) {
        byId.set(entry.id, entry);
        continue;
      }

      if (shouldPreferSkillEntry(entry, current)) {
        byId.set(entry.id, entry);
        collisions.push({
          id: entry.id,
          kept: entry.path,
          skipped: current.path,
          keptSource: entry.sourceLabel,
          skippedSource: current.sourceLabel,
        });
      } else {
        collisions.push({
          id: entry.id,
          kept: current.path,
          skipped: entry.path,
          keptSource: current.sourceLabel,
          skippedSource: entry.sourceLabel,
        });
      }
    }
  }

  return {
    roots,
    skills: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    collisions,
  };
}

function shouldPreferSkillEntry(candidate: SkillEntry, current: SkillEntry): boolean {
  const candidateIsPortDaddyFirstParty = isPortDaddyFirstPartySource(candidate);
  const currentIsPortDaddyFirstParty = isPortDaddyFirstPartySource(current);

  if (
    candidate.id.startsWith('port-daddy') &&
    candidateIsPortDaddyFirstParty &&
    !currentIsPortDaddyFirstParty
  ) {
    return true;
  }

  return candidate.sourceRoot === current.sourceRoot && candidate.quality > current.quality;
}

function isPortDaddyFirstPartySource(entry: SkillEntry): boolean {
  if (entry.sourceLabel === 'port-daddy') return true;
  return basename(dirname(entry.sourceRoot)) === 'port-daddy';
}

export function syncAgentSkills(options: SyncAgentSkillsOptions): SyncAgentSkillsResult {
  const roots = options.sourceRoots ?? defaultSkillCatalogRoots(options.projectRoot);
  const union = collectSkillUnion(roots);
  const targets = options.targets ?? runtimeSkillTargets(options.baseDir, options.scope);
  const dryRun = !!options.dryRun || !!options.statusOnly;
  const policy = skillSyncGitPolicy(options.baseDir, targets.flatMap((target) => union.skills.map((skill) => join(target.path, skill.id))));
  const excluded = new Set([...policy.preserved.keys(), ...policy.errors.keys()]);
  const initialAudit = auditSkillLinks(union.skills, targets, excluded);
  const result: SyncAgentSkillsResult = {
    scope: options.scope,
    baseDir: options.baseDir,
    dryRun,
    statusOnly: !!options.statusOnly,
    sources: roots,
    targets,
    skillCount: union.skills.length,
    collisions: union.collisions,
    created: 0,
    replaced: 0,
    alreadyLinked: 0,
    skippedExisting: [...policy.preserved].map(([target, reason]) => ({ target, reason })),
    errors: [...policy.errors].map(([target, error]) => ({ target, error })),
    audit: initialAudit,
  };

  if (options.statusOnly) {
    return result;
  }

  for (const targetRoot of targets) {
    for (const skill of union.skills) {
      const target = join(targetRoot.path, skill.id);
      if (excluded.has(target)) continue;
      const outcome = ensureSymlink(target, skill.path, dryRun, policy.gitManaged, () => policy.checkParents(target));
      switch (outcome.kind) {
        case 'created':
          result.created++;
          break;
        case 'replaced':
          result.replaced++;
          break;
        case 'already':
          result.alreadyLinked++;
          break;
        case 'skipped':
          result.skippedExisting.push({ target, reason: outcome.reason });
          break;
        case 'error':
          result.errors.push({ target, error: outcome.error });
          break;
      }
    }
  }

  if (!dryRun) {
    result.audit = auditSkillLinks(union.skills, targets, excluded);
  }

  return result;
}

export function auditSkillLinks(skills: SkillEntry[], targets: RuntimeSkillTarget[], preserved: ReadonlySet<string> = new Set()): SkillLinkAudit {
  const audit: SkillLinkAudit = {
    expectedLinks: skills.length * targets.length,
    currentLinks: 0,
    missingLinks: 0,
    staleSymlinks: 0,
    blockedNonSymlinks: 0,
    errors: [],
    freshnessPct: 100,
    examples: {
      missing: [],
      staleSymlinks: [],
      blockedNonSymlinks: [],
      errors: [],
    },
  };

  for (const targetRoot of targets) {
    for (const skill of skills) {
      const target = join(targetRoot.path, skill.id);
      if (preserved.has(target)) { audit.expectedLinks--; continue; }
      const exampleBase = {
        skill: skill.id,
        runtime: targetRoot.label,
        target,
        source: skill.path,
      };

      try {
        const stat = lstatSafe(target);
        if (!stat) {
          audit.missingLinks++;
          pushAuditExample(audit.examples.missing, exampleBase);
          continue;
        }

        if (!stat.isSymbolicLink()) {
          audit.blockedNonSymlinks++;
          pushAuditExample(audit.examples.blockedNonSymlinks, exampleBase);
          continue;
        }

        const current = readlinkSync(target);
        if (sameLinkTarget(target, current, skill.path)) {
          audit.currentLinks++;
          continue;
        }

        audit.staleSymlinks++;
        pushAuditExample(audit.examples.staleSymlinks, { ...exampleBase, current });
      } catch (err) {
        const error = (err as Error).message;
        audit.errors.push({ target, error });
        pushAuditExample(audit.examples.errors, { ...exampleBase, error });
      }
    }
  }

  audit.freshnessPct = audit.expectedLinks === 0
    ? 100
    : Number(((audit.currentLinks / audit.expectedLinks) * 100).toFixed(2));
  return audit;
}

function pushAuditExample(target: SkillLinkAuditExample[], entry: SkillLinkAuditExample): void {
  if (target.length < MAX_AUDIT_EXAMPLES) target.push(entry);
}

function sameLinkTarget(linkPath: string, current: string, expected: string): boolean {
  if (current === expected) return true;
  const currentAbsolute = current.startsWith('/') ? current : resolve(dirname(linkPath), current);
  if (resolve(currentAbsolute) === resolve(expected)) return true;
  const currentReal = safeRealpath(currentAbsolute);
  const expectedReal = safeRealpath(expected);
  return !!currentReal && !!expectedReal && currentReal === expectedReal;
}

export function formatSkillSyncSummary(result: SyncAgentSkillsResult): string[] {
  const action = result.statusOnly ? 'Skill sync status' : result.dryRun ? 'Skill sync dry run' : 'Skill sync complete';
  const totalLinks = result.skillCount * result.targets.length;
  const lines = [
    `${action}: ${result.skillCount} skill(s), ${result.targets.length} runtime target(s), ${totalLinks} possible link(s)`,
    `  sources: ${result.sources.map((source) => source.label).join(', ') || 'none'}`,
    `  targets: ${result.targets.map((target) => target.label).join(', ') || 'none'}`,
    `  freshness: ${result.audit.currentLinks}/${result.audit.expectedLinks} current (${result.audit.freshnessPct}%), missing ${result.audit.missingLinks}, stale ${result.audit.staleSymlinks}, blocked ${result.audit.blockedNonSymlinks}, audit errors ${result.audit.errors.length}`,
  ];

  if (!result.statusOnly) {
    lines.push(
      `  linked: created ${result.created}, replaced ${result.replaced}, already ${result.alreadyLinked}`,
      `  preserved targets: ${result.skippedExisting.length}`,
      `  errors: ${result.errors.length}`,
    );
  }

  if (result.collisions.length > 0) {
    lines.push(`  duplicate skill ids resolved by source priority: ${result.collisions.length}`);
    for (const collision of result.collisions.slice(0, 5)) {
      lines.push(`    ${collision.id}: kept ${collision.keptSource}, skipped ${collision.skippedSource}`);
    }
    if (result.collisions.length > 5) {
      lines.push(`    ... ${result.collisions.length - 5} more`);
    }
  }

  if (result.skippedExisting.length > 0) {
    for (const skipped of result.skippedExisting.slice(0, 5)) {
      lines.push(`    skipped ${skipped.target}: ${skipped.reason}`);
    }
    if (result.skippedExisting.length > 5) {
      lines.push(`    ... ${result.skippedExisting.length - 5} more preserved targets`);
    }
  }

  if (result.errors.length > 0) {
    for (const error of result.errors.slice(0, 5)) {
      lines.push(`    error ${error.target}: ${error.error}`);
    }
    if (result.errors.length > 5) {
      lines.push(`    ... ${result.errors.length - 5} more errors`);
    }
  }

  return lines;
}

export function ensureGeminiPortDaddyExtension(baseDir: string, projectRoot: string, dryRun = false): {
  written: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
} {
  const extensionDir = join(baseDir, '.gemini', 'extensions', 'port-daddy');
  const sourceDir = join(projectRoot, '.gemini', 'extensions', 'port-daddy');
  const files = ['gemini-extension.json', 'GEMINI.md', 'mcp.json'];
  const written: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const file of files) {
    const source = join(sourceDir, file);
    const target = join(extensionDir, file);
    if (!existsSync(source)) {
      skipped.push(`${target} (missing repo source ${source})`);
      continue;
    }

    try {
      const next = readFileSync(source, 'utf8');
      if (existsSync(target) && readFileSync(target, 'utf8') === next) {
        skipped.push(`${target} (current)`);
        continue;
      }
      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, next);
      }
      written.push(target);
    } catch (err) {
      errors.push({ path: target, error: (err as Error).message });
    }
  }

  return { written, skipped, errors };
}

function discoverSkills(root: SkillCatalogRoot): SkillEntry[] {
  const entries: SkillEntry[] = [];
  walk(root.path, 0);
  return entries;

  function walk(dir: string, depth: number): void {
    const skillFile = join(dir, 'SKILL.md');
    if (existsSync(skillFile)) {
      const id = readSkillId(skillFile) ?? basename(dir);
      entries.push({
        id,
        path: dir,
        skillFile,
        sourceLabel: root.label,
        sourceRoot: root.path,
        quality: scoreSkillCandidate(id, dir),
      });
      return;
    }

    if (depth >= MAX_DISCOVERY_DEPTH) return;

    let children: string[] = [];
    try {
      children = readdirSync(dir).sort();
    } catch {
      return;
    }

    for (const child of children) {
      if (child.startsWith('.') || child === 'node_modules') continue;
      const childPath = join(dir, child);
      try {
        if (statSync(childPath).isDirectory()) walk(childPath, depth + 1);
      } catch {
        // Ignore broken links or permission edges in catalog roots.
      }
    }
  }
}

function readSkillId(skillFile: string): string | null {
  let text = '';
  try {
    text = readFileSync(skillFile, 'utf8').slice(0, 4096);
  } catch {
    return null;
  }

  const match = text.match(/^name:\s*["']?([a-z0-9][a-z0-9-]{0,63})["']?\s*$/m);
  return match?.[1] ?? null;
}

function scoreSkillCandidate(id: string, dir: string): number {
  const parent = basename(dir);
  const grandparent = basename(dirname(dir));
  let score = 0;
  if (parent === id) score += 4;
  if (grandparent === id) score += 2;
  if (parent === 'output') score -= 3;
  return score;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

type SymlinkOutcome =
  | { kind: 'created' }
  | { kind: 'replaced' }
  | { kind: 'already' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; error: string };

function ensureSymlink(target: string, source: string, dryRun: boolean, gitManaged = false, checkParents?: () => string | null): SymlinkOutcome {
  try {
    const refusal = checkParents?.();
    if (refusal) return { kind: 'error', error: refusal };
    const parent = dirname(target);
    if (!dryRun) mkdirSync(parent, { recursive: true });
    const changedParent = checkParents?.();
    if (changedParent) return { kind: 'error', error: changedParent };

    const stat = lstatSafe(target);
    if (!stat) {
      if (!dryRun) {
        try { symlinkSync(source, target, 'dir'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const appeared = lstatSafe(target);
          if (appeared?.isSymbolicLink() && sameLinkTarget(target, readlinkSync(target), source)) return { kind: 'already' };
          return { kind: 'skipped', reason: 'target appeared during projection; preserved without replacement' };
        }
      }
      return { kind: 'created' };
    }

    if (stat.isSymbolicLink()) {
      const current = readlinkSync(target);
      if (sameLinkTarget(target, current, source)) {
        return { kind: 'already' };
      }
      // Git worktrees use create-only projection. Never unlink a pre-existing
      // link after a policy snapshot: another hook or editor may now own it.
      if (gitManaged) return { kind: 'skipped', reason: 'existing Git-worktree link differs; preserved for explicit reconciliation' };
      if (!dryRun) {
        unlinkSync(target);
        symlinkSync(source, target, 'dir');
      }
      return { kind: 'replaced' };
    }

    return { kind: 'skipped', reason: 'target exists and is not a symlink' };
  } catch (err) {
    return { kind: 'error', error: (err as Error).message };
  }
}

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
