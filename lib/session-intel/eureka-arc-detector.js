/**
 * Eureka arc detector (round 1) — Session Intelligence WS-2.
 *
 * Reads a Claude Code / Workflow session transcript (JSONL of user/assistant
 * turns whose `message.content` is an array of text/thinking/tool_use/
 * tool_result blocks) and detects "failure → failure → success" arcs: a tool
 * (usually Bash or a test runner) invoked with the same-or-similar input that
 * FAILED one or more times and then SUCCEEDED. Those breakthroughs are the
 * candidate eureka / skill-adding moments the program wants to mine.
 *
 * HARD RULE (operator, non-negotiable): NO keyword-based NLP. This module never
 * scans transcript text for words like "error"/"fixed"/"pass". Every signal is
 * STRUCTURAL:
 *   - tool_result.is_error  (the transcript's own boolean error status — a
 *     non-zero Bash exit / failed Edit surfaces here) and, when present, an
 *     explicit structured exit-code field.
 *   - tool_use.input compared for structural similarity (normalized command
 *     string for Bash; the identity field — file_path etc. — for other tools)
 *     via token-set Jaccard, never a signal-word list.
 * The optional semantic "is this skill-adding?" judgment is a CHEAP-TIER model
 * call reusing the budget-capped milestone cache — deliberately NOT implemented
 * as keyword matching, and deferred to round 2 (see annotateSkillAdding()).
 *
 * Prior parsing art: ~/.claude/wf-monitor/server.js `extractBlocks` /
 * `flattenResult` — pattern borrowed (block/result flattening), reimplemented
 * here cleanly with no coupling.
 */

// ---------------------------------------------------------------------------
// Block extraction (borrowed pattern from wf-monitor extractBlocks, decoupled)
// ---------------------------------------------------------------------------

/** Flatten tool_result content (string OR array of {type:'text',text}) → text. */
function flattenResultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (typeof b.text === 'string') parts.push(b.text);
      else if (b.type === 'image') parts.push('[image]');
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Parse one JSONL transcript line into a flat, ORDERED list of blocks we care
 * about: tool_use and tool_result. Returns [] for lines with no such blocks.
 * Each block carries `lineIndex` (set by caller) so downstream indices are the
 * transcript's own ordering, not a fabricated counter.
 */
function blocksFromLine(line) {
  let j;
  try { j = JSON.parse(line); } catch { return []; }
  const m = j && j.message;
  if (!m || !Array.isArray(m.content)) return [];
  const out = [];
  for (const b of m.content) {
    if (!b || !b.type) continue;
    if (b.type === 'tool_use') {
      out.push({ kind: 'tool_use', id: b.id || null, tool: b.name || '', input: b.input || {} });
    } else if (b.type === 'tool_result') {
      out.push({
        kind: 'tool_result',
        forId: b.tool_use_id || null,
        isError: b.is_error === true,
        exitCode: extractExitCode(b),
        text: flattenResultText(b.content),
      });
    }
  }
  return out;
}

/**
 * Some harnesses attach a structured exit code to a tool_result. We read it if
 * present (structured field only — never parsed out of free text). Returns a
 * number or null. This is a secondary signal; is_error is primary.
 */
function extractExitCode(resultBlock) {
  for (const k of ['exit_code', 'exitCode', 'returncode', 'code']) {
    const v = resultBlock && resultBlock[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

/**
 * Detect a HARNESS INTERRUPT — a tool call the harness cancelled before (or
 * during) execution, e.g. a parallel-tool-call batch that was aborted or a
 * user interrupt. Claude Code wraps these in its own machine-generated sentinel
 * envelope `<tool_use_error>Cancelled: …</tool_use_error>` /
 * `<tool_use_error>… Interrupted by user …`.
 *
 * This is NOT keyword NLP over prose: we match the harness's fixed error-
 * envelope tag plus its fixed cancellation/interrupt sentinels — the same class
 * of structured signal as `is_error`, emitted by the framework, not authored by
 * a human. An interrupted call never really ran, so it is neither a genuine
 * failure nor a success; the detector drops it from the arc sequence so a
 * cancelled batch doesn't fabricate or inflate a fail→success arc.
 */
function isHarnessInterrupt(resultText) {
  const t = String(resultText || '');
  if (!t.includes('<tool_use_error>')) return false;
  return /<tool_use_error>\s*Cancelled:/.test(t)
    || /Interrupted by user/.test(t)
    || /parallel tool call[^<]*errored/.test(t);
}

/** Parse a whole transcript (string of JSONL) → ordered block stream. */
function parseTranscript(text) {
  const blocks = [];
  let lineIndex = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    for (const b of blocksFromLine(line)) {
      b.lineIndex = lineIndex;
      blocks.push(b);
    }
    lineIndex++;
  }
  return blocks;
}

/** Best-effort sessionId: explicit field if the transcript carries one. */
function sessionIdFromText(text, fallback) {
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const j = JSON.parse(line);
      if (j && typeof j.sessionId === 'string') return j.sessionId;
    } catch { /* skip */ }
  }
  return fallback || null;
}

