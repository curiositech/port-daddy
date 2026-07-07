/**
 * Harbor Editor **P3 slice 3** — agent-neutral MCP claim tools + the region preflight
 * (jest unit tests). The three adversarial-verify targets from the brief:
 *   1. the MCP tools contain NO Claude-specific branch (agent-neutral, HARD RULE 4);
 *   2. a gated refusal names ONLY the correct action, never a `--force`/`--no-verify`/
 *      `--allow-*` bypass (HARD RULE 5);
 *   3. the preflight refuses an out-of-claim edit against a LIVE actor (HARD RULE 6/7).
 * (The Rust commit-gate half proves 3 again over the in-console claim ledger in
 * `core/pd-console/src/editor_commit_gate.rs`.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GATED_ACTIONS,
  BYPASS_TOKENS,
  regionRefusalMessage,
  EDITOR_CLAIM_TOOL_NAMES,
  claimRegionRequest,
  releaseRegionRequest,
  firstGrantedOwner,
  preflight,
  type ClaimIntent,
  type WhoOwnsOwner,
} from '../../lib/editor-claims-mcp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = join(HERE, '../../lib/editor-claims-mcp.ts');
const SERVER_SRC = join(HERE, '../../mcp/server.ts');

/**
 * Slice the source text of one inline tool definition out of `mcp/server.ts` — from its
 * `name: '<tool>'` to the next tool's `name:` (or end of the TOOLS array). Lets a test
 * audit the region tools' schema for a backend discriminator without importing server.ts
 * (which boots a server) — the same read-as-string technique `mcp-parity.test.js` uses.
 */
function toolDefBlock(tool: string): string {
  const src = readFileSync(SERVER_SRC, 'utf8');
  const start = src.indexOf(`name: '${tool}'`);
  if (start < 0) return '';
  const nextName = src.indexOf('name: ', start + 1);
  return src.slice(start, nextName < 0 ? undefined : nextName);
}

// ── 1. Agent-neutral: no Claude-specific branch ──────────────────────────────

