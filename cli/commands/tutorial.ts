/**
 * Agent-facing CLI orientation for `pd learn` and its `pd tutorial` alias.
 *
 * This handler is intentionally operationally read-only. Its purpose is to
 * explain the operator/agent boundary and the current coordination loop
 * without creating tutorial ports, agents, sessions, notes, messages, DNS
 * records, or locks. The CLI envelope may still append its standard usage
 * trace, just as it does for every command.
 * Interactive terminals get paced sections plus one optional health read;
 * headless callers get the same deterministic guide without daemon access.
 */

import { ANSI } from '../../lib/maritime.js';
import * as ui from '../utils/ui.js';
import { pdFetch, getDaemonUrl } from '../utils/fetch.js';
import { hasControllingTerminal, readLineFromControllingTerminal } from '../utils/tty.js';
import type { FetchOptions, PdFetchResponse } from '../utils/fetch.js';

type LearnFetch = (path: string, options?: FetchOptions) => Promise<PdFetchResponse>;
type LearnWriter = (text: string) => void;

const LIVE_HEALTH_TIMEOUT_MS = 750;

/**
 * Decide whether the orientation can safely wait for a person.
 *
 * Color flags are intentionally irrelevant: a controlling terminal, not
 * decorated output, is the capability required by the paced guide.
 */
export function canRunInteractiveOrientation(
  env: NodeJS.ProcessEnv = process.env,
  terminalAvailable: () => boolean = hasControllingTerminal,
): boolean {
  return !env.CI && !env.PORT_DADDY_NON_INTERACTIVE && terminalAvailable();
}

export interface LearnOrientationOptions {
  /** Whether to pace output and read live health. Defaults to terminal capability. */
  interactive?: boolean;
  /** Injectable GET-only fetch seam used by the safety contract tests. */
  fetchImpl?: LearnFetch;
  /** Injectable output seam. Production writes to stderr like other guided CLI flows. */
  write?: LearnWriter;
  /** Injectable checkpoint seam so tests never need a controlling terminal. */
  pause?: () => Promise<void>;
  /** Injectable selected-daemon label for deterministic tests. */
  daemonUrl?: () => string;
}

/**
 * Render a compact bordered group while padding by visible rather than ANSI
 * byte width. The design keeps orientation output scannable without making
 * decoration part of the product lesson.
 *
 * @param lines - Already-formatted content lines to render.
 * @param write - Destination used for every emitted fragment.
 * @param width - Visible inner width of the rendered box.
 * @returns Nothing; output is streamed to the provided writer.
 */
function box(lines: string[], write: LearnWriter, width = 72): void {
  write(`  ┌${'─'.repeat(width)}┐\n`);
  for (const line of lines) {
    const pad = ' '.repeat(Math.max(0, width - 2 - ui.visibleWidth(line)));
    write(`  │ ${line}${pad} │\n`);
  }
  write(`  └${'─'.repeat(width)}┘\n`);
}

/**
 * Pause only when a real terminal can answer. The intent is to make the
 * interactive guide comfortable while ensuring agents, pipes, and CI receive
 * deterministic output and never block waiting for consent.
 *
 * @returns A promise resolved after Enter, or immediately without a terminal.
 */
