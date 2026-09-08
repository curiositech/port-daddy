/**
 * Codex CLI rollout adapter for the eureka arc detector.
 *
 * The operator was direct about this: mining only ~/.claude/projects and
 * calling it "Session Intelligence" is an Anthropic-shaped blind spot -- the
 * harness records transcripts from every backend, and the miner has to
 * cover them. This module adds ZERO new detection logic. eureka-arc-
 * detector.mjs's detectArcs(blocks, opts) is already format-agnostic --
 * it operates on a plain { kind, tool, input, isError, exitCode, text }
 * block array, not on Claude's JSONL shape directly. blocksFromLine/
 * parseTranscript are just the Claude-specific adapter that produces that
 * shape. This file is the Codex-specific adapter that produces the SAME
 * shape from Codex's real rollout schema, then hands off to the identical
 * shared detectArcs() -- the failure-clustering, similarity, and
 * whatChanged logic is 100% reused, not reimplemented.
 *
 * Codex rollout schema (real, characterized against ~/.codex/sessions/**):
 *   {type: "session_meta", payload: {session_id, ...}}
 *   {type: "response_item", payload: {type: "function_call", name,
 *     arguments: <JSON string>, call_id}}
 *   {type: "response_item", payload: {type: "function_call_output",
 *     call_id, output: <string, contains "Process exited with code N"
 *     for exec_command calls>}}
 *
 * Structural only, per house rule: is_error is derived from the exit-code
 * NUMBER parsed out of the harness's own fixed sentinel string ("Process
 * exited with code N"), never from scanning prose for words like "error"
 * or "failed".
 */

import { detectArcs } from './eureka-arc-detector.mjs';

const EXIT_CODE_RE = /Process exited with code (\d+)/;

/** Codex's function_call `arguments` is a JSON *string* -- parse defensively. */
function parseArguments(raw) {
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// exec_command/shell are Codex's names for the same primitive Claude calls
// "Bash" -- map to that exact string so invocationSignature() routes through
// its existing Bash-specific command normalization (whitespace collapse,
// volatile-redirection stripping) instead of the generic fallback, AND so a
// command that recurs once under Claude and once under Codex correctly
// clusters as ONE recurring signature rather than two runtime-siloed
// singletons. This is the actual point of fixing the Claude-only bias, not
// a cosmetic label choice.
const CODEX_TOOL_TO_SHARED_NAME = { exec_command: 'Bash', shell: 'Bash' };

function sharedToolName(codexName) {
  return CODEX_TOOL_TO_SHARED_NAME[codexName] || codexName;
}

/** A single, stable-shaped label for a Codex tool input, mirroring how
 * eureka-arc-detector.mjs's invocationSignature() reads Claude's `input`. */
function inputFor(name, args) {
  if (name === 'exec_command' || name === 'shell') {
    return { command: args.cmd || args.command || '' };
  }
  return args;
}

/** Codex rollout text -> the same block[] shape blocksFromLine() produces. */
export function codexBlocksFromLine(line) {
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return [];
  }
  if (!j || j.type !== 'response_item') return [];
  const p = j.payload;
  if (!p) return [];
  if (p.type === 'function_call') {
    const args = parseArguments(p.arguments);
    return [{ kind: 'tool_use', id: p.call_id || null, tool: sharedToolName(p.name || ''), input: inputFor(p.name, args) }];
  }
  if (p.type === 'function_call_output') {
    let output = p.output;
    if (output && typeof output === 'object') output = JSON.stringify(output);
    if (typeof output !== 'string') output = '';
    const m = EXIT_CODE_RE.exec(output);
    const exitCode = m ? Number(m[1]) : null;
    return [{
      kind: 'tool_result',
      forId: p.call_id || null,
      isError: exitCode !== null && exitCode !== 0,
      exitCode,
      text: output,
    }];
  }
  return [];
}

/** Codex rollout text -> the same ordered block[] parseTranscript() produces. */
export function parseCodexTranscript(text) {
  const blocks = [];
  let lineIndex = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    for (const b of codexBlocksFromLine(line)) {
      b.lineIndex = lineIndex;
      blocks.push(b);
    }
    lineIndex++;
  }
  return blocks;
}

/** session_meta.payload.session_id, if the rollout carries one. */
export function codexSessionIdFromText(text, fallback) {
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const j = JSON.parse(line);
      if (j && j.type === 'session_meta' && typeof j.payload?.session_id === 'string') {
        return j.payload.session_id;
      }
    } catch {
      /* skip */
    }
  }
  return fallback || null;
}

/**
 * Convenience: raw Codex rollout text -> arcs, reusing the SAME detectArcs()
 * Claude's detectArcsFromText() calls. Same options, same return shape.
 */
export function detectCodexArcsFromText(text, opts = {}) {
  const blocks = parseCodexTranscript(text);
  const sessionId = opts.sessionId || codexSessionIdFromText(text, opts.fallbackSessionId);
  return detectArcs(blocks, { ...opts, sessionId });
}