describe('the MCP claim tools carry no Claude-specific branch (HARD RULE 4)', () => {
  test('the module CODE names no backend literal at all — nothing to branch on', () => {
    // Strip comments first: the invariant is "no backend literal in a code path", not
    // "never mention Claude in prose". A string-literal branch like `x === 'claude'`
    // survives stripping and would still trip this; only doc-comment prose is removed.
    const code = readFileSync(MODULE_SRC, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // block/doc comments
      .replace(/\/\/[^\n]*/g, '') // line comments
      .toLowerCase();
    // An agent-neutral surface never needs a backend name in code: its absence proves no
    // path forks on one. Exact-match over source tokens I control (not NLP over prose).
    for (const backend of ['claude', 'anthropic', 'codex', 'gemini', 'aider', 'cloudflare']) {
      expect(code.includes(backend)).toBe(false);
    }
  });

  test('the inline server.ts region tool schemas expose no backend discriminator or claude enum', () => {
    for (const tool of ['claim_region', 'release_region']) {
      const block = toolDefBlock(tool);
      expect(block.length).toBeGreaterThan(0); // the tool IS defined inline (parity-visible)
      // Scan the inputSchema only — the human `description` legitimately says "every
      // backend" (that agent-neutrality IS the point); a discriminator would live in the
      // schema properties, so that is what must be backend-free.
      const schema = block.slice(block.indexOf('inputSchema:')).toLowerCase();
      expect(schema).not.toContain('backend:'); // no backend property key to fork on
      for (const backend of ['claude', 'anthropic', 'codex', 'gemini']) {
        expect(schema.includes(backend)).toBe(false);
      }
    }
  });

  test('request builders are identity-blind — a Claude, a Codex, and a human get byte-identical bodies', () => {
    const base = { path: 'core/pd-console/src/mux.rs', start_line: 12, end_line: 40, symbol: 'parse_header' };
    // Only the session_id (an opaque string) differs; the backend must never change the body.
    const asClaude = claimRegionRequest({ session_id: 'claude-agent-1', ...base });
    const asCodex = claimRegionRequest({ session_id: 'codex-agent-1', ...base });
    const asHuman = claimRegionRequest({ session_id: 'human-alice', ...base });
    // The bodies (region payloads) are identical across backends; only sessionId varies.
    expect(asCodex.body).toEqual(asClaude.body);
    expect(asHuman.body).toEqual(asClaude.body);
    expect(asClaude.sessionId).toBe('claude-agent-1');
    expect(asCodex.sessionId).toBe('codex-agent-1');
    // Release is likewise identity-blind.
    const relA = releaseRegionRequest({ session_id: 'claude-x', ...base });
    const relB = releaseRegionRequest({ session_id: 'codex-x', ...base });
    expect(relB.body).toEqual(relA.body);
  });

  test('the region preflight verdict does not depend on the contender’s backend', () => {
    const intent: ClaimIntent = { path: 'src/lib.rs', startLine: 20, endLine: 30, symbol: 'render' };
    const owners: WhoOwnsOwner[] = [
      { sessionId: 'owner-1', agentId: 'agent-owner', startLine: 10, endLine: 40, symbol: 'render', claimedAt: 100 },
    ];
    const claudeContender = preflight({ sessionId: 'claude-2' }, intent, owners);
    const codexContender = preflight({ sessionId: 'codex-2' }, intent, owners);
    const humanContender = preflight({ sessionId: 'human-2' }, intent, owners);
    // Same owner, same intent → same gated verdict regardless of who contends.
    expect(codexContender).toEqual(claudeContender);
    expect(humanContender).toEqual(claudeContender);
  });

  test('claim_region / release_region / coordination_preflight are the named surface', () => {
    expect(EDITOR_CLAIM_TOOL_NAMES).toEqual(['claim_region', 'release_region', 'coordination_preflight']);
    // Both region tools are exposed inline on the server surface (so mcp-parity maps them)…
    expect(toolDefBlock('claim_region')).toContain("name: 'claim_region'");
    expect(toolDefBlock('release_region')).toContain("name: 'release_region'");
    // …and claim_region carries NO force/bypass field (HARD RULE 5): contention is
    // resolved by handoff/parley, never by forcing over a live claim.
    expect(toolDefBlock('claim_region')).not.toContain('force');
  });
});

// ── 2. A gated refusal names only the correct action, never a bypass ─────────

describe('a gated refusal names only the correct action, never a bypass (HARD RULE 5)', () => {
  test('regionRefusalMessage offers every sanctioned action and no bypass token', () => {
    const msg = regionRefusalMessage('agent-owner', 'parse_header');
    const lower = msg.toLowerCase();
    for (const action of GATED_ACTIONS) {
      expect(msg).toContain(action); // every forward move is offered
    }
    for (const tok of BYPASS_TOKENS) {
      expect(lower).not.toContain(tok); // the load-bearing invariant: no bypass advertised
    }
    // It names the owner and the symbol so the contender knows whom to negotiate with.
    expect(msg).toContain('agent-owner');
    expect(msg).toContain('parse_header');
  });

  test('the gated preflight verdict carries the same bypass-free wording + only GATED_ACTIONS', () => {
    const intent: ClaimIntent = { path: 'src/lib.rs', startLine: 20, endLine: 30, symbol: 'render' };
    const owners: WhoOwnsOwner[] = [
      { sessionId: 'owner-1', agentId: 'peer-3a', startLine: 10, endLine: 40, symbol: 'render', claimedAt: 100 },
    ];
    const verdict = preflight({ sessionId: 'contender' }, intent, owners);
    expect(verdict.kind).toBe('gated');
    if (verdict.kind !== 'gated') throw new Error('expected a gated verdict');
    expect(verdict.actions).toEqual(GATED_ACTIONS);
    const lower = verdict.message.toLowerCase();
    for (const tok of BYPASS_TOKENS) {
      expect(lower).not.toContain(tok);
    }
    expect(verdict.owner).toBe('peer-3a'); // the opaque agent label, never a backend name
  });

  test('the TS refusal wording is the exact twin of the Rust guard_message shape', () => {
    // Both halves must read identically so a reviewer audits one sentence. This mirrors
    // core/pd-console/src/editor_wedge.rs::guard_message(owner, symbol).
    expect(regionRefusalMessage('X', 'Y')).toBe(
      "region ‘Y’ is held by X's live claim — request a handoff, open a parley, pick another region.",
    );
  });
});

// ── 3. The preflight refuses an out-of-claim edit against a LIVE actor ───────

describe('the region preflight refuses an out-of-claim edit against a live actor (HARD RULE 6/7)', () => {
  const parseHeader: WhoOwnsOwner = {
    sessionId: 'owner-A', agentId: 'agent-A', startLine: 12, endLine: 40, symbol: 'parse_header', claimedAt: 100,
  };

  test('editing INTO another live actor’s region is gated (refused)', () => {
    const intent: ClaimIntent = { path: 'src/a.rs', startLine: 20, endLine: 25, symbol: 'parse_header' };
    const verdict = preflight({ sessionId: 'contender-B' }, intent, [parseHeader]);
    expect(verdict.kind).toBe('gated');
    if (verdict.kind === 'gated') {
      expect(verdict.owner).toBe('agent-A');
      expect(verdict.region).toEqual([12, 40]);
    }
  });

  test('editing an ADJACENT unclaimed region of the same file is clear (region-scoped, not a file lock)', () => {
    const intent: ClaimIntent = { path: 'src/a.rs', startLine: 200, endLine: 260, symbol: 'write_footer' };
    expect(preflight({ sessionId: 'contender-B' }, intent, [parseHeader]).kind).toBe('clear');
  });

  test('a DEAD owner’s stale claim does not gate — only LIVE actors block', () => {
    const intent: ClaimIntent = { path: 'src/a.rs', startLine: 20, endLine: 25, symbol: 'parse_header' };
    const isLive = (o: WhoOwnsOwner) => o.sessionId !== 'owner-A'; // owner-A has died
    expect(preflight({ sessionId: 'contender-B' }, intent, [parseHeader], isLive).kind).toBe('clear');
  });

  test('the first-granted live claim wins contention (HARD RULE 6)', () => {
    const intent: ClaimIntent = { path: 'src/a.rs', startLine: 20, endLine: 25, symbol: 'x' };
    const later: WhoOwnsOwner = { sessionId: 'owner-B', agentId: 'agent-B', startLine: 18, endLine: 30, symbol: 'x', claimedAt: 200 };
    const winner = firstGrantedOwner(intent, [parseHeader, later]);
    expect(winner?.sessionId).toBe('owner-A'); // earlier claimedAt (100 < 200) wins
    // The contender is gated and told the earliest owner holds it.
    const verdict = preflight({ sessionId: 'contender-C' }, intent, [parseHeader, later]);
    expect(verdict.kind === 'gated' && verdict.owner).toBe('agent-A');
  });

  test('the first-granted owner editing its OWN region is clear even when a later claim overlaps', () => {
    const intent: ClaimIntent = { path: 'src/a.rs', startLine: 20, endLine: 25, symbol: 'parse_header' };
    const later: WhoOwnsOwner = { sessionId: 'owner-B', startLine: 18, endLine: 30, symbol: 'x', claimedAt: 200 };
    // owner-A holds the first-granted claim, so owner-A proceeds.
    expect(preflight({ sessionId: 'owner-A' }, intent, [parseHeader, later]).kind).toBe('clear');
  });
});
