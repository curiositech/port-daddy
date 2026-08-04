/**
 * Daemon-level e2e for symbol-level conflict prediction, end to end over HTTP.
 *
 * Boots the real ephemeral daemon (globalSetup), parses a real file through the daemon's
 * own tree-sitter index, and asserts the core agent-facing flow:
 *   - POST /symbols/parse populates the index (tree-sitter runs in the DAEMON process),
 *   - POST /sessions/:id/symbols records a modify-claim,
 *   - a second session's claim on the SAME symbol comes back as a predicted DIRECT conflict.
 *
 * Scope note: asserts the parse, the direct (same-symbol) conflict, AND the
 * dependency-graph surface — blast-radius over a same-file caller. The
 * blast-radius assertion was previously dropped because intra-file `calls` edges
 * weren't being extracted at all (parseFile produced imports/heritage only), so
 * the daemon returned an empty radius (issue #468). Now that `extractCallEdges`
 * populates `calls` edges, the radius is deterministic across the process
 * boundary (parse is awaited before the query), so it's safe to pin here. The
 * engine-level cases stay covered in tests/unit/symbol-index.test.ts +
 * blast-radius.test.ts.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, runCli } from '../helpers/integration-setup.js';

let dir;
let file;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-symconf-'));
  file = join(dir, 'server.ts');
  writeFileSync(
    file,
    [
      'export function createRoutes(app: any, db: any) {',
      '  return { app, db };',
      '}',
      '',
      'export function registerRoutes(app: any) {',
      '  return createRoutes(app, {});',
      '}',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function newSession(purpose, agentId) {
  const res = await request('/sessions', { method: 'POST', body: { purpose, agentId } });
  expect(res.ok).toBe(true);
  const id = res.data?.session?.id ?? res.data?.id ?? res.data?.sessionId;
  expect(typeof id).toBe('string');
  return id;
}

describe('symbol conflict prediction (daemon e2e)', () => {
  test('parses a real file through the daemon tree-sitter index', async () => {
    const res = await request('/symbols/parse', { method: 'POST', body: { files: [file] } });
    expect(res.ok).toBe(true);
    const got = await request(`/symbols/file/${encodeURIComponent(file)}`);
    const names = JSON.stringify(got.data);
    expect(names).toContain('createRoutes');
    expect(names).toContain('registerRoutes');
  }, 30000);

  test('two sessions claiming the same symbol → a predicted DIRECT conflict over HTTP', async () => {
    await request('/symbols/parse', { method: 'POST', body: { files: [file] } });

    const s1 = await newSession('refactor createRoutes', 'agent-1');
    const c1 = await request(`/sessions/${s1}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }], autoDeriveRadius: false },
    });
    expect(c1.ok).toBe(true);

    const s2 = await newSession('also touch createRoutes', 'agent-2');
    const c2 = await request(`/sessions/${s2}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }], autoDeriveRadius: false },
    });
    // ast-a2-1: Claim validator now rejects blocking conflicts (409 instead of advisory).
    // Two sessions both modifying the same symbol = direct blocking conflict.
    expect(c2.ok).toBe(false);
    expect(c2.status).toBe(409);
    expect(c2.data.code).toBe('BLOCKING_CONFLICT');
    expect(Array.isArray(c2.data.conflicts)).toBe(true);
    const direct = c2.data.conflicts.find((k) => k.type === 'direct');
    expect(direct).toBeDefined();
    expect(direct.otherSessionId).toBe(s1);
  }, 30000);

  test('claim guard: a REAL worktree edit landing on another session\'s DECLARED claim is reported by POST /suggestions/scan', async () => {
    // Function-claims revival slice 1 (lib/claim-guard.ts): agent A declares a
    // modify-claim on guardTarget via the claim route; agent B edits guardTarget's
    // lines in a REAL git worktree WITHOUT claiming. The scan derives B's footprint
    // from `git diff -U0`, parses the worktree copy through the daemon's own
    // tree-sitter index (real spans), and reports the edits-vs-declared-claims hit.
    const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const parent = mkdtempSync(join(tmpdir(), 'pd-claim-guard-'));
    const wt = join(parent, 'wt');
    const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const editorAgent = `guard-editor-${Date.now()}`;
    const holderAgent = `guard-holder-${Date.now()}`;
    let holderSession;
    let editorSession;

    // The daemon occasionally aborts a socket write under load (the integration
    // helper resolves those as status 0 / aborted) — retry, don't fail the test.
    const requestRetry = async (path, options) => {
      let res;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await request(path, options);
        if (res.status !== 0) return res;
        await new Promise((r) => setTimeout(r, 500));
      }
      return res;
    };

    try {
      // A real linked worktree of this repo, detached (no branch pollution) and
      // SPARSE-EMPTY: checking out all ~9k repo files both wastes seconds and
      // makes the shared ephemeral daemon abort in-flight sockets under the fs
      // churn. The guard only needs the fixture file to exist in the worktree.
      git(['worktree', 'add', '--no-checkout', '--detach', wt], repoRoot);
      git(['sparse-checkout', 'init', '--no-cone'], wt);
      git(['sparse-checkout', 'set', '--no-cone', '/pd-claim-guard-fixture.ts'], wt);
      git(['checkout', '--detach', 'HEAD'], wt);

      // Commit a TS fixture on the detached HEAD (local object only), then edit
      // guardTarget's BODY lines so `git diff -U0` shows hunks inside its span.
      const fixture = join(wt, 'pd-claim-guard-fixture.ts');
      writeFileSync(fixture, [
        'export function guardTarget(a: number, b: number): number {',
        '  const sum = a + b;',
        '  return sum;',
        '}',
        '',
        'export function bystander(): number {',
        '  return 7;',
        '}',
        '',
      ].join('\n'));
      git(['add', '-f', 'pd-claim-guard-fixture.ts'], wt);
      git(
        ['-c', 'user.email=pd-test@example.com', '-c', 'user.name=pd-test', '-c', 'core.hooksPath=/dev/null',
          'commit', '--no-verify', '-m', 'claim-guard fixture'],
        wt,
      );
      writeFileSync(fixture, [
        'export function guardTarget(a: number, b: number): number {',
        '  const sum = a + b + 1; // edited WITHOUT claiming',
        '  return sum * 2;',
        '}',
        '',
        'export function bystander(): number {',
        '  return 7;',
        '}',
        '',
      ].join('\n'));

      // Resolve the worktree id EXACTLY as the daemon does: sha256 of the root
      // path as printed by `git worktree list --porcelain` (lib/worktree.ts).
      const porcelain = git(['worktree', 'list', '--porcelain'], repoRoot);
      const rootLine = porcelain
        .split('\n')
        .find((l) => l.startsWith('worktree ') && l.includes('pd-claim-guard-'));
      expect(rootLine).toBeDefined();
      const wtRoot = rootLine.slice('worktree '.length);
      const worktreeId = createHash('sha256').update(wtRoot).digest('hex').slice(0, 8);
      const claimedFile = join(wtRoot, 'pd-claim-guard-fixture.ts');

      // Agent A DECLARES the claim (the claim-a-function verb, route #983).
      const holderRes = await requestRetry('/sessions', {
        method: 'POST',
        body: { purpose: 'hold guardTarget for refactor', agentId: holderAgent },
      });
      if (!holderRes.ok) console.log('HOLDER SESSION FAIL', holderRes.status, JSON.stringify(holderRes.data));
      expect(holderRes.ok).toBe(true);
      holderSession = holderRes.data?.session?.id ?? holderRes.data?.id ?? holderRes.data?.sessionId;
      const declared = await request(`/sessions/${holderSession}/symbols`, {
        method: 'POST',
        body: { claims: [{ filePath: claimedFile, symbolPath: 'guardTarget', type: 'modify' }], autoDeriveRadius: false },
      });
      expect(declared.ok).toBe(true);

      // Agent B sits in the worktree with its UNCLAIMED edit. POST /sessions
      // takes a worktree CONTEXT object (lib/worktree-policy.ts) — the id must
      // match what the daemon's listWorktrees() derives for this root.
      const editorRes = await request('/sessions', {
        method: 'POST',
        body: {
          purpose: 'edit guardTarget without claiming',
          agentId: editorAgent,
          worktree: { id: worktreeId, root: wtRoot, name: 'wt', branch: null, isMain: false },
        },
      });
      expect(editorRes.ok).toBe(true);
      editorSession = editorRes.data?.session?.id ?? editorRes.data?.id ?? editorRes.data?.sessionId;

      // The on-demand trigger.
      const scan = await request('/suggestions/scan', { method: 'POST' });
      expect(scan.ok).toBe(true);
      expect(scan.data.semantic).toBeTruthy();
      expect(scan.data.semantic.claimedSymbolHits).toBeGreaterThanOrEqual(1);

      // The hit was surfaced to the EDITOR, naming the claimed symbol + holder.
      const sugg = await request(`/suggestions?agentId=${encodeURIComponent(editorAgent)}`);
      expect(sugg.ok).toBe(true);
      const raw = JSON.stringify(sugg.data.suggestions);
      expect(raw).toContain('claim-guard');
      expect(raw).toContain('guardTarget');
      expect(raw).toContain(holderSession);
    } finally {
      // End sessions (releases the symbol claims), drop the worktree.
      if (editorSession) await request(`/sessions/${editorSession}`, { method: 'PUT', body: { status: 'completed' } });
      if (holderSession) await request(`/sessions/${holderSession}`, { method: 'PUT', body: { status: 'completed' } });
      try { git(['worktree', 'remove', '--force', wt], repoRoot); } catch { /* best-effort */ }
      rmSync(parent, { recursive: true, force: true });
    }
  }, 60000);

  test('pd session symbols add|list: claims land, and a rival blocking claim is REFUSED at the CLI', async () => {
    // The claim-a-function verb end to end: real CLI process → daemon route →
    // ast-a2-1 validator. Two independent functions (no cross-calls) so the only
    // conflict in play is the direct same-symbol one.
    const cliFile = join(dir, 'cli-fixture.ts');
    writeFileSync(cliFile, [
      'export function cliAlpha(x: number): number {',
      '  return x + 1;',
      '}',
      '',
      'export function cliBeta(y: number): number {',
      '  return y - 1;',
      '}',
      '',
    ].join('\n'));
    await request('/symbols/parse', { method: 'POST', body: { files: [cliFile] } });

    const holderAgent = `cli-holder-${Date.now()}`;
    const rivalAgent = `cli-rival-${Date.now()}`;
    const holder = await newSession('hold cliAlpha via CLI', holderAgent);
    const rival = await newSession('rival wants cliAlpha too', rivalAgent);

    const add = runCli([
      'session', 'symbols', 'add',
      '--file', cliFile, '--symbol', 'cliAlpha', '--type', 'modify', '--no-radius',
      '--session', holder, '--agent', holderAgent,
    ]);
    expect(add.success).toBe(true);
    expect(add.stdout + add.stderr).toContain('cliAlpha');

    const list = runCli(['session', 'symbols', 'list', '--session', holder, '--agent', holderAgent]);
    expect(list.success).toBe(true);
    expect(list.stdout).toContain('cliAlpha');
    expect(list.stdout).toContain('modify');

    // The witnessed refusal: the rival's modify-claim on the SAME symbol exits
    // non-zero and names the holder.
    const refused = runCli([
      'session', 'symbols', 'add',
      '--file', cliFile, '--symbol', 'cliAlpha', '--type', 'modify', '--no-radius',
      '--session', rival, '--agent', rivalAgent,
    ]);
    expect(refused.success).toBe(false);
    expect(refused.stderr).toContain('REFUSED');
    expect(refused.stderr).toContain(holder); // conflicting session named

    // cleanup: end both so later scans in the suite don't drag these claims
    await request(`/sessions/${holder}`, { method: 'PUT', body: { status: 'completed' } });
    await request(`/sessions/${rival}`, { method: 'PUT', body: { status: 'completed' } });
  }, 90000);

  test('blast-radius returns the same-file caller over HTTP (issue #468)', async () => {
    // registerRoutes calls createRoutes (see the fixture), so changing
    // createRoutes can break registerRoutes — its reverse-dependency closure.
    await request('/symbols/parse', { method: 'POST', body: { files: [file] } });

    const res = await request(
      `/symbols/blast-radius?file=${encodeURIComponent(file)}&symbol=createRoutes&depth=3`,
    );
    expect(res.ok).toBe(true);
    const radius = res.data?.radius ?? [];
    const callers = radius.map((n) => n.symbolPath);
    expect(callers).toContain('registerRoutes');
    // The radius is symbol-granular reverse-deps, not the target itself.
    expect(callers).not.toContain('createRoutes');
  }, 30000);
});