// ---------------------------------------------------------------------------
// Structural signature + similarity (NO keyword lists)
// ---------------------------------------------------------------------------

/**
 * Normalize a Bash command into a stable signature: collapse whitespace, strip
 * the volatile tail redirections/pagers that don't change intent, and drop
 * obviously volatile tokens (hex hashes, uuids, epoch-ish numbers). This is
 * structural text normalization, NOT semantic classification.
 */
function normalizeBashCommand(cmd) {
  let s = String(cmd || '');
  s = s.replace(/\s+/g, ' ').trim();
  // Drop trailing pager/redirection noise that agents append inconsistently.
  s = s.replace(/\s*2>&1\s*/g, ' ');
  s = s.replace(/\s*\|\s*(head|tail|cat)\b[^|]*$/g, '');
  // Mask volatile tokens so "same command, different run id" still matches.
  s = s.replace(/\b[0-9a-f]{7,40}\b/gi, '<hex>');
  s = s.replace(/\b\d{9,}\b/g, '<num>');
  return s.trim();
}

/**
 * A tool invocation's structural signature + identity tokens.
 *  - Bash: normalized command; identity = the leading argv (verb + first args).
 *  - File tools (Edit/Write/Read/...): the file_path is the identity.
 *  - Otherwise: tool name + sorted top-level scalar input keys/values.
 */
function invocationSignature(tool, input) {
  input = input || {};
  if (tool === 'Bash' && typeof input.command === 'string') {
    const norm = normalizeBashCommand(input.command);
    return { key: norm, tokens: tokenize(norm), label: input.command };
  }
  if (typeof input.file_path === 'string') {
    return { key: tool + ':' + input.file_path, tokens: tokenize(input.file_path), label: tool + ' ' + input.file_path };
  }
  if (typeof input.filePath === 'string') {
    return { key: tool + ':' + input.filePath, tokens: tokenize(input.filePath), label: tool + ' ' + input.filePath };
  }
  // Generic: stable stringify of scalar inputs.
  const scalars = Object.keys(input)
    .filter((k) => ['string', 'number', 'boolean'].includes(typeof input[k]))
    .sort()
    .map((k) => `${k}=${input[k]}`)
    .join(' ');
  const key = tool + ':' + scalars;
  return { key, tokens: tokenize(key), label: tool + ' ' + scalars };
}

function tokenize(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9<>_./-]+/)
      .filter((t) => t.length > 0)
  );
}

/** Jaccard similarity between two token sets. */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Arc detection
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of "invocations" — each tool_result paired to the
 * tool_use it answers (via tool_use_id), carrying the invocation's signature
 * and outcome. tool_results whose tool_use we never saw are still kept with a
 * degraded signature so we don't silently drop failures.
 */
function buildInvocations(blocks, opts = {}) {
  const ignoreInterrupted = opts.ignoreInterrupted !== false; // default true
  const useById = new Map();
  for (const b of blocks) if (b.kind === 'tool_use' && b.id) useById.set(b.id, b);

  const invs = [];
  for (const b of blocks) {
    if (b.kind !== 'tool_result') continue;
    const use = b.forId ? useById.get(b.forId) : null;
    const tool = use ? use.tool : '(unknown)';
    const sig = invocationSignature(tool, use ? use.input : {});
    const interrupted = ignoreInterrupted && isHarnessInterrupt(b.text);
    // Failure iff the transcript marked it an error OR a structured non-zero
    // exit — but a harness-cancelled call never ran, so it is not a failure.
    const failed = !interrupted && (b.isError === true || (typeof b.exitCode === 'number' && b.exitCode !== 0));
    invs.push({
      tool,
      key: sig.key,
      tokens: sig.tokens,
      label: sig.label,
      failed,
      interrupted,
      exitCode: b.exitCode,
      resultText: b.text || '',
      blockIndex: b.lineIndex,
    });
  }
  return invs;
}

/**
 * Cluster invocations of the SAME tool into arc groups by structural
 * similarity. Greedy, order-preserving: each invocation joins the most-recent
 * matching cluster (exact normalized key OR Jaccard ≥ simThreshold), else opens
 * a new one. Deterministic given input order.
 */
function clusterInvocations(invs, simThreshold) {
  const clusters = [];
  for (const inv of invs) {
    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      if (c.tool !== inv.tool) continue;
      if (c.key === inv.key) { best = c; bestScore = 1; break; }
      const score = jaccard(c.tokens, inv.tokens);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= simThreshold) {
      best.members.push(inv);
    } else {
      clusters.push({ tool: inv.tool, key: inv.key, tokens: inv.tokens, members: [inv] });
    }
  }
  return clusters;
}

