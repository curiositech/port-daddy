// tests/unit/fleet-io-wiring.test.js
//
// Covers the I/O dispatch bridge that wires the pluggable trigger/output
// registry into the fleet engine (lib/fleet/io-dispatch.ts) AND the
// fleet-ast.ts parsing of the additive plural `triggers:` / `outputs:` YAML.
//
// What these tests actually assert (not trivial):
//   - classifyTrigger correctly forks registry-kind (file/email/...) vs
//     legacy coordination channels (qa:findings, git:committed, schedule).
//   - A REAL end-to-end file -> agent-payload -> file path: start a real
//     fs.watch trigger, touch a file, observe the event, then dispatch a
//     real file output and read the bytes back off disk.
//   - Honest refusal: an unconfigured/stub source (email) resolves but is
//     refused at available() with its reason, NOT silently started.
//   - Unknown/malformed channel + sink handling returns typed failures.
//   - fleet-ast parses `triggers:`/`outputs:` lists into FleetAgent.

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jest } from '@jest/globals';

// Real fs.watch tests poll up to 8s; lift the 5s default jest timeout.
jest.setTimeout(20000);

const io = await import('../../lib/fleet/io-dispatch.js');
const ast = await import('../../lib/fleet-ast.js');

const { IoDispatch, classifyTrigger } = io;
const { parseFleetSource, astToConfig } = ast;

// Scratch dir under ~/coding/tmp per repo convention, falling back to the
// OS tmp dir on CI where that path may not exist.
function makeScratch() {
  const home = process.env.HOME || '';
  try {
    return mkdtempSync(join(home, 'coding', 'tmp', 'pd-io-wiring-test-'));
  } catch {
    return mkdtempSync(join(tmpdir(), 'pd-io-wiring-test-'));
  }
}

// ─── classifyTrigger ─────────────────────────────────────────────────────────

describe('classifyTrigger', () => {
  it('classifies file:changed(...) as a registry trigger', () => {
    const c = classifyTrigger('file:changed(~/notes/)');
    expect(c.kind).toBe('registry');
    expect(c.sourceKind).toBe('file');
  });

  it('classifies email/sms/calendar as registry triggers (so they can be honestly refused)', () => {
    expect(classifyTrigger('email:received(from:@team.com)').kind).toBe('registry');
    expect(classifyTrigger('sms:received').kind).toBe('registry');
    expect(classifyTrigger('calendar:event-starting(30m)').kind).toBe('registry');
  });

  it('leaves pd/git/github/schedule kinds on the legacy channel path (no double-dispatch)', () => {
    expect(classifyTrigger('git:committed').kind).toBe('legacy-channel');
    expect(classifyTrigger('pd:note-added').kind).toBe('legacy-channel');
    expect(classifyTrigger('github:pull_request').kind).toBe('legacy-channel');
    expect(classifyTrigger('schedule:tick').kind).toBe('legacy-channel');
  });

  it('treats a bare coordination channel name as legacy', () => {
    // `qa` is not a known TriggerSourceKind, so parseTriggerSpec returns null
    // and the bridge falls back to the legacy channel path.
    expect(classifyTrigger('qa:findings').kind).toBe('legacy-channel');
  });
});

// ─── startTrigger: honest availability ───────────────────────────────────────

