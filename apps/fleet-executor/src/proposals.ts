/**
 * Ideation-ship proposal contract.
 *
 * The reviewer ships (code-reviewer, qa, red-team, …) speak the line-level
 * {@link Finding} schema in verdict.ts. The IDEATION ships — spark, spider,
 * lookout, snipe — do NOT review the diff for correctness; they propose
 * *forward* work: a buildable idea, a syllogism, a contradiction/trouble-ahead
 * alert, or a skill worth authoring. Their value is not a file:line objection;
 * it is a proposal the operator can ACT ON in one paste.
 *
 * This module is the machine-readable half of that: a validated {@link Proposal}
 * schema (parsed the same tri-state way as parseShipFindings — empty / valid /
 * malformed) and a deterministic renderer that turns each proposal into REAL,
 * runnable Port Daddy syntax. Every command emitted here maps to a command that
 * actually exists in `bin/port-daddy-cli.ts` (`pd roadmap upsert`, `pd dispatch
 * propose`) or to a GitHub prefilled-issue URL that needs no
 * backend at all. No aspirational `!pd` verbs, no Potemkin actions.
 */

import type { Severity } from './verdict.js';
import { htmlCommentSafeJson } from './machine-block.js';

// ---------------------------------------------------------------------------

/**
 * How the operator can act on a proposal. Each kind renders to a distinct,
 * real actionable surface:
 *   - roadmap : a GitHub prefilled "new issue" URL + `pd roadmap upsert …`
 *   - assign  : `pd dispatch propose "<prompt>"` — task an agent to build it
 *   - skill   : `pd dispatch propose "Use the skill-architect skill …"` — task
 *               an agent to author a reusable skill (Snipe's move)
 */
export type ProposalAction = 'roadmap' | 'assign' | 'skill';

const ACTION_KINDS: ReadonlySet<string> = new Set<ProposalAction>([
  'roadmap',
  'assign',
  'skill',
]);

export interface Proposal {
  /** Short imperative name — becomes the issue title / dispatch slug. */
  title: string;
  /**
   * Why this, why now. For spider this is the syllogism (A + B ⇒ C); for
   * lookout the contradiction/trouble-ahead; for spark the unlocked capability;
   * for snipe the recurring friction a skill would remove.
   */
  rationale: string;
  /** Files / paths / concepts from the diff that ground the proposal. */
  evidence: string[];
  /** Which actionable surface to render. */
  action: ProposalAction;
  /**
   * The ready-to-run agent goal for `assign` and `skill` proposals — the exact
   * text an operator (or a spawned agent) can execute. Optional for `roadmap`,
   * which carries its own shape.
   */
  prompt?: string;
  /** Trouble-ahead severity (lookout). Advisory only — never gates a merge. */
  severity?: Severity;
}

// First fenced ```json … ``` block. Non-greedy; tolerant of trailing whitespace
// before the closing fence — identical framing to verdict.parseShipFindings so
// ships speak ONE fence convention.
const PROPOSALS_BLOCK_RE = /```json\s*\n([\s\S]*?)\n?```/;

function coerceSeverity(value: unknown): Severity | undefined {
  if (value == null) return undefined;
  const s = String(value).toUpperCase();
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MED') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';
  return undefined;
}

function coerceEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Parse the structured proposal block from an ideation ship's output.
 *
 * Return contract (mirrors {@link parseShipFindings}):
 *   - No ```json block                     → `[]`   (nothing proposed)
 *   - A block that parses to an array of
 *     well-formed proposals                → `Proposal[]`
 *   - A block that is malformed JSON, not
 *     an array, or has a bad element shape  → `null` (PARSE FAILURE)
 *
 * Ideation ships are advisory, so the executor treats a `null` here as "post
 * the raw model output, no structured actions" — it NEVER gates a merge. But
 * the schema is still validated so a well-formed block always renders correctly.
 */
export function parseProposals(output: string): Proposal[] | null {
  if (!output) return [];
  const m = PROPOSALS_BLOCK_RE.exec(output);
  if (!m) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const proposals: Proposal[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.title !== 'string' || !o.title.trim()) return null;
    if (typeof o.rationale !== 'string' || !o.rationale.trim()) return null;
    if (typeof o.action !== 'string' || !ACTION_KINDS.has(o.action)) return null;
    if (o.prompt != null && typeof o.prompt !== 'string') return null;

    proposals.push({
      title: o.title.trim(),
      rationale: o.rationale.trim(),
      evidence: coerceEvidence(o.evidence),
      action: o.action as ProposalAction,
      prompt: typeof o.prompt === 'string' && o.prompt.trim() ? o.prompt.trim() : undefined,
      severity: coerceSeverity(o.severity),
    });
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// The output contract handed to ideation ships (both MAP and REDUCE).

/**
 * The machine-readable ideation contract. Ships emit a fenced `json` array of
 * {@link Proposal} objects. This REPLACES the findings contract for ideation
 * ships — they propose forward work, they do not raise file:line objections.
 */
export function ideationOutputContract(): string {
  return (
    '## Output Format\n\n' +
    'You are an IDEATION ship. Do not raise file:line review objections. Instead ' +
    'propose forward work as a JSON array inside triple-backtick fences:\n\n' +
    '```json\n' +
    '[\n' +
    '  {\n' +
    '    "title": "<short imperative name>",\n' +
    '    "rationale": "<why this, why now — grounded in the diff/repo>",\n' +
    '    "evidence": ["<file or concept from the diff>", "..."],\n' +
    '    "action": "roadmap | assign | skill",\n' +
    '    "prompt": "<for assign/skill: the exact agent goal to run; omit otherwise>",\n' +
    '    "severity": "HIGH | MEDIUM | LOW (optional; only for trouble-ahead alerts)"\n' +
    '  }\n' +
    ']\n' +
    '```\n\n' +
    'Emit 0–4 proposals. Ground every one in real evidence from the diff, repo, ' +
    'or fleet context. Choose `action` deliberately:\n' +
    '- `roadmap` — a durable idea worth tracking but not building right now.\n' +
    '- `assign` — a bounded build an agent could do now; put the runnable goal in `prompt`.\n' +
    '- `skill` — a reusable capability worth authoring as a skill; put the skill brief in `prompt`.\n\n' +
    'If you have nothing worth proposing, emit an empty array `[]`. Then end with ' +
    'EXACTLY one verdict line (ideation ships are advisory — almost always PASS):\n' +
    'FLEET-VERDICT: PASS'
  );
}

// ---------------------------------------------------------------------------
// Deterministic actionable rendering.

export interface ProposalRenderCtx {
  owner: string;
  repo: string;
  prNumber: number;
  shipName: string;
}

/** kebab-case slug from a proposal title (roadmap slug / dispatch tag). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'proposal';
}

/**
 * Collapse to one line AND escape for safe placement INSIDE double quotes in a
 * shell command. Every value interpolated into a rendered `pd …` command below
 * is model-provided (untrusted), so escaping only `"` is not enough: an
 * unescaped `$`, backtick, or backslash would trigger `$(...)` / `$VAR` /
 * backtick command substitution the moment an operator pastes the command.
 * Escape all four shell-in-double-quote metacharacters (`\ $ ` " `). Backslash
 * is escaped first via a single character-class pass so no double-escaping.
 */
function oneLine(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`$"])/g, '\\$1');
}

const SHIP_EMOJI: Record<string, string> = {
  spark: '✦',
  spider: '◈',
  lookout: '⚠',
  snipe: '✚',
};

function severityBadge(sev?: Severity): string {
  if (!sev) return '';
  return ` \`${sev}\``;
}

/**
 * Render ONE proposal's actionable block. Every command is real:
 *   roadmap → GitHub prefilled-issue URL (no backend) + `pd roadmap upsert`
 *   assign  → `pd dispatch propose "<goal>"` then `pd dispatch run <id>`
 *   skill   → `pd dispatch propose "Use the skill-architect skill: <brief>"`
 */