/**
 * Structural delta between two invocation inputs (last failure vs the eureka
 * success): token-level added / removed. When the command is byte-identical the
 * breakthrough came from external state (a file the agent fixed between runs,
 * an installed dep, a flaky test settling) — we say so honestly.
 */
function whatChanged(prevInv, successInv) {
  if (prevInv.label === successInv.label) {
    return { type: 'identical-invocation', added: [], removed: [], note: 'same invocation succeeded after prior failures — external state/environment changed between runs' };
  }
  const a = prevInv.tokens;
  const b = successInv.tokens;
  const added = [...b].filter((t) => !a.has(t));
  const removed = [...a].filter((t) => !b.has(t));
  return { type: 'invocation-changed', added, removed, note: `${added.length} token(s) added, ${removed.length} removed between last failure and success` };
}

function clip(s, n) {
  s = String(s || '').replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Detect eureka arcs in an already-parsed block stream.
 *
 * @param {Array} blocks           parseTranscript() output
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {number} opts.minFailures  min consecutive failures before the win (default 2 → "fail→fail→success")
 * @param {number} opts.simThreshold Jaccard threshold to treat two invocations as the "same" (default 0.6)
 * @param {boolean} opts.ignoreInterrupted drop harness-cancelled calls (default true)
 * @returns {Array<Arc>} each: { sessionId, tool, failCount, eurekaBlockIndex, whatChangedDelta, excerpt, ... }
 */
function detectArcs(blocks, opts = {}) {
  const sessionId = opts.sessionId || null;
  const minFailures = opts.minFailures == null ? 2 : opts.minFailures;
  const simThreshold = opts.simThreshold == null ? 0.6 : opts.simThreshold;

  const invs = buildInvocations(blocks, { ignoreInterrupted: opts.ignoreInterrupted });
  const clusters = clusterInvocations(invs, simThreshold);

  const arcs = [];
  for (const c of clusters) {
    const seq = c.members; // already in transcript order
    // Walk the cluster: count a run of failures, and when a success lands after
    // >= minFailures failures, emit an arc. Reset the failure run after a win.
    let failRun = [];
    for (const inv of seq) {
      // A harness-cancelled call never ran — it neither fails nor succeeds nor
      // breaks a genuine failure run. Skip it entirely.
      if (inv.interrupted) continue;
      if (inv.failed) {
        failRun.push(inv);
        continue;
      }
      // success
      if (failRun.length >= minFailures) {
        const lastFail = failRun[failRun.length - 1];
        const delta = whatChanged(lastFail, inv);
        arcs.push({
          sessionId,
          tool: c.tool,
          signature: c.key,
          failCount: failRun.length,
          eurekaBlockIndex: inv.blockIndex,
          firstFailBlockIndex: failRun[0].blockIndex,
          whatChangedDelta: delta,
          excerpt: {
            lastFailure: clip(lastFail.resultText, 240),
            success: clip(inv.resultText, 240),
            failingInvocation: clip(lastFail.label, 200),
            successInvocation: clip(inv.label, 200),
          },
          skillAdding: null, // reserved for round-2 cheap-model annotation
        });
      }
      failRun = [];
    }
  }
  // Order arcs by where the breakthrough happened.
  arcs.sort((x, y) => x.eurekaBlockIndex - y.eurekaBlockIndex);
  return arcs;
}

/** Convenience: raw transcript text → arcs. */
function detectArcsFromText(text, opts = {}) {
  const blocks = parseTranscript(text);
  const sessionId = opts.sessionId || sessionIdFromText(text, opts.fallbackSessionId);
  return detectArcs(blocks, { ...opts, sessionId });
}

// ---------------------------------------------------------------------------
// Round-2 hook (documented, NOT faked)
// ---------------------------------------------------------------------------

/**
 * ROUND 2 — NOT IMPLEMENTED (honest stub-free TODO).
 *
 * Given a detected arc, decide whether the breakthrough is genuinely
 * skill-adding (worth L3 extraction + skill-architect drafting). This MUST be a
 * CHEAP-TIER model call reusing the budget-capped cache at
 * ~/.claude/wf-monitor/milestone-cache.js (MilestoneCache / computeMilestones,
 * MODEL is the cheap tier). It must NEVER be a keyword/substring judgment.
 *
 * Deliberately throws so no caller can mistake an unimplemented judgment for a
 * real one. Round-1 ships pure structured detection only.
 */
function annotateSkillAdding() {
  throw new Error('annotateSkillAdding: round-2 (cheap-model, milestone-cache-backed) — not implemented in round 1. See docs/roadmap/session-intelligence-program.md TODO.');
}

export {
  parseTranscript,
  sessionIdFromText,
  blocksFromLine,
  flattenResultText,
  isHarnessInterrupt,
  normalizeBashCommand,
  invocationSignature,
  jaccard,
  buildInvocations,
  clusterInvocations,
  whatChanged,
  detectArcs,
  detectArcsFromText,
  annotateSkillAdding,
};
