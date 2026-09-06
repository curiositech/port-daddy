/**
 * Mediator tests (grand-plan DAG node mediator-body, executor half;
 * src/mediator.ts). The gate, verbatim from docs/proposals/grand-plan-dag.md:
 *
 *   - fixture repo pair with a KNOWN SYMBOL COLLISION → prediction fires at
 *     the right confidence and NOT below the floor;
 *   - kill-flag test: mediator fully inert when flagged (zero I/O calls);
 *   - plus the supporting contracts: deterministic symbol extraction from
 *     unified diffs, the fixed scoring function (one shared symbol lands
 *     EXACTLY on the 0.7 floor), pair capping + recency prioritization +
 *     draft exclusion, tenant-consent parsing, crash-safe re-injection,
 *     and the convene event's mediator/1 wire shape.
 *
 * Idiom: the scan's I/O is injected (MediatorScanIo), so every gate is
 * asserted by COUNTING CALLS on stubs — no fetch mocking, no network.
 */

import { describe, it, expect } from 'vitest';
import {
  extractChangedSymbols,
  scoreConflict,
  selectCandidatePairs,
  isMediatorKilled,
  peekMediatorReinjection,
  acknowledgeMediatorReinjection,
  renderMediatorOrders,
  runMediatorScan,
  MEDIATOR_CONFIDENCE_FLOOR,
  MEDIATOR_MAX_PAIRS,
  KILL_MEDIATOR_KEY,
  type MediatorScanIo,
  type MediatorReinjection,
} from '../src/mediator.js';
import { parseFleetMediator } from '../src/fleet.js';
import type { OpenPRDetailed } from '../src/github.js';
import type { ChainedPublishResult } from '../src/squid-events.js';

// ── Fixtures: the "repo pair" as unified-diff patches ────────────────────────

/** PR A edits the BODY of computeTotals (hunk-header context names it). */
const PATCH_A_COMPUTE_TOTALS = [
  '@@ -10,7 +10,9 @@ export function computeTotals(items: Item[]) {',
  '   let total = 0;',
  '   for (const item of items) {',
  '-    total += item.price;',
  '+    total += item.price * item.quantity;',
  '+    if (item.taxable) total *= 1.08;',
  '   }',
  '   return total;',
].join('\n');

/** PR B ALSO touches computeTotals (added a new signature line) — the known collision. */
const PATCH_B_COMPUTE_TOTALS = [
  '@@ -8,6 +8,8 @@',
  ' import { Item } from "./types";',
  ' ',
  '-export function computeTotals(items: Item[]) {',
  '+export function computeTotals(items: Item[], currency = "USD") {',
  '+  assertCurrency(currency);',
].join('\n');

/** A patch in the same FILE but a different symbol (below-floor case). */
const PATCH_B_OTHER_SYMBOL = [
  '@@ -40,5 +40,8 @@ export function formatTotals(total: number) {',
  '-  return `$${total}`;',
  '+  return new Intl.NumberFormat().format(total);',
].join('\n');

/** A patch in an unrelated file (zero-confidence case). */
const PATCH_UNRELATED = [
  '@@ -1,4 +1,6 @@',
  '+def load_config(path):',
  '+    return json.load(open(path))',
].join('\n');

const filesA = [{ filename: 'src/billing.ts', patch: PATCH_A_COMPUTE_TOTALS }];
const filesBCollide = [{ filename: 'src/billing.ts', patch: PATCH_B_COMPUTE_TOTALS }];
const filesBSameFileOnly = [{ filename: 'src/billing.ts', patch: PATCH_B_OTHER_SYMBOL }];
const filesUnrelated = [{ filename: 'tools/config.py', patch: PATCH_UNRELATED }];

// ── Symbol extraction ────────────────────────────────────────────────────────