function renderAction(p: Proposal, ctx: ProposalRenderCtx): string {
  const slug = slugify(p.title);
  const tags = `from-fleet,pd-${ctx.shipName}`;
  const lines: string[] = ['', '**Take action:**'];

  switch (p.action) {
    case 'roadmap': {
      const issueTitle = encodeURIComponent(`feat: ${p.title}`);
      const issueBody = encodeURIComponent(
        `**Source:** pd-${ctx.shipName} on PR #${ctx.prNumber}\n\n${p.rationale}\n\n` +
          (p.evidence.length ? `Evidence: ${p.evidence.join(', ')}\n\n` : '') +
          `*Auto-surfaced by Port Daddy Fleet.*`,
      );
      const url =
        `https://github.com/${ctx.owner}/${ctx.repo}/issues/new` +
        `?title=${issueTitle}&body=${issueBody}&labels=roadmap,from-fleet`;
      lines.push(`- [📌 Open as roadmap issue](${url})`);
      // `next` is NOT a valid pd roadmap status — the CLI accepts only
      // now|backlog|parked|merge|done. A roadmap-action proposal is a
      // durable-but-not-now idea, so it belongs in `backlog`.
      lines.push(
        '- Or track it locally: ' +
          `\`pd roadmap upsert ${slug} --summary "${oneLine(p.title)}" --status backlog\``,
      );
      break;
    }
    case 'assign': {
      const goal = oneLine(p.prompt || p.rationale);
      lines.push(`- Task an agent to build it: \`pd dispatch propose "${goal}" --tags ${tags}\``);
      lines.push('  then `pd dispatch run <id>` (or `pd dispatch queue` to review first).');
      if (p.prompt) {
        lines.push('');
        lines.push('<details><summary>Ready-to-paste agent prompt</summary>');
        lines.push('');
        lines.push('```text');
        lines.push(p.prompt.trim());
        lines.push('```');
        lines.push('</details>');
      }
      break;
    }
    case 'skill': {
      // "build a skill. Goal: <brief>" reads naturally whether the brief is
      // verb-led ("make …") or noun-led — avoids "a skill that make …".
      const brief = oneLine(p.prompt || p.rationale);
      lines.push(
        '- Author a skill for it: ' +
          `\`pd dispatch propose "Use the skill-architect skill to build a skill. Goal: ${brief}" ` +
          `--tags skill,${tags}\``,
      );
      if (p.prompt) {
        lines.push('');
        lines.push('<details><summary>Skill-architect brief</summary>');
        lines.push('');
        lines.push('```text');
        lines.push(p.prompt.trim());
        lines.push('```');
        lines.push('</details>');
      }
      break;
    }
  }
  return lines.join('\n');
}

/**
 * Render an ideation ship's whole comment body from its validated proposals.
 * Deterministic: given the same proposals + ctx, byte-identical output (so the
 * edit-in-place comment path stays idempotent on retry).
 *
 * Returns an empty string when there are no proposals — the caller then posts
 * nothing (silence), matching the reviewer ships' "no findings → no noise".
 */
export function renderProposalComment(proposals: Proposal[], ctx: ProposalRenderCtx): string {
  if (proposals.length === 0) return '';

  const emoji = SHIP_EMOJI[ctx.shipName] ?? '◆';
  const blocks = proposals.map(p => {
    const head = `### ${emoji} ${p.title}${severityBadge(p.severity)}`;
    const parts = [head, '', p.rationale];
    if (p.evidence.length) {
      parts.push('', `Evidence: ${p.evidence.map(e => `\`${e}\``).join(', ')}`);
    }
    parts.push(renderAction(p, ctx));
    return parts.join('\n');
  });

  // A hidden machine block so a future roadmap-add handler can bulk-create the
  // roadmap-kind proposals without re-parsing the prose. Forward-compatible with
  // the receiver's `pd-ideas-json` convention.
  const machine =
    `\n\n<!-- pd-proposals-json\n${htmlCommentSafeJson(
      proposals.map((p, i) => ({ n: i + 1, ...p })),
    )}\n-->`;

  const footer =
    '\n\n---\n' +
    `*Advisory proposals from pd-${ctx.shipName} — non-blocking. ` +
    'Actions above are real Port Daddy commands.*';

  return blocks.join('\n\n') + footer + machine;
}
