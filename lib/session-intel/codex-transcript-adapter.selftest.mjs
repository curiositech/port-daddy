/**
 * Framework-free selftest for the Codex rollout adapter.
 *   node lib/session-intel/codex-transcript-adapter.selftest.mjs
 *
 * Proves the adapter produces the same block/arc shape eureka-arc-detector.mjs
 * already validates for Claude transcripts, from Codex's real rollout schema,
 * WITHOUT adding new detection logic (detectArcs is reused verbatim). Also
 * runs over >=1 REAL Codex rollout on this machine when one is present, same
 * "prove it parses the real shape, not just hand-built fixtures" discipline
 * eureka-arc-detector.selftest.mjs uses for Claude. Exits 1 on any failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexBlocksFromLine, parseCodexTranscript, codexSessionIdFromText, detectCodexArcsFromText } from './codex-transcript-adapter.mjs';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('✗ ' + msg); } }

function sessionMeta(sessionId) {
  return JSON.stringify({ type: 'session_meta', payload: { session_id: sessionId } });
}
function functionCall(callId, name, argsObj) {
  return JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name, arguments: JSON.stringify(argsObj), call_id: callId } });
}
function functionCallOutput(callId, exitCode) {
  return JSON.stringify({
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: callId, output: `Process exited with code ${exitCode}\nsome output` },
  });
}

// === 1) Canonical fail -> fail -> success arc, real Codex schema ===========
{
  const lines = [
    sessionMeta('codex-sess-1'),
    functionCall('c1', 'exec_command', { cmd: 'npm test' }),
    functionCallOutput('c1', 1),
    functionCall('c2', 'exec_command', { cmd: 'npm test' }),
    functionCallOutput('c2', 1),
    functionCall('c3', 'exec_command', { cmd: 'npm test' }),
    functionCallOutput('c3', 0),
  ];
  const arcs = detectCodexArcsFromText(lines.join('\n'), { minFailures: 2 });
  ok(arcs.length === 1, 'canonical Codex arc: exactly one arc detected');
  const a = arcs[0] || {};
  ok(a.failCount === 2, 'canonical Codex arc: failCount === 2');
  ok(a.sessionId === 'codex-sess-1', 'canonical Codex arc: sessionId read from session_meta');
  ok(a.tool === 'Bash', "canonical Codex arc: exec_command mapped to shared 'Bash' tool name");
}

// === 2) Cross-runtime clustering: same tool label as Claude's Bash =========
{
  const codexBlocks = parseCodexTranscript([
    sessionMeta('x'),
    functionCall('c1', 'exec_command', { cmd: 'go test ./...' }),
    functionCallOutput('c1', 0),
  ].join('\n'));
  const useBlocks = codexBlocks.filter((b) => b.kind === 'tool_use');
  ok(useBlocks.length === 1 && useBlocks[0].tool === 'Bash', 'cross-runtime: Codex block tool name matches Claude convention exactly');
}

// === 3) Exit code 0 is success, non-zero is failure =========================
{
  const successBlocks = codexBlocksFromLine(functionCallOutput('c9', 0));
  const failBlocks = codexBlocksFromLine(functionCallOutput('c9', 127));
  ok(successBlocks[0].isError === false, 'exit code 0 -> isError false');
  ok(successBlocks[0].exitCode === 0, 'exit code 0 -> exitCode is the number 0, not null');
  ok(failBlocks[0].isError === true, 'exit code 127 -> isError true');
  ok(failBlocks[0].exitCode === 127, 'exit code 127 -> exitCode captured');
}

// === 4) Only ONE failure -> no arc at default minFailures=2 =================
{
  const lines = [
    sessionMeta('y'),
    functionCall('c1', 'exec_command', { cmd: 'make build' }),
    functionCallOutput('c1', 1),
    functionCall('c2', 'exec_command', { cmd: 'make build' }),
    functionCallOutput('c2', 0),
  ];
  ok(detectCodexArcsFromText(lines.join('\n'), { minFailures: 2 }).length === 0, 'single Codex failure: no arc at minFailures=2');
  ok(detectCodexArcsFromText(lines.join('\n'), { minFailures: 1 }).length === 1, 'single Codex failure: one arc at minFailures=1');
}

// === 5) Malformed / irrelevant lines are skipped, not thrown ===============
{
  ok(codexBlocksFromLine('not json at all').length === 0, 'malformed line: skipped cleanly, no throw');
  ok(codexBlocksFromLine(JSON.stringify({ type: 'turn_context' })).length === 0, 'non-response_item line: skipped cleanly');
  ok(codexBlocksFromLine(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning' } })).length === 0, 'reasoning payload: no blocks (not tool_use/tool_result)');
}

// === 6) sessionIdFromText falls back cleanly when no session_meta line =====
{
  ok(codexSessionIdFromText('no meta here', 'fallback-id') === 'fallback-id', 'missing session_meta: falls back to provided fallback');
}

// === 7) REAL slice: at least one actual Codex rollout on this machine ======
{
  const root = path.join(os.homedir(), '.codex', 'sessions');
  let files = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(root, 0);
  if (files.length === 0) {
    console.log('ℹ real-slice: no ~/.codex/sessions found on this machine — skipping (synthetic coverage stands).');
  } else {
    // Sample a handful, biggest-under-a-size-cap first (most tool traffic
    // without risking Node's ~512MB string-length limit -- a real 802MB
    // rollout on this machine hit exactly that limit before this cap existed).
    const MAX_SCAN_BYTES = 5_000_000;
    files = files
      .map((f) => ({ f, size: (() => { try { return fs.statSync(f).size; } catch { return 0; } })() }))
      .filter((x) => x.size > 0 && x.size <= MAX_SCAN_BYTES)
      .sort((a, b) => b.size - a.size)
      .slice(0, 20)
      .map((x) => x.f);
    let totalBlocks = 0;
    let parsedOk = 0;
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      try {
        const blocks = parseCodexTranscript(text);
        totalBlocks += blocks.length;
        parsedOk++;
      } catch {
        /* one bad file shouldn't fail the real-slice check */
      }
    }
    console.log(`real-slice: parsed ${parsedOk}/${files.length} real Codex rollouts, ${totalBlocks} total blocks extracted`);
    ok(parsedOk === files.length, 'real-slice: every sampled real Codex rollout parses without throwing');
    ok(totalBlocks > 0, 'real-slice: real Codex rollouts produce a non-zero number of tool_use/tool_result blocks');
  }
}

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
