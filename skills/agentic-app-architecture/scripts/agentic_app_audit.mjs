#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_DEDUCTION = { critical: 60, high: 30, medium: 15, low: 5 };
const COVERAGE_PASS_THRESHOLD = 70;
const MCP_CORE_SANE_THRESHOLD = 8;
const UNSAFE_SECRET_MODES = new Set(['argv', 'inline', 'none']);
const SAFE_SECRET_MODES = new Set(['hidden-stdin', 'secret-store', 'env-scoped']);
const AGENT_TYPES = new Set(['coding', 'non-coding']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an agentic LLM app's architecture across five axes: interaction
 * transparency, state/history/memory, context & caching economics,
 * capability integration (tools/skills/MCP/secrets), and execution substrate
 * & side effects.
 *
 * This is a design-time gate, not a runtime monitor: it flags shapes that are
 * known to produce untrustworthy, un-resumable, cost-blown-up, or unsafe
 * agentic apps, using the same deterministic per-axis scoring approach as
 * other port-daddy audit scripts (weighted deduction, critical findings force
 * pass=false regardless of score).
 *
 * @param {unknown} spec - parsed JSON spec matching schemas/agentic-app-spec.schema.json.
 * @returns {{pass: boolean, coverageByAxis: Record<string, number>, findings: Array<{id: string, axis: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditAgenticAppArchitecture(spec) {
  if (!isPlainObject(spec)) {
    throw new Error('spec must be a JSON object matching schemas/agentic-app-spec.schema.json');
  }

  const findings = [];
  const recommendations = [];
  const axisDeductions = { transparency: 0, stateModel: 0, contextStrategy: 0, capabilities: 0, execution: 0 };

  function fail(axis, id, severity, message, recommendation) {
    findings.push({ id, axis, severity, message });
    if (recommendation) recommendations.push(recommendation);
    axisDeductions[axis] += SEVERITY_DEDUCTION[severity] ?? 0;
  }

  // ---------- axis 1: transparency ----------
  const t = isPlainObject(spec.transparency) ? spec.transparency : {};
  if (t.thinkingVisible !== true || t.toolUseVisible !== true) {
    fail(
      'transparency',
      'hidden-thinking-or-tool-use',
      'critical',
      'Thinking and/or tool use is not surfaced to the human: this is a "chat box with secret hands."',
      'Stream thinking and tool calls inline or into a collapsible workbench pane; an un-shown tool call is un-steerable.'
    );
  }
  if (t.planBeforeAct !== true) {
    fail(
      'transparency',
      'no-plan-before-act',
      'medium',
      'The agent does not show a plan before acting on anything consequential.',
      'Surface a short plan (files to touch, commands to run, stop condition) before the first side-effecting action.'
    );
  }
  if (t.interruptible !== true) {
    fail(
      'transparency',
      'not-interruptible',
      'high',
      'There is no interruption/steering affordance while the agent is working.',
      'Add a cancel/steer control that takes effect mid-run, not just before the run starts.'
    );
  }

  // ---------- axis 2: state, history & memory ----------
  const s = isPlainObject(spec.stateModel) ? spec.stateModel : {};
  if (s.durableHistory !== true) {
    fail(
      'stateModel',
      'no-durable-history',
      'high',
      'Conversation history is not durably persisted; a lost session is unrecoverable.',
      'Persist thread history so sessions survive process restarts and can be salvaged.'
    );
  }
  if (s.forking !== true && s.episodicMemory !== true) {
    fail(
      'stateModel',
      'transcript-only-state',
      'critical',
      'Neither thread forking nor episodic memory exists: the transcript is treated as the entire state.',
      'Add thread forking to explore alternates without destroying the main line, and/or episodic memory to promote salient facts out of the transcript.'
    );
  }
  if (s.durableHistory === true && s.rename !== true) {
    recommendations.push('Durable history exists but sessions cannot be renamed/organized; add rename so a long history stays navigable.');
  }

  // ---------- axis 3: context & caching economics ----------
  const c = isPlainObject(spec.contextStrategy) ? spec.contextStrategy : {};
  if (c.caching !== true && c.eviction !== true && c.memoryPromotion !== true) {
    fail(
      'contextStrategy',
      'no-context-caching-strategy',
      'critical',
      'No caching, eviction, or memory-promotion strategy: context grows unbounded, which is a direct cost and latency blowup.',
      'Pick at least one: prompt caching for stable prefixes, eviction/summarization for stale turns, or promotion of durable facts into memory.'
    );
  } else {
    if (c.caching !== true) {
      fail(
        'contextStrategy',
        'no-prompt-caching',
        'medium',
        'No prompt caching strategy declared; the Anthropic prompt cache has a ~5-minute TTL, so poll/sleep cadence and context stability directly affect cache hit rate.',
        'Keep the cached prefix (system prompt, tool schemas, pinned context) stable and re-touch it inside the 5-minute TTL window, or accept the cost of cold reads.'
      );
    }
    if (c.eviction !== true) {
      fail(
        'contextStrategy',
        'no-eviction-strategy',
        'medium',
        'No eviction/summarization strategy for stale context.',
        'Summarize or drop old turns once the window fills instead of letting it grow until requests fail or costs spike.'
      );
    }
    if (c.memoryPromotion !== true) {
      fail(
        'contextStrategy',
        'no-memory-promotion',
        'medium',
        'No path to promote durable facts out of the context window into memory.',
        'Promote salient, reusable facts to episodic memory so they do not have to be re-paid-for on every turn.'
      );
    }
  }

  // ---------- axis 4: capability integration ----------
  const cap = isPlainObject(spec.capabilities) ? spec.capabilities : {};
  const mcp = isPlainObject(cap.mcp) ? cap.mcp : {};
  const secretCustody = isPlainObject(cap.secretCustody) ? cap.secretCustody : {};
  const hasAnyCapability = cap.tools === true || cap.skills === true || (typeof mcp.coreSize === 'number' && mcp.coreSize > 0);

  if (hasAnyCapability) {
    const mode = secretCustody.mode;
    if (typeof mode !== 'string' || UNSAFE_SECRET_MODES.has(mode) || !SAFE_SECRET_MODES.has(mode)) {
      fail(
        'capabilities',
        'unsafe-secret-custody',
        'critical',
        `Capabilities are wired up (tools/skills/MCP) but secretCustody.mode is '${mode ?? 'unset'}': secrets can land in argv, logs, or the transcript.`,
        "Route secrets through a hidden-stdin or secret-store path scoped to the tool call, never argv/inline/env-dumped-into-prompt. See `pd secret set` for the pattern."
      );
    }
  }

  if (typeof mcp.coreSize === 'number' && mcp.coreSize > MCP_CORE_SANE_THRESHOLD && mcp.perProjectSpecialists !== true) {
    fail(
      'capabilities',
      'mcp-boot-storm-risk',
      'high',
      `MCP core size is ${mcp.coreSize} servers with no per-project specialist split: over-broad global MCP config causes a boot storm and frozen sessions.`,
      'Keep the always-on global MCP core small (a handful of servers) and push project-specific servers to per-project config instead of the global core.'
    );
  }

  if (cap.tools === true && cap.skills !== true) {
    recommendations.push('Tools are wired up without skills: consider progressive-disclosure skill packs so large toolsets stay lazy-loaded rather than all schemas resident at once.');
  }

  // ---------- axis 5: execution substrate & side effects ----------
  const e = isPlainObject(spec.execution) ? spec.execution : {};
  const agentType = AGENT_TYPES.has(e.agentType) ? e.agentType : undefined;
  if (e.agentType !== undefined && agentType === undefined) {
    throw new Error("execution.agentType must be 'coding' or 'non-coding' when present");
  }

  const sideEffecting = e.isolation !== true || e.sideEffectHumanGate !== true || e.artifactReceipts !== true;
  if (sideEffecting) {
    const severity = agentType === 'coding' ? 'critical' : 'high';
    if (e.isolation !== true) {
      fail(
        'execution',
        'no-execution-isolation',
        severity,
        agentType === 'coding'
          ? 'Coding agent has no isolation (no worktree/branch separation): writes land directly in a shared checkout.'
          : 'Non-coding agent produces side effects with no sandbox/isolation boundary.',
        agentType === 'coding'
          ? 'Give every writer its own worktree/branch with advisory claims; never write directly against a shared checkout.'
          : 'Sandbox side-effecting actions (file writes, API calls, generated tools) so a bad run cannot corrupt shared state.'
      );
    }
    if (e.sideEffectHumanGate !== true) {
      fail(
        'execution',
        'no-human-gate-on-side-effects',
        severity,
        'Irreversible or outward-facing actions have no human checkpoint before they execute.',
        'Gate merges/pushes/sends/purchases/publishes behind an explicit human approval step; never let an irreversible action fire unattended.'
      );
    }
    if (e.artifactReceipts !== true) {
      fail(
        'execution',
        'no-artifact-receipt',
        severity,
        'Side-effecting work leaves no durable, artifact-backed receipt.',
        'Produce a receipt (diff summary, validation evidence, rollback pointer) for every side-effecting task, not just a chat message claiming success.'
      );
    }
  }

  // ---------- coverage + pass ----------
  const coverageByAxis = {};
  for (const axis of Object.keys(axisDeductions)) {
    coverageByAxis[axis] = Math.max(0, Math.min(100, 100 - axisDeductions[axis]));
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const allAxesAboveThreshold = Object.values(coverageByAxis).every((v) => v >= COVERAGE_PASS_THRESHOLD);
  const pass = !hasCritical && allAxesAboveThreshold;

  if (findings.length === 0) {
    recommendations.push('Architecture covers all five axes at a passing level. Spot-check that the declared booleans reflect what actually ships, not just what is planned.');
  }

  return { pass, coverageByAxis, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: agentic_app_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditAgenticAppArchitecture(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`agentic_app_audit: ${error.message}\n`);
    process.exit(1);
  }
}
