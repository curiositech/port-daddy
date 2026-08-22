/**
 * pd seamanship — Skill registry, search, graft, and outcome reporting.
 *
 * pd seamanship list                     — List installed skills from all roots
 * pd seamanship search <query>           — Substring search over skill IDs and descriptions
 * pd seamanship show <skill-id>          — Print SKILL.md for a skill
 * pd seamanship sync                     — Sync from $WINDAGS_HOME to ~/.port-daddy/skills/
 * pd seamanship outcomes [--ship name]   — Show skill application outcomes table
 * pd seamanship index                    — Rebuild skill catalog (Phase 3: BM25+Tool2Vec)
 *
 * Phase 3 will add: graft, reference, import, score — backed by the full
 * BM25+Tool2Vec engine forked from ~/coding/workgroup-ai.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import {
  defaultSkillCatalogRoots,
  collectSkillUnion,
  syncAgentSkills,
  type SkillCatalogRoot,
  type SkillEntry,
} from '../../lib/skill-sync.js';
import { loadSkillCatalog, type SkillVisibility } from '../../lib/shipwright/skill-index.js';
import * as ui from '../utils/ui.js';

// ── provenance ──────────────────────────────────────────────────────────────
//
// Ownership/visibility live in frontmatter (owner, repos, visibility) that
// `loadSkillCatalog` already parses defensively (absence -> private, unknown
// values coerce down, never up). `collectSkillUnion` above is the lighter
// symlink-farm scanner list/show otherwise use, so we build a side lookup
// from the shared frontmatter parser and merge it in for display only —
// this is a rendering concern, not a publish decision. Any path that
// actually exports/publishes a skill must call `isPublishableSkill` instead.

export interface SkillProvenance {
  owner?: string;
  repos: string[];
  visibility: SkillVisibility;
}

function loadSkillProvenance(roots: SkillCatalogRoot[]): Map<string, SkillProvenance> {
  const byId = new Map<string, SkillProvenance>();
  for (const entry of loadSkillCatalog(roots.map((r) => r.path))) {
    byId.set(entry.id, { owner: entry.owner, repos: entry.repos, visibility: entry.visibility });
  }
  return byId;
}

export async function handleSeamanship(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0] ?? 'list';
  const rest = args.slice(1);

  switch (subcommand) {
    case 'list':    return cmdList(options);
    case 'search':  return cmdSearch(rest, options);
    case 'show':    return cmdShow(rest, options);
    case 'sync':    return cmdSync(options);
    case 'outcomes': return cmdOutcomes(rest, options);
    case 'index':   return cmdIndex(options);
    default:
      ui.error(`Unknown seamanship subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

// ── list ─────────────────────────────────────────────────────────────────────

async function cmdList(options: CLIOptions): Promise<void> {
  const roots = defaultSkillCatalogRoots(process.cwd(), homedir());
  const union = collectSkillUnion(roots);
  // collectSkillUnion returns { skills: SkillEntry[] } — iterate directly
  const entries: SkillEntry[] = union.skills;
  const provenance = loadSkillProvenance(roots);

  if (isJson(options)) {
    const withProvenance = entries.map((e) => ({
      ...e,
      ...(provenance.get(e.id) ?? { visibility: 'private' as const, repos: [] }),
    }));
    console.log(JSON.stringify({ skills: withProvenance, count: withProvenance.length }, null, 2));
    return;
  }

  if (!entries.length) {
    console.log('No skills found. Run: pd seamanship sync');
    return;
  }

  console.log(`\n  Skills (${entries.length} from ${roots.length} roots)\n`);
  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    const visibility = provenance.get(e.id)?.visibility ?? 'private';
    const marker = formatVisibilityMarker(visibility);
    console.log(`  ${e.id.padEnd(40)}  ${e.sourceLabel}${marker ? ui.dim(marker) : ''}`);
  }
  console.log();
}

/**
 * Compact list-row marker for a non-default visibility. `'private'` is the
 * unmarked, common-case default — it returns `''` so a clean listing (every
 * skill still on the default tier) stays clean, per the tenancy skill's
 * doctrine that absence of a grant should read as ordinary, not as a
 * missing label. Only `'listed'`/`'public'` earn a visible marker.
 */
export function formatVisibilityMarker(visibility: SkillVisibility): string {
  return visibility === 'private' ? '' : `  [${visibility}]`;
}

// ── search ────────────────────────────────────────────────────────────────────

async function cmdSearch(args: string[], options: CLIOptions): Promise<void> {
  const query = args.join(' ');
  if (!query) { ui.error('Usage: pd seamanship search <query>'); process.exit(1); }

  // Phase 3: local BM25+Tool2Vec engine. For now: substring match over
  // skill IDs and first 10 lines of SKILL.md.
  const roots = defaultSkillCatalogRoots(process.cwd(), homedir());
  const union = collectSkillUnion(roots);
  const lower = query.toLowerCase();

  const matches = union.skills.filter((e: SkillEntry) => {
    if (e.id.toLowerCase().includes(lower)) return true;
    const skillPath = e.skillFile;
    if (!existsSync(skillPath)) return false;
    try {
      const head = readFileSync(skillPath, 'utf8').split('\n').slice(0, 10).join(' ').toLowerCase();
      return head.includes(lower);
    } catch { return false; }
  });

  if (isJson(options)) {
    console.log(JSON.stringify({ query, results: matches, count: matches.length }, null, 2));
    return;
  }

  if (!matches.length) { console.log(`No skills matched "${query}".`); return; }
  console.log(`\n  Skills matching "${query}" (${matches.length})\n`);
  for (const e of matches) {
    console.log(`  ${e.id}`);
  }
  console.log('\n  Run: pd seamanship show <skill-id>  to read a skill');
  console.log();
}