describe('extractChangedSymbols', () => {
  it('names the enclosing declaration from the hunk-header context', () => {
    const syms = extractChangedSymbols(filesA);
    expect(syms).toContainEqual({ file: 'src/billing.ts', symbol: 'computeTotals' });
  });

  it('names a declaration that appears on an added/removed line', () => {
    const syms = extractChangedSymbols(filesBCollide);
    expect(syms).toContainEqual({ file: 'src/billing.ts', symbol: 'computeTotals' });
  });

  it('recognizes python, go, and rust declaration shapes', () => {
    const files = [
      { filename: 'a.py', patch: '@@ -1,2 +1,3 @@\n+def handle_event(evt):\n+    pass' },
      { filename: 'b.go', patch: '@@ -1,2 +1,3 @@\n+func (s *Server) Handle(w http.ResponseWriter) {' },
      { filename: 'c.rs', patch: '@@ -1,2 +1,3 @@\n+pub fn verify_chain(head: &Head) -> bool {' },
    ];
    const syms = extractChangedSymbols(files);
    expect(syms).toContainEqual({ file: 'a.py', symbol: 'handle_event' });
    expect(syms).toContainEqual({ file: 'b.go', symbol: 'Handle' });
    expect(syms).toContainEqual({ file: 'c.rs', symbol: 'verify_chain' });
  });

  it('ignores context lines — being NEAR a change is not being changed', () => {
    const files = [
      {
        filename: 'x.ts',
        patch: '@@ -1,4 +1,5 @@\n function untouched() {\n   const a = 1;\n+  const b = 2;\n }',
      },
    ];
    // The context line `function untouched()` (leading space) must NOT count
    // as a changed symbol; only the hunk header could have named one, and
    // this header has no context text.
    expect(extractChangedSymbols(files)).toEqual([]);
  });

  it('contributes nothing for files without a patch (binary/huge)', () => {
    expect(extractChangedSymbols([{ filename: 'big.bin' }])).toEqual([]);
  });

  it('dedupes a symbol seen via header AND changed line', () => {
    const files = [
      {
        filename: 'x.ts',
        patch:
          '@@ -1,3 +1,3 @@ export function once() {\n-export function once() {\n+export function once(flag: boolean) {',
      },
    ];
    const syms = extractChangedSymbols(files);
    expect(syms.filter((s) => s.symbol === 'once')).toHaveLength(1);
  });
});

// ── Scoring: fires at the floor, and NOT below it ────────────────────────────

describe('scoreConflict', () => {
  it('a known single-symbol collision scores EXACTLY the 0.7 floor', () => {
    const score = scoreConflict(extractChangedSymbols(filesA), extractChangedSymbols(filesBCollide));
    expect(score.confidence).toBe(MEDIATOR_CONFIDENCE_FLOOR);
    expect(score.overlapping).toEqual([{ file: 'src/billing.ts', symbol: 'computeTotals' }]);
  });

  it('same file, different symbols scores 0.4 — signal, below the summons floor', () => {
    const score = scoreConflict(
      extractChangedSymbols(filesA),
      extractChangedSymbols(filesBSameFileOnly),
    );
    expect(score.confidence).toBe(0.4);
    expect(score.confidence).toBeLessThan(MEDIATOR_CONFIDENCE_FLOOR);
    expect(score.overlapping).toEqual([]);
    expect(score.sharedFiles).toEqual(['src/billing.ts']);
  });

  it('disjoint files score 0', () => {
    const score = scoreConflict(extractChangedSymbols(filesA), extractChangedSymbols(filesUnrelated));
    expect(score.confidence).toBe(0);
  });

  it('additional overlapping symbols raise confidence, capped at 0.95', () => {
    const a = [
      { file: 'f.ts', symbol: 's1' },
      { file: 'f.ts', symbol: 's2' },
      { file: 'f.ts', symbol: 's3' },
      { file: 'f.ts', symbol: 's4' },
    ];
    expect(scoreConflict(a.slice(0, 2), a.slice(0, 2)).confidence).toBeCloseTo(0.8);
    expect(scoreConflict(a, a).confidence).toBeCloseTo(0.95); // 0.7 + 0.3 clamped
  });
});

// ── Pair selection: recency, cap, drafts ─────────────────────────────────────

function pr(number: number, over: Partial<OpenPRDetailed> = {}): OpenPRDetailed {
  return {
    number,
    title: `PR ${number}`,
    author: `author${number}`,
    createdAt: 1000 + number,
    updatedAt: 100000 - number,
    headSha: `sha${number}`,
    draft: false,
    ...over,
  };
}