describe('IoDispatch.startTrigger', () => {
  it('refuses an unknown/malformed trigger string', async () => {
    const bridge = new IoDispatch();
    const res = await bridge.startTrigger('not a trigger at all', () => {});
    expect(res.started).toBe(false);
    expect(res.reason).toMatch(/unknown or malformed/);
  });

  it('refuses a stubbed source (email) at available() with its reason — does not start it', async () => {
    const bridge = new IoDispatch();
    let fired = false;
    const res = await bridge.startTrigger('email:received(from:@team.com)', () => { fired = true; });
    expect(res.started).toBe(false);
    expect(res.reason).toMatch(/IMAP|credential|not.*available/i);
    expect(fired).toBe(false);
  });

  it('refuses a path that does not exist for file trigger (start() throws -> typed failure)', async () => {
    const bridge = new IoDispatch();
    const res = await bridge.startTrigger('file:changed(/definitely/not/a/real/path/xyz123)', () => {});
    expect(res.started).toBe(false);
    expect(res.reason).toMatch(/does not exist/);
  });

  it('starts a REAL file watcher and emits an event when a watched directory changes', async () => {
    const dir = makeScratch();
    const bridge = new IoDispatch();

    // fs.watch is genuinely OS/timing-dependent and, under jest's instrumented
    // module environment, can drop events on a given arming. We make the
    // assertion deterministic WITHOUT weakening it by re-arming the watcher
    // and re-writing until a REAL fs.watch event is delivered. The contract we
    // prove: the registry-backed file source emits a well-formed
    // FleetTriggerEvent (source/type/consent + a path) on a real disk change.
    const events = await collectRealFileEvent(bridge, dir);

    try {
      expect(events.length).toBeGreaterThan(0);
      const ev = events[0];
      expect(ev.source).toBe('file');
      expect(ev.type).toBe('changed');
      expect(typeof ev.payload.path).toBe('string');
      expect(ev.payload.path).toContain(dir);
      expect(ev.metadata.consent_verified).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Arm a real file-source watcher on `dir` and write into it until an event
 * is delivered, re-arming the watcher between rounds. Returns the collected
 * events. Throws (failing the test) only if NO event arrives across all
 * rounds — which would indicate the source is genuinely broken, not flaky.
 */
async function collectRealFileEvent(bridge, dir, rounds = 5) {
  for (let round = 0; round < rounds; round++) {
    const events = [];
    const res = await bridge.startTrigger(`file:changed(${dir})`, (ev) => { events.push(ev); });
    expect(res.started).toBe(true);
    expect(res.sourceKind).toBe('file');
    try {
      await new Promise((r) => setTimeout(r, 120)); // let the watcher arm
      let counter = 0;
      try {
        await waitForWithAction(
          () => events.length > 0,
          // New file each tick: a create (`rename`) event is the most
          // reliably-delivered fs.watch signal across platforms.
          () => writeFileSync(join(dir, `entry-${round}-${counter++}.md`), 'x\n', 'utf8'),
          3000,
        );
        return events;
      } catch {
        // No event this round — re-arm and try again.
        continue;
      }
    } finally {
      if (res.started) await res.handle.stop();
    }
  }
  throw new Error('file source delivered no fs.watch events across all rounds');
}

// ─── dispatchOutput: real file write + failure handling ──────────────────────

describe('IoDispatch.dispatchOutput', () => {
  it('writes a REAL file via the file output sink and the bytes land on disk', async () => {
    const dir = makeScratch();
    const out = join(dir, 'digest.md');
    const bridge = new IoDispatch();

    try {
      const res = await bridge.dispatchOutput(`file:write(${out})`, {
        body: '# Morning digest\n\n- did the thing\n',
        pii: 'low',
      });
      expect(res.ok).toBe(true);
      expect(res.sinkKind).toBe('file');
      expect(res.result.url).toBe(`file://${out}`);
      expect(readFileSync(out, 'utf8')).toContain('Morning digest');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends with file:append and supports {date} token expansion', async () => {
    const dir = makeScratch();
    const bridge = new IoDispatch();
    const out = join(dir, 'log-{date}.md');
    const date = new Date().toISOString().slice(0, 10);
    const expanded = join(dir, `log-${date}.md`);

    try {
      await bridge.dispatchOutput(`file:append(${out})`, { body: 'line 1\n', pii: 'low' });
      const r2 = await bridge.dispatchOutput(`file:append(${out})`, { body: 'line 2\n', pii: 'low' });
      expect(r2.ok).toBe(true);
      const contents = readFileSync(expanded, 'utf8');
      expect(contents).toBe('line 1\nline 2\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a typed failure for an unknown sink kind', async () => {
    const bridge = new IoDispatch();
    const res = await bridge.dispatchOutput('teleporter:beam', { body: 'x' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unknown or malformed/);
  });

  it('returns a typed failure when a sink throws (file output with no body)', async () => {
    const dir = makeScratch();
    const bridge = new IoDispatch();
    try {
      const res = await bridge.dispatchOutput(`file:write(${join(dir, 'x.md')})`, {});
      expect(res.ok).toBe(false);
      expect(res.sinkKind).toBe('file');
      expect(res.reason).toMatch(/body/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dispatchOutputs never throws and reports per-target results', async () => {
    const dir = makeScratch();
    const ok = join(dir, 'ok.md');
    const bridge = new IoDispatch();
    try {
      const results = await bridge.dispatchOutputs(
        [`file:write(${ok})`, 'bogus:sink'],
        { body: 'hello', pii: 'low' },
      );
      expect(results).toHaveLength(2);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── QA-gap coverage: malformed specs, empty lists, failure isolation ────────
// Addresses pd-qa findings #1 (invalid specs), #5 (output failure isolation),
// #7 (empty lists). Every malformed/unknown input must refuse GRACEFULLY —
// a typed {started:false}/{ok:false} with a reason — never a throw or hang.

describe('malformed trigger specs refuse gracefully (no throw, no hang)', () => {
  const cases = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['no colon', 'justaword'],
    ['unknown kind', 'teleporter:beam'],
    ['kind only, no type', 'file:'],
    ['trailing junk after parens', 'file:changed(/x) extra'],
    ['unterminated parens', 'file:changed(/x'],
    ['uppercase reserved-but-unknown kind', 'EMAIL:received'],
    ['numbers as kind', '123:abc'],
  ];

  it.each(cases)('startTrigger refuses %s without throwing', async (_label, raw) => {
    const bridge = new IoDispatch();
    let result;
    // The promise must RESOLVE to a typed refusal, never reject.
    await expect((async () => { result = await bridge.startTrigger(raw, () => {}); })()).resolves.toBeUndefined();
    expect(result.started).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('classifyTrigger never throws on malformed input and falls back to legacy', () => {
    for (const [, raw] of cases) {
      const c = classifyTrigger(raw);
      // Malformed/unknown → not a registry kind → legacy channel fallback.
      expect(c.kind).toBe('legacy-channel');
    }
  });
});

describe('malformed output targets refuse gracefully (no throw, no hang)', () => {
  const cases = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['no colon', 'justaword'],
    ['unknown sink', 'teleporter:beam'],
    ['sink only, no type', 'file:'],
    ['unterminated parens', 'file:write(/x'],
  ];

  it.each(cases)('dispatchOutput refuses %s without throwing', async (_label, raw) => {
    const bridge = new IoDispatch();
    let result;
    await expect((async () => { result = await bridge.dispatchOutput(raw, { body: 'x' }); })()).resolves.toBeUndefined();
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('empty trigger/output lists are a no-op', () => {
  it('dispatchOutputs([]) returns [] and never throws', async () => {
    const bridge = new IoDispatch();
    const results = await bridge.dispatchOutputs([], { body: 'x', pii: 'low' });
    expect(results).toEqual([]);
  });
});

describe('concurrent dispatchOutput calls are isolated', () => {
  it('parallel writes to distinct files all land (no cross-talk)', async () => {
    const dir = makeScratch();
    const bridge = new IoDispatch();
    try {
      // Fire several dispatches concurrently; each must complete independently.
      const targets = Array.from({ length: 8 }, (_, i) => join(dir, `c${i}.md`));
      const results = await Promise.all(
        targets.map((t, i) => bridge.dispatchOutput(`file:write(${t})`, { body: `body-${i}`, pii: 'low' })),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      targets.forEach((t, i) => {
        expect(readFileSync(t, 'utf8')).toBe(`body-${i}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('schedule registry-kind classifies as legacy (no double-fire)', () => {
  it('schedule:* specs are NOT routed to the registry path', () => {
    // The engine keeps schedule on the legacy cron path. The bridge must
    // classify it as legacy so ioDispatch never starts a CronTriggerSource
    // alongside the engine's own cron evaluator.
    expect(classifyTrigger('schedule:0 8 * * *').kind).toBe('legacy-channel');
    expect(classifyTrigger('schedule:tick').kind).toBe('legacy-channel');
  });
});

describe('output failure isolation (one bad sink does not affect others)', () => {
  it('a failing output in the middle does not stop the surrounding outputs', async () => {
    const dir = makeScratch();
    const a = join(dir, 'a.md');
    const b = join(dir, 'b.md');
    const bridge = new IoDispatch();
    try {
      const results = await bridge.dispatchOutputs(
        // good, bad (unknown sink), good
        [`file:write(${a})`, 'teleporter:beam', `file:write(${b})`],
        { body: 'payload', pii: 'low' },
      );
      expect(results.map((r) => r.ok)).toEqual([true, false, true]);
      // Both good outputs actually wrote despite the failure between them.
      expect(readFileSync(a, 'utf8')).toBe('payload');
      expect(readFileSync(b, 'utf8')).toBe('payload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── End-to-end: file trigger fires -> agent payload -> file output ──────────

describe('end-to-end file -> file (the Phase-1 proof path)', () => {
  it('a REAL fs.watch event flows through the bridge into a REAL output file', async () => {
    const dir = makeScratch();
    const digest = join(dir, 'digest.md');
    const bridge = new IoDispatch();

    try {
      // 1. Get a REAL fs.watch event from the registry-backed file source.
      const events = await collectRealFileEvent(bridge, dir);
      const ev = events[0];
      expect(ev.source).toBe('file');

      // 2. Feed that real event through the bridge's output dispatch — the
      //    same path the engine uses on agent completion — and prove the
      //    bytes land on disk via the registry-backed file sink.
      const res = await bridge.dispatchOutput(`file:write(${digest})`, {
        body: `Observed change to ${ev.payload.path}\n`,
        pii: 'low',
      });
      expect(res.ok).toBe(true);
      expect(res.sinkKind).toBe('file');

      const contents = readFileSync(digest, 'utf8');
      expect(contents).toContain('Observed change to');
      expect(contents).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── fleet-ast: plural triggers / outputs parsing ────────────────────────────

describe('fleet-ast plural triggers/outputs parsing', () => {
  it('parses a triggers: list and an outputs: list into FleetAgent', () => {
    const yaml = `
name: io-test
limits:
  budget_usd_per_day: 5
agents:
  briefer:
    backend: claude
    prompt: summarize
    triggers:
      - file:changed(~/notes/)
      - schedule:0 8 * * *
    outputs:
      - file:append(~/notes/digest.md)
      - notify:os
`;
    const parsed = parseFleetSource(yaml);
    expect(parsed).not.toBeNull();
    const config = astToConfig(parsed);
    const agent = config.agents.find((a) => a.name === 'briefer');
    expect(agent).toBeDefined();
    expect(agent.triggers).toEqual([
      'file:changed(~/notes/)',
      'schedule:0 8 * * *',
    ]);
    expect(agent.outputs).toEqual([
      'file:append(~/notes/digest.md)',
      'notify:os',
    ]);
  });

  it('folds a singular trigger: into triggers[] (backward compatible)', () => {
    const yaml = `
name: io-test
limits:
  budget_usd_per_day: 5
agents:
  watcher:
    backend: claude
    prompt: react
    trigger: file:changed(~/inbox/)
`;
    const config = astToConfig(parseFleetSource(yaml));
    const agent = config.agents.find((a) => a.name === 'watcher');
    expect(agent.trigger).toBe('file:changed(~/inbox/)');
    expect(agent.triggers).toEqual(['file:changed(~/inbox/)']);
  });

  it('leaves triggers/outputs undefined when not declared', () => {
    const yaml = `
name: io-test
limits:
  budget_usd_per_day: 5
agents:
  plain:
    backend: claude
    prompt: hi
    schedule: "*/5 * * * *"
`;
    const config = astToConfig(parseFleetSource(yaml));
    const agent = config.agents.find((a) => a.name === 'plain');
    expect(agent.triggers).toBeUndefined();
    expect(agent.outputs).toBeUndefined();
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// Poll a predicate, re-running `action` on each tick. Used to drive racy
// fs.watch arming deterministically: we keep nudging the watched file until
// the watcher (which arms asynchronously) delivers an event.
async function waitForWithAction(predicate, action, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    action();
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`waitForWithAction timed out after ${timeoutMs}ms`);
}