async function pauseAtCheckpoint(): Promise<void> {
  if (!canRunInteractiveOrientation()) return;
  process.stderr.write(`\n  ${ANSI.dim}Press Enter to continue...${ANSI.reset}`);

  if (readLineFromControllingTerminal() === null) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    await new Promise<void>((resolve) => {
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
  }

  process.stderr.write('\n');
}

/**
 * Emit one numbered orientation section. The design centralizes the header so
 * the headless transcript remains stable enough for documentation and tests.
 *
 * @param number - One-based section number.
 * @param title - Human-readable section title.
 * @param write - Destination for the rendered header.
 * @returns Nothing; output is streamed to the provided writer.
 */
function lessonHeader(number: number, title: string, write: LearnWriter): void {
  write(`\n${'─'.repeat(4)} ${number}. ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}\n\n`);
}

/**
 * Read one safe runtime witness for an interactive orientation. The purpose is
 * to distinguish installed daemon truth from source-tree claims without
 * turning a tutorial into a stateful demo. A short deadline and disabled
 * reconnect retry keep this optional witness from delaying the guide.
 *
 * @param fetchImpl - Selected-daemon request implementation.
 * @param daemonUrl - Selected-daemon display label provider.
 * @param write - Destination for the snapshot.
 * @returns A promise resolved after rendering health or an offline-safe note.
 */
async function renderLiveHealth(
  fetchImpl: LearnFetch,
  daemonUrl: () => string,
  write: LearnWriter,
): Promise<void> {
  try {
    const response = await fetchImpl('/health', {
      timeout: LIVE_HEALTH_TIMEOUT_MS,
      retry: false,
    });
    const health = await response.json() as {
      status?: string;
      version?: string;
      pid?: number;
      plane?: string;
      daemon?: { label?: string; tier?: string };
    };
    if (!response.ok) throw new Error(`health returned ${response.status ?? 'unknown'}`);

    const selectedUrl = daemonUrl() || 'selected daemon endpoint';
    const label = health.daemon?.label || health.daemon?.tier || health.plane || 'unknown';
    write(`  Selected daemon: ${selectedUrl}\n`);
    write(`  Runtime witness: ${health.status ?? 'unknown'} · v${health.version ?? 'unknown'} · ${label}`);
    if (health.pid) write(` · PID ${health.pid}`);
    write('\n');
  } catch {
    write(`  Live health is unavailable. The orientation still works offline.\n`);
    write(`  Use ${ANSI.fgCyan}pd status${ANSI.reset} when the selected daemon is reachable.\n`);
  }
}

/**
 * Run the complete Port Daddy orientation. Its purpose is deliberately
 * non-mutating: headless execution performs zero daemon calls, while an
 * interactive run may issue only GET `/health`. Commands shown below are
 * examples for later use and are never executed by this function.
 *
 * @param options - Injectable terminal, fetch, output, and pause behavior.
 * @returns A promise resolved after every orientation section is rendered.
 */
export async function runLearnOrientation(options: LearnOrientationOptions = {}): Promise<void> {
  const interactive = options.interactive ?? canRunInteractiveOrientation();
  const fetchImpl = options.fetchImpl ?? pdFetch;
  const write = options.write ?? ((text: string) => process.stderr.write(text));
  const pause = options.pause ?? pauseAtCheckpoint;
  const daemonUrl = options.daemonUrl ?? getDaemonUrl;

  /**
   * Emit one complete line through the injected writer. The design keeps all
   * orientation content capturable without intercepting global process state.
   *
   * @param text - Optional line content; omission emits a blank line.
   * @returns Nothing; the line is forwarded immediately.
   */
  const line = (text = ''): void => write(`${text}\n`);

  line();
  box([
    '',
    `${ANSI.bold}Port Daddy orientation${ANSI.reset}`,
    '',
    'This is the agent and automation CLI. People use FleetBar and',
    'the selected daemon dashboard to watch, steer, and recover work.',
    '',
    `${ANSI.fgGreen}Orientation handler:${ANSI.reset} no work resources or files are changed.`,
    'After the guide, the CLI envelope makes exactly one append-only',
    'usage-telemetry attempt.',
    'It does not train a model, ingest history, or rebuild an index.',
    '',
  ], write);
  await pause();

  lessonHeader(1, 'Choose the right surface', write);
  line(`  ${ANSI.bold}People${ANSI.reset} use FleetBar and the selected daemon dashboard.`);
  line(`  ${ANSI.bold}Agents and automation${ANSI.reset} use pd, the SDK, or MCP.`);
  line();
  line('  Keep four kinds of evidence separate:');
  line(`    ${ANSI.fgCyan}source${ANSI.reset}      what the checkout says`);
  line(`    ${ANSI.fgCyan}artifact${ANSI.reset}    what the built binary contains`);
  line(`    ${ANSI.fgCyan}runtime${ANSI.reset}     what the selected daemon is serving`);
  line(`    ${ANSI.fgCyan}visual proof${ANSI.reset} what FleetBar, the dashboard, or an app rendered`);
  line();
  if (interactive) {
    await renderLiveHealth(fetchImpl, daemonUrl, write);
  } else {
    line('  Headless orientation: live probing is intentionally skipped.');
    line(`  Run ${ANSI.fgCyan}pd status${ANSI.reset} separately for a runtime witness.`);
  }
  await pause();

  lessonHeader(2, 'Arrive before touching files', write);
  line('  Start every meaningful repository turn by catching up:');
  line();
  line(`    ${ANSI.fgCyan}pd attention${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd status${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd sitrep --template${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd briefing${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd salvage --project <project> --limit 20${ANSI.reset}`);
  line();
  line(`  ${ANSI.fgCyan}pd attention${ANSI.reset} advances inbox and channel read cursors by default.`);
  line(`  Use ${ANSI.fgCyan}pd attention --peek${ANSI.reset} for a non-advancing preview.`);
  line('  These arrival checks reveal messages, runtime truth, active work, and recoverable intent.');
  line('  An empty agent roster plus active sessions is a coordination inconsistency.');
  await pause();

  lessonHeader(3, 'Establish attributable work', write);
  line('  Edit in a clean linked worktree, never the operator\'s primary checkout.');
  line('  Link the existing assigned roadmap item; do not duplicate it or replace its owner.');
  line('  A durable edit session needs an explicit work-authority link:');
  line();
  line(`    ${ANSI.fgCyan}pd begin "bounded task" --identity project:area:task \\${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}  --lifecycle durable --roadmap <slug>${ANSI.reset}`);
  line();
  line(`  Use ${ANSI.fgCyan}--roadmap-new "title"${ANSI.reset} to create a draft item, or`);
  line(`  ${ANSI.fgCyan}--sidequest "why this is intentionally outside the roadmap"${ANSI.reset}.`);
  line('  Pass exactly one; the daemon rejects unattributed work.');
  line('  Read back the link from the selected authority. Local storage is not a remote receipt.');
  line();
  line(`    ${ANSI.fgCyan}pd plan set "- [ ] Inspect\\n- [ ] Implement\\n- [ ] Verify\\n- [ ] Publish and land"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd note "Scope: files. Assumptions: truth. Validation: commands."${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd session files add <exact-path>${ANSI.reset}`);
  await pause();

  lessonHeader(4, 'Coordinate continuously', write);
  line('  Claims prevent surprise overlap; notes preserve intent and evidence.');
  line('  Re-read live coordination after long tests and before publishing.');
  line();
  line(`    ${ANSI.fgCyan}pd advise <path> --task "what you intend to change"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd who-owns <path>${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd sessions --all-worktrees${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd notes --limit 20${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd guard status${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd guard check --staged${ANSI.reset}`);
  line();
  line('  Stage only explicit paths you authored. Locks are for truly exclusive resources,');
  line('  not a substitute for narrow file or symbol claims.');
  line('  Keep unresolved tasks in durable notes and carry a compact, linked SITREP forward.');
  line();
  line('  Only at launch of a genuinely new child: isolate inherited parent PD_SESSION_ID');
  line('  and PD_AGENT_ID selectors and give the child its own context slot. Never clear an');
  line('  existing CONTEXT_CONFLICT to bypass a proven contradiction or borrow credentials.');
  line('  Re-read exact session, owner, worktree and branch; use supported recovery or name');
  line('  the missing capability, responsible owner, and next action in a durable handoff.');
  await pause();

  lessonHeader(5, 'Search the history you vaguely remember', write);
  line(`  ${ANSI.fgCyan}pd learn${ANSI.reset} is orientation. Retrieval lives on explicit search surfaces:`);
  line();
  line(`    ${ANSI.fgCyan}pd ideas search "rough memory of the thing"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd memory episodes --query "handoff or decision"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd roster search "expertise needed" --repo <path>${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd jury-rig search "task you are about to do"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd jury-rig graft "task"  # only after selecting full guidance${ANSI.reset}`);
  line();
  line('  Target invariant: semantic results carry model/space metadata and label degraded');
  line('  lexical fallback. Until a surface proves that contract, treat it as unverified;');
  line('  never compare vectors from incompatible model spaces.');
  await pause();

  lessonHeader(6, 'Own delivery through merge', write);
  line('  Code is not done merely because it is saved or committed. Implementation and');
  line('  requested research artifacts must be published for review, not left on disk.');
  line('  Use linked worktrees; commit small validated checkpoints often and read back a');
  line('  scoped pd note after each commit. A post-commit audit cannot undo an existing commit;');
  line('  inspect audit and persistence separately, and never repeat a successful commit.');
  line();
  line('  Before commit or push: fetch the canonical branch, reconcile, re-read peers,');
  line('  run focused tests plus the relevant broader gates, and check staged ownership.');
  line();
  line(`    ${ANSI.fgCyan}git fetch origin${ANSI.reset}`);
  line('    reconcile with the canonical branch using this repository\'s required strategy');
  line(`    ${ANSI.fgCyan}pd guard check --staged${ANSI.reset}`);
  line();
  line('  Publish a ready, non-draft PR through the configured GitHub App/Fleetbot publisher.');
  line('  Sign it with the responsible agent, session, roadmap link, and evidence links.');
  line('  Never silently fall back to the operator\'s personal GitHub credentials. If the');
  line('  publisher is unavailable, preserve the commit and name the exact missing route,');
  line('  responsible owner, and recovery action. An ad-hoc helper is not a shipped surface.');
  line();
  line('  Own the PR until merged or explicitly handed off to a named, accepting owner:');
  line('    Respond graciously to every actionable review; incorporate feedback unless');
  line('    demonstrably wrong or harmful, and explain any disagreement with evidence.');
  line('    Add regression tests, fix CI, and re-check the exact current PR head.');
  line('    Required checks must be green. Neutral/skipped Fleet is not substantive review.');
  line('    Use normal protected merge/queue; never bypass mandatory checks.');
  line('    Queue admission is not merge: verify the final merged-head receipt on main.');
  line();
  line(`    ${ANSI.fgCyan}pd note "Result: merged PR and commit. Validation: receipts. Remaining: risk."${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd done "short outcome"${ANSI.reset}`);
  line(`    ${ANSI.fgCyan}pd feedback "what worked or caused friction"${ANSI.reset}`);
  line();
  line('  Read-only answers/reviews need no PR. Findings-only reviewers without authoring');
  line('  authority return findings to the author; they must not push or merge.');
  line();
  line('  A green local command is one witness. PR checks, the compiled artifact, the live');
  line('  runtime, and visual proof remain separate witnesses when the change needs them.');
  line('  Claude SessionStart steering and the shared Claude/Codex/Gemini/agy turn tentacle');
  line('  are distinct. agy Stop is observe-only; generated files do not prove activation.');
  await pause();

  line();
  box([
    `${ANSI.bold}Orientation complete${ANSI.reset}`,
    '',
    'People: FleetBar + selected daemon dashboard.',
    'Agents: attention → sitrep → begin → plan → note → claim → verify.',
    'History: ideas, memory, roster, and skill-graft search surfaces.',
    'Delivery: checkpoints → App PR → reviews/green checks → protected merge.',
    'Finish: merged-head receipt → note → done → feedback.',
    '',
    'The orientation handler changed no work resources, files, or indexes.',
    'The CLI envelope now makes one append-only usage-telemetry attempt.',
  ], write);
  line();
}

/**
 * Dispatch the public `learn`/`tutorial` command. The handler intentionally has
 * no argument-dependent mutation mode; both aliases share the read-only guide.
 *
 * @returns A promise resolved when orientation output is complete.
 */
export async function handleLearn(): Promise<void> {
  await runLearnOrientation();
}
