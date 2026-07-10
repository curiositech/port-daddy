/**
 * Framework-free selftest for the eureka arc detector.
 *   node lib/session-intel/eureka-arc-detector.selftest.js
 * Asserts against synthetic fixtures (deterministic ground truth) AND runs the
 * detector over ≥1 REAL session transcript on this machine — proving it parses
 * the real JSONL block shapes, not just hand-built ones. Exits 1 on any failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as D from './eureka-arc-detector.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('✗ ' + msg); } }

// --- Fixture builders: emit lines in the real transcript shape --------------
function assistantToolUse(id, name, input) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}
function userToolResult(id, isError, text, extra = {}) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: text, ...extra }] } });
}

// === 1) Canonical fail → fail → success arc (same Bash command) =============
{
  const lines = [
    assistantToolUse('t1', 'Bash', { command: 'npm test', description: 'run tests' }),
    userToolResult('t1', true, '2 failing'),
    assistantToolUse('t2', 'Bash', { command: 'npm test', description: 'run tests' }),
    userToolResult('t2', true, '1 failing'),
    assistantToolUse('t3', 'Bash', { command: 'npm test', description: 'run tests' }),
    userToolResult('t3', false, '0 failing, all pass'),
  ];
  const arcs = D.detectArcsFromText(lines.join('\n'), { sessionId: 'fix-1', minFailures: 2 });
  ok(arcs.length === 1, 'canonical arc: exactly one arc detected');
  const a = arcs[0] || {};
  ok(a.failCount === 2, 'canonical arc: failCount === 2');
  ok(a.sessionId === 'fix-1', 'canonical arc: sessionId threaded through');
  ok(a.tool === 'Bash', 'canonical arc: tool is Bash');
  ok(a.whatChangedDelta && a.whatChangedDelta.type === 'identical-invocation', 'canonical arc: identical command → external-state delta');
  ok(typeof a.eurekaBlockIndex === 'number' && a.eurekaBlockIndex > a.firstFailBlockIndex, 'canonical arc: eureka index after first failure');
  ok(a.skillAdding === null, 'canonical arc: skillAdding left null (round-2)');
}

// === 2) Only ONE failure → no arc at default minFailures=2 ==================
{
  const lines = [
    assistantToolUse('a1', 'Bash', { command: 'make build' }),
    userToolResult('a1', true, 'error'),
    assistantToolUse('a2', 'Bash', { command: 'make build' }),
    userToolResult('a2', false, 'built ok'),
  ];
  ok(D.detectArcsFromText(lines.join('\n'), { minFailures: 2 }).length === 0, 'single failure: no arc at minFailures=2');
  ok(D.detectArcsFromText(lines.join('\n'), { minFailures: 1 }).length === 1, 'single failure: one arc at minFailures=1');
}

// === 3) Never-succeeds cluster → no arc =====================================
{
  const lines = [
    assistantToolUse('b1', 'Bash', { command: 'flaky-thing' }),
    userToolResult('b1', true, 'boom'),
    assistantToolUse('b2', 'Bash', { command: 'flaky-thing' }),
    userToolResult('b2', true, 'boom'),
    assistantToolUse('b3', 'Bash', { command: 'flaky-thing' }),
    userToolResult('b3', true, 'boom'),
  ];
  ok(D.detectArcsFromText(lines.join('\n')).length === 0, 'never-succeeds: no arc emitted');
}

// === 4) Structured non-zero exit code counts as failure even if is_error absent
{
  const lines = [
    assistantToolUse('c1', 'Bash', { command: 'pytest' }),
    userToolResult('c1', false, 'exit 1', { exit_code: 1 }),
    assistantToolUse('c2', 'Bash', { command: 'pytest' }),
    userToolResult('c2', false, 'exit 1', { exit_code: 1 }),
    assistantToolUse('c3', 'Bash', { command: 'pytest' }),
    userToolResult('c3', false, 'exit 0', { exit_code: 0 }),
  ];
  const arcs = D.detectArcsFromText(lines.join('\n'), { minFailures: 2 });
  ok(arcs.length === 1 && arcs[0].failCount === 2, 'exit-code: non-zero exit treated as failure, arc found');
}

// === 5) Similar-but-not-identical commands cluster; delta shows the change ===
{
  const lines = [
    assistantToolUse('d1', 'Bash', { command: 'node build.js --target ios' }),
    userToolResult('d1', true, 'fail'),
    assistantToolUse('d2', 'Bash', { command: 'node build.js --target ios' }),
    userToolResult('d2', true, 'fail'),
    assistantToolUse('d3', 'Bash', { command: 'node build.js --target ios --fix' }),
    userToolResult('d3', false, 'ok'),
  ];
  const arcs = D.detectArcsFromText(lines.join('\n'), { minFailures: 2, simThreshold: 0.6 });
  ok(arcs.length === 1, 'similar-cmd: clustered into one arc');
  ok(arcs[0].whatChangedDelta.type === 'invocation-changed', 'similar-cmd: delta flags invocation change');
  ok(arcs[0].whatChangedDelta.added.includes('--fix'), 'similar-cmd: delta names the added token');
}

// === 6) Distinct tools/commands do NOT cross-contaminate =====================
{
  const lines = [
    assistantToolUse('e1', 'Bash', { command: 'cmd-A' }),
    userToolResult('e1', true, 'fail'),
    assistantToolUse('e2', 'Bash', { command: 'cmd-B-totally-different' }),
    userToolResult('e2', true, 'fail'),
    assistantToolUse('e3', 'Bash', { command: 'cmd-A' }),
    userToolResult('e3', false, 'ok'),
  ];
  // cmd-A had only ONE failure before its success → no arc at minFailures=2.
  ok(D.detectArcsFromText(lines.join('\n'), { minFailures: 2 }).length === 0, 'distinct cmds: failures not merged across signatures');
}

// === 6b) Harness cancellations are dropped, not counted as failures =========
{
  const CANCEL = '<tool_use_error>Cancelled: parallel tool call Bash(x) errored</tool_use_error>';
  // Two genuine failures, one harness cancellation interleaved, then success.
  const lines = [
    assistantToolUse('f1', 'Bash', { command: 'cargo test' }),
    userToolResult('f1', true, 'test failed'),
    assistantToolUse('f2', 'Bash', { command: 'cargo test' }),
    userToolResult('f2', true, CANCEL),                 // interrupt — must be ignored
    assistantToolUse('f3', 'Bash', { command: 'cargo test' }),
    userToolResult('f3', true, 'test failed'),
    assistantToolUse('f4', 'Bash', { command: 'cargo test' }),
    userToolResult('f4', false, 'test result: ok'),
  ];
  const arcs = D.detectArcsFromText(lines.join('\n'), { minFailures: 2 });
  ok(arcs.length === 1, 'interrupt: one arc despite interleaved cancellation');
  ok(arcs[0].failCount === 2, 'interrupt: cancellation not counted toward failCount');
  ok(D.isHarnessInterrupt(CANCEL) === true, 'interrupt: sentinel recognized');
  ok(D.isHarnessInterrupt('real error output') === false, 'interrupt: plain error text is NOT an interrupt');
}

// A cluster whose ONLY failures are cancellations yields no arc.
{
  const CANCEL = '<tool_use_error>Cancelled: parallel tool call Bash(y) errored</tool_use_error>';
  const lines = [
    assistantToolUse('g1', 'Bash', { command: 'deploy' }),
    userToolResult('g1', true, CANCEL),
    assistantToolUse('g2', 'Bash', { command: 'deploy' }),
    userToolResult('g2', true, CANCEL),
    assistantToolUse('g3', 'Bash', { command: 'deploy' }),
    userToolResult('g3', false, 'deployed'),
  ];
  ok(D.detectArcsFromText(lines.join('\n'), { minFailures: 2 }).length === 0, 'interrupt: cancellation-only run is not an arc');
}

// === 7) Unit checks on the primitives =======================================
ok(D.normalizeBashCommand('npm test 2>&1 | head -40') === 'npm test', 'normalize: strips pager/redirection tail');
ok(D.normalizeBashCommand('git show abc123def4567') === 'git show <hex>', 'normalize: masks hex hash');
ok(D.jaccard(new Set(['a', 'b']), new Set(['a', 'b'])) === 1, 'jaccard: identical sets = 1');
ok(D.jaccard(new Set(['a']), new Set(['b'])) === 0, 'jaccard: disjoint sets = 0');
ok(D.flattenResultText([{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }]) === 'x\ny', 'flatten: array content joined');
ok(D.flattenResultText('plain') === 'plain', 'flatten: string content passthrough');
{
  let threw = false;
  try { D.annotateSkillAdding(); } catch { threw = true; }
  ok(threw, 'round-2 hook throws rather than faking a judgment');
}

// === 8) REAL sessions on disk: parse actual JSONL, detect over real data =====
{
  const projRoot = path.join(os.homedir(), '.claude', 'projects');
  // Prefer the machine's own port-daddy project dir (richest tool traffic).
  let realFiles = [];
  try {
    const dirs = fs.readdirSync(projRoot).filter((d) => d.includes('port-daddy'));
    // Rank dirs by their biggest file, then take the top few biggest transcripts.
    const candidates = [];
    for (const d of dirs) {
      const dp = path.join(projRoot, d);
      let files = [];
      try { files = fs.readdirSync(dp).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        const fp = path.join(dp, f);
        try { candidates.push({ fp, size: fs.statSync(fp).size }); } catch { /* skip */ }
      }
    }
    candidates.sort((a, b) => b.size - a.size);
    realFiles = candidates.slice(0, 12).map((c) => c.fp); // sample the 12 biggest
  } catch { /* no projects dir on this machine */ }

  if (!realFiles.length) {
    console.log('(skipping real-session test — no ~/.claude/projects transcripts on this machine)');
  } else {
    let totalBlocks = 0, totalFailInvs = 0, totalArcs = 0, threw = false;
    let arcShapeOk = true;
    for (const fp of realFiles) {
      const text = fs.readFileSync(fp, 'utf8');
      const blocks = D.parseTranscript(text);
      totalBlocks += blocks.length;
      const invs = D.buildInvocations(blocks);
      totalFailInvs += invs.filter((i) => i.failed).length;
      let arcs;
      try { arcs = D.detectArcs(blocks, { sessionId: path.basename(fp, '.jsonl'), minFailures: 2 }); }
      catch { threw = true; continue; }
      totalArcs += arcs.length;
      for (const a of arcs) {
        if (!(a.failCount >= 2 && typeof a.eurekaBlockIndex === 'number' && a.whatChangedDelta && a.excerpt)) arcShapeOk = false;
      }
    }
    ok(totalBlocks > 0, `real sessions: parsed blocks across ${realFiles.length} transcripts (${totalBlocks} blocks)`);
    ok(!threw, 'real sessions: detectArcs never throws on real data');
    ok(totalFailInvs > 0, `real sessions: real failed invocations present (${totalFailInvs})`);
    ok(arcShapeOk, 'real sessions: every detected arc has the required shape');
    console.log(`real sessions: ${realFiles.length} files, ${totalFailInvs} failed invocations, ${totalArcs} arc(s) at minFailures=2`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