describe('selectCandidatePairs', () => {
  it('caps at MEDIATOR_MAX_PAIRS, preserving the recency order the API returned', () => {
    const prs = Array.from({ length: 80 }, (_, i) => pr(i + 1));
    const picked = selectCandidatePairs(999, prs);
    expect(picked).toHaveLength(MEDIATOR_MAX_PAIRS);
    expect(picked[0]!.number).toBe(1); // first-listed = most recently updated
  });

  it('excludes the delivered PR and drafts', () => {
    const prs = [pr(1), pr(2, { draft: true }), pr(3)];
    const picked = selectCandidatePairs(1, prs);
    expect(picked.map((p) => p.number)).toEqual([3]);
  });
});

// ── Kill flag ────────────────────────────────────────────────────────────────

function kvWith(store: Map<string, string>): KVNamespace {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

describe('isMediatorKilled', () => {
  it('reads the structured {killed:true} shape and the bare strings', async () => {
    const store = new Map<string, string>();
    const env = { CONTROL_KV: kvWith(store) };
    expect(await isMediatorKilled(env)).toBe(false);
    store.set(KILL_MEDIATOR_KEY, JSON.stringify({ killed: true, killedAt: 1 }));
    expect(await isMediatorKilled(env)).toBe(true);
    store.set(KILL_MEDIATOR_KEY, 'true');
    expect(await isMediatorKilled(env)).toBe(true);
    store.set(KILL_MEDIATOR_KEY, 'false');
    expect(await isMediatorKilled(env)).toBe(false);
  });

  it('fails INERT on an unreadable or unparseable flag (the convener asymmetry)', async () => {
    const store = new Map<string, string>([[KILL_MEDIATOR_KEY, 'garbage{{']]);
    expect(await isMediatorKilled({ CONTROL_KV: kvWith(store) })).toBe(true);
    const broken = {
      get: async () => {
        throw new Error('kv down');
      },
    } as unknown as KVNamespace;
    expect(await isMediatorKilled({ CONTROL_KV: broken })).toBe(true);
  });
});

// ── Tenant consent parsing ───────────────────────────────────────────────────

describe('parseFleetMediator', () => {
  const FP = 'ab'.repeat(32);

  it('parses the full opt-in block', () => {
    const yaml = [
      'fleet:',
      '  mediator:',
      '    enabled: true',
      '    harbor: Alice/Dock',
      '    action: merge',
      '    daemons:',
      `      Alice: ${FP.toUpperCase()}`,
      '      bob: not-a-fingerprint',
    ].join('\n');
    const cfg = parseFleetMediator(yaml);
    expect(cfg.enabled).toBe(true);
    expect(cfg.harbor).toBe('alice/dock');
    expect(cfg.action).toBe('merge');
    // Valid fingerprints normalize; invalid ones are DROPPED (that party
    // escalates to its human rather than summoning a ghost daemon).
    expect(cfg.daemons).toEqual({ alice: FP });
  });

  it('defaults to disabled: absent block, enabled:false, and bad yaml', () => {
    expect(parseFleetMediator('fleet:\n  squidEvents: true').enabled).toBe(false);
    expect(parseFleetMediator('fleet:\n  mediator:\n    enabled: false').enabled).toBe(false);
    expect(parseFleetMediator(':::not yaml').enabled).toBe(false);
    expect(parseFleetMediator('').enabled).toBe(false);
  });

  it('rejects a non-irreversible action (the gate is for irreversible actions only)', () => {
    const cfg = parseFleetMediator('fleet:\n  mediator:\n    enabled: true\n    harbor: a/b\n    action: comment');
    expect(cfg.action).toBeNull();
  });
});

// ── Crash-safe re-injection ─────────────────────────────────────────────────

describe('Mediator reinjection acknowledgement', () => {
  const payload: MediatorReinjection = {
    parleyId: 'p_1',
    repo: 'o/r',
    pr: 7,
    action: 'merge',
    modifyText: 'Rebase onto PR #5 first, then keep only the schema change.',
    decidedBy: 'alice',
    at: 1000,
  };

  it('peeks without deletion, then acknowledges the exact frozen order', async () => {
    const store = new Map<string, string>([[`mediator:reinjection:o/r:7`, JSON.stringify(payload)]]);
    const env = { CONTROL_KV: kvWith(store) };
    const first = await peekMediatorReinjection(env, 'o/r', 7);
    expect(first?.modifyText).toBe(payload.modifyText);
    expect(store.has('mediator:reinjection:o/r:7')).toBe(true);
    await expect(acknowledgeMediatorReinjection(env, first!)).resolves.toBe(true);
    expect(store.has('mediator:reinjection:o/r:7')).toBe(true);
    expect(await peekMediatorReinjection(env, 'o/r', 7)).toBeNull();
  });

  it('distinguishes absence from malformed authority', async () => {
    expect(await peekMediatorReinjection({ CONTROL_KV: undefined }, 'o/r', 7)).toBeNull();
    const store = new Map<string, string>([[`mediator:reinjection:o/r:7`, '{{{']]);
    await expect(peekMediatorReinjection({ CONTROL_KV: kvWith(store) }, 'o/r', 7))
      .rejects.toThrow(/cannot read pending Mediator order/);
  });

  it('renderMediatorOrders quotes the human verbatim inside a labeled frame', () => {
    const orders = renderMediatorOrders(payload);
    expect(orders).toContain('MEDIATOR ORDERS');
    expect(orders).toContain('> Rebase onto PR #5 first, then keep only the schema change.');
    expect(orders).toContain('alice');
    expect(orders).toContain('p_1');
  });
});

// ── The scan: gates + the fixture-pair prediction ────────────────────────────

interface CountingIo extends MediatorScanIo {
  calls: { listOpenPrs: number; fetchPatches: number; postNeutralCheck: number; publishConvene: number };
  checkSummaries: string[];
  conveneBodies: unknown[];
  conveneChannels: string[];
}

function makeIo(args: {
  openPrs: OpenPRDetailed[];
  patches: Record<number, Array<{ filename: string; patch?: string }>>;
  conveneResult?: ChainedPublishResult;
}): CountingIo {
  const io: CountingIo = {
    calls: { listOpenPrs: 0, fetchPatches: 0, postNeutralCheck: 0, publishConvene: 0 },
    checkSummaries: [],
    conveneBodies: [],
    conveneChannels: [],
    async listOpenPrs() {
      io.calls.listOpenPrs += 1;
      return args.openPrs;
    },
    async fetchPatches(prNumber) {
      io.calls.fetchPatches += 1;
      return args.patches[prNumber] ?? [];
    },
    async postNeutralCheck(_headSha, summary) {
      io.calls.postNeutralCheck += 1;
      io.checkSummaries.push(summary);
    },
    async publishConvene(channelSuffix, body) {
      io.calls.publishConvene += 1;
      io.conveneChannels.push(channelSuffix);
      io.conveneBodies.push(body);
      return (
        args.conveneResult ?? {
          ok: true,
          code: null,
          status: 201,
          seq: 1,
          hash: 'h'.repeat(64),
          channel: `x:fleet-cloud:${channelSuffix}`,
          body: { parleyId: 'p_test' },
        }
      );
    },
  };
  return io;
}

const IDENTITY_ENV = {
  RELAY_PUBLISH_URL: 'https://relay.example/v1/publish',
  FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: '11'.repeat(32),
  FLEET_EXECUTOR_HARBOR_CARD: 'h.p.s',
};

const CONFIG = {
  enabled: true,
  harbor: 'alice/dock',
  action: 'merge' as const,
  daemons: { author1: 'cd'.repeat(32) },
};

describe('runMediatorScan', () => {
  it('fixture pair with a known symbol collision → fires AT the floor, checks both heads, convenes once', async () => {
    const io = makeIo({
      openPrs: [pr(1, { author: 'author1', createdAt: 1001 }), pr(2, { author: 'author2', createdAt: 1002 })],
      patches: { 1: filesA, 2: filesBCollide },
    });
    const report = await runMediatorScan(
      { ...IDENTITY_ENV, CONTROL_KV: kvWith(new Map()) },
      { repo: 'octo/repo', deliveredPr: 1, config: CONFIG, io },
    );

    expect(report.ran).toBe(true);
    expect(report.pairsConsidered).toBe(1);
    const p = report.predictions[0]!;
    expect(p.fired).toBe(true);
    expect(p.confidence).toBe(MEDIATOR_CONFIDENCE_FLOOR);
    expect(p.overlapping).toEqual([{ file: 'src/billing.ts', symbol: 'computeTotals' }]);
    expect(p.convene?.ok).toBe(true);

    // Neutral check on BOTH heads.
    expect(io.calls.postNeutralCheck).toBe(2);
    expect(io.checkSummaries[0]).toContain('NEUTRAL');
    expect(io.checkSummaries[0]).toContain('src/billing.ts:computeTotals');

    // The convene event's mediator/1 wire shape.
    expect(io.calls.publishConvene).toBe(1);
    const body = io.conveneBodies[0] as Record<string, unknown>;
    expect(body.schema).toBe('mediator/1');
    expect(body.type).toBe('convene');
    expect(body.harbor).toBe('alice/dock');
    expect(body.repo).toBe('octo/repo');
    expect(body.confidence).toBe(MEDIATOR_CONFIDENCE_FLOOR);
    expect(body.action).toBe('merge');
    expect(body.daemons).toEqual(CONFIG.daemons);
    expect((body.prA as { number: number }).number).toBe(1);
    expect((body.prB as { number: number }).number).toBe(2);
    expect(io.conveneChannels[0]).toBe('mediator:octo-repo:1-2');
  });

  it('does NOT fire below the floor (same file, different symbols): no checks, no convene', async () => {
    const io = makeIo({
      openPrs: [pr(1), pr(2)],
      patches: { 1: filesA, 2: filesBSameFileOnly },
    });
    const report = await runMediatorScan(
      { ...IDENTITY_ENV, CONTROL_KV: kvWith(new Map()) },
      { repo: 'octo/repo', deliveredPr: 1, config: CONFIG, io },
    );
    expect(report.ran).toBe(true);
    const p = report.predictions[0]!;
    expect(p.fired).toBe(false);
    expect(p.confidence).toBe(0.4);
    expect(io.calls.postNeutralCheck).toBe(0);
    expect(io.calls.publishConvene).toBe(0);
  });

  it('KILL FLAG: fully inert — zero I/O calls of any kind', async () => {
    const store = new Map<string, string>([[KILL_MEDIATOR_KEY, JSON.stringify({ killed: true })]]);
    const io = makeIo({ openPrs: [pr(1), pr(2)], patches: { 1: filesA, 2: filesBCollide } });
    const report = await runMediatorScan(
      { ...IDENTITY_ENV, CONTROL_KV: kvWith(store) },
      { repo: 'octo/repo', deliveredPr: 1, config: CONFIG, io },
    );
    expect(report.ran).toBe(false);
    expect(report.reason).toBe('kill-mediator');
    expect(io.calls).toEqual({ listOpenPrs: 0, fetchPatches: 0, postNeutralCheck: 0, publishConvene: 0 });
  });

  it('tenant consent gate: disabled config never touches I/O', async () => {
    const io = makeIo({ openPrs: [], patches: {} });
    const report = await runMediatorScan(
      { ...IDENTITY_ENV, CONTROL_KV: kvWith(new Map()) },
      {
        repo: 'octo/repo',
        deliveredPr: 1,
        config: { enabled: false, harbor: null, action: null, daemons: {} },
        io,
      },
    );
    expect(report.reason).toBe('disabled');
    expect(io.calls.listOpenPrs).toBe(0);
  });

  it('no N2 identity ⇒ declines to run (a summons it cannot sign is not attempted)', async () => {
    const io = makeIo({ openPrs: [pr(1), pr(2)], patches: {} });
    const report = await runMediatorScan(
      { CONTROL_KV: kvWith(new Map()) },
      { repo: 'octo/repo', deliveredPr: 1, config: CONFIG, io },
    );
    expect(report.reason).toBe('no-identity');
    expect(io.calls.listOpenPrs).toBe(0);
  });

  it('delivered PR missing from the open list ⇒ honest decline (no invented claim order)', async () => {
    const io = makeIo({ openPrs: [pr(2)], patches: {} });
    const report = await runMediatorScan(
      { ...IDENTITY_ENV, CONTROL_KV: kvWith(new Map()) },
      { repo: 'octo/repo', deliveredPr: 1, config: CONFIG, io },
    );
    expect(report.reason).toBe('delivered-pr-not-found');
    expect(io.calls.publishConvene).toBe(0);
  });
});