// ── show ──────────────────────────────────────────────────────────────────────

async function cmdShow(args: string[], _options: CLIOptions): Promise<void> {
  const id = args[0];
  if (!id) { ui.error('Usage: pd seamanship show <skill-id>'); process.exit(1); }

  const roots = defaultSkillCatalogRoots(process.cwd(), homedir());
  const union = collectSkillUnion(roots);
  const entry = union.skills.find((e: SkillEntry) => e.id === id);

  if (!entry) { ui.error(`Skill not found: ${id}`); process.exit(1); }

  if (!existsSync(entry.skillFile)) { ui.error(`SKILL.md missing at ${entry.skillFile}`); process.exit(1); }

  const line = formatOwnershipLine(loadSkillProvenance(roots).get(id));
  if (line) console.log(ui.dim(line));
  console.log(readFileSync(entry.skillFile, 'utf8'));
}

/**
 * One line describing ownership/scope, or null when there's nothing beyond
 * the unmarked default (no declared owner, no repos, private) — the common
 * case for a skill whose frontmatter never opted into anything, which
 * should print exactly like it always did before provenance existed.
 */
export function formatOwnershipLine(provenance: SkillProvenance | undefined): string | null {
  const owner = provenance?.owner;
  const repos = provenance?.repos ?? [];
  const visibility = provenance?.visibility ?? 'private';
  if (!owner && repos.length === 0 && visibility === 'private') return null;

  const parts = [`owner: ${owner ?? '(unattributed)'}`, `visibility: ${visibility}`];
  if (repos.length) parts.push(`repos: ${repos.join(', ')}`);
  return `  ${parts.join('  ·  ')}`;
}

// ── sync ──────────────────────────────────────────────────────────────────────

async function cmdSync(_options: CLIOptions): Promise<void> {
  const home = homedir();
  const result = syncAgentSkills({
    baseDir: home,
    projectRoot: process.cwd(),
    scope: 'user',
    dryRun: false,
  });
  console.log(`Synced skills — ${result.created} created, ${result.replaced} replaced, ${result.alreadyLinked} already linked`);
  if (result.collisions.length) {
    console.log(`  Collisions resolved (higher-priority source wins):`);
    for (const c of result.collisions) {
      console.log(`    ${c.id}: kept ${c.keptSource} (over ${c.skippedSource})`);
    }
  }
  if (result.errors.length) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    ${e.target}: ${e.error}`);
    }
  }
}

// ── outcomes ─────────────────────────────────────────────────────────────────

async function cmdOutcomes(args: string[], options: CLIOptions): Promise<void> {
  const shipFlag = args.indexOf('--ship');
  const ship = shipFlag >= 0 ? args[shipFlag + 1] : undefined;
  const skillFlag = args.indexOf('--skill');
  const skill = skillFlag >= 0 ? args[skillFlag + 1] : undefined;

  const qs = new URLSearchParams();
  if (ship) qs.set('ship', ship);
  if (skill) qs.set('skill', skill);

  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/skills/outcomes?${qs}`);
  const data = await res.json();
  if (!res.ok) { ui.error((data.error as string) || 'Failed to fetch outcomes'); process.exit(1); }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }

  const outcomes = (data as { outcomes: Array<{
    ship_name: string; skill_id: string; outcome: string; applied_at: number; context?: string;
  }> }).outcomes;

  if (!outcomes.length) { console.log('No skill applications recorded yet.'); return; }

  console.log(`\n  Skill Application Outcomes (${outcomes.length})\n`);
  for (const o of outcomes) {
    const date = new Date(o.applied_at).toISOString().slice(0, 10);
    console.log(`  ${date}  ${o.ship_name.padEnd(20)}  ${o.skill_id.padEnd(30)}  ${o.outcome}`);
    if (o.context) console.log(`           ${o.context}`);
  }
  console.log();
}

// ── index ─────────────────────────────────────────────────────────────────────

async function cmdIndex(_options: CLIOptions): Promise<void> {
  // Phase 3: rebuild BM25+Tool2Vec index at ~/.port-daddy/skill-index.sqlite.
  // For now: re-run sync as a proxy for "refresh the catalog".
  console.log('Rebuilding skill catalog...');
  const result = syncAgentSkills({
    baseDir: homedir(),
    projectRoot: process.cwd(),
    scope: 'user',
    dryRun: false,
    statusOnly: true,
  });
  console.log(`Skill catalog: ${result.skillCount} skills from ${result.sources.length} roots.`);
  console.log('Full BM25+Tool2Vec index coming in Phase 3 (pd seamanship engine).');
}

function printUsage(): void {
  console.log(`
  pd seamanship <subcommand>

  list                     List installed skills
  search <query>           Search skills by name/description
  show <skill-id>          Print a skill's SKILL.md
  sync                     Sync skills from windags home
  outcomes [--ship name]   Show skill application outcomes
  index                    Rebuild the skill search catalog
`);
}
