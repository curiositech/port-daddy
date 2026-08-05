#!/usr/bin/env npx tsx
/**
 * Capture what the harness ACTUALLY injects into an agent's context window.
 *
 * **Why this exists rather than a mockup.** The claim "Port Daddy tells your
 * agent what it needs to know" is only worth making if you can show the exact
 * bytes. Every prior demo of this was staged strings in a shell script, which
 * proves nothing and — worse — drifts silently from the real hook the moment
 * anyone edits either one. What follows runs `bin/pd-hook-prompt` itself: the
 * real POSIX tentacle, against a real `matrix.env` written through the real
 * key builders in `lib/squid/reconcile-contract.ts`, and records its real
 * stdout.
 *
 * That output is not a description of the injection. Claude Code prepends the
 * hook's `additionalContext` verbatim to the model's context for that turn, so
 * the captured string IS the thing an agent reads, byte for byte, and the
 * measured size IS the context cost.
 *
 * Scenarios below are chosen to show the range that matters to a reader: the
 * quiet case (nothing to say, and the harness says nothing — the property the
 * whole quiet-harness design exists to protect), a routine case, the case the
 * feature is sold on, and the loudest case. A demo that only shows the loud
 * one is a lie by omission, because the honest headline is how often this
 * surface is silent.
 *
 * Usage:
 *   npx tsx scripts/capture-harness-context.ts            # human-readable
 *   npx tsx scripts/capture-harness-context.ts --json      # machine-readable
 *   npx tsx scripts/capture-harness-context.ts --out FILE  # write JSON to FILE
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  claimKey,
  inboxKey,
  parleyKey,
  PD_HALT_KEY,
} from '../lib/squid/reconcile-contract.js';

const REPO = process.cwd();
const HOOK = join(REPO, 'bin', 'pd-hook-prompt');
const ACTOR = 'agent-beta';

interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Why a reader should care that this case exists. */
  readonly note: string;
  /** Matrix lines, built through the real key builders. */
  readonly lines: (now: string) => string[];
  /**
   * Invoke the hook twice and capture the SECOND run.
   *
   * The standing plan directive is rate-limited per actor via a state file
   * under `$PD_HOME`, so an actor's FIRST turn always carries it. A capture
   * that only ever runs once therefore never observes true silence, and would
   * misreport the quiet harness as always speaking — which is the opposite of
   * the property being demonstrated.
   */
  readonly secondTurn?: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'first-turn',
    title: 'An agent\'s first turn, with nothing happening',
    note:
      'Even with an empty fleet the harness spends a little context once: the ' +
      'standing plan directive is rate-limited per actor, so it rides the first ' +
      'turn and then goes quiet for an hour.',
    lines: () => [`PD_RECON_HEARTBEAT_TS="${Date.now()}"`],
  },
  {
    id: 'quiet',
    title: 'Steady state, nothing happening',
    note:
      'The harness injects NOTHING and exits 0. This is the case that makes ' +
      'every other one trustworthy: if the block printed on every turn, an ' +
      'agent would learn to skim it, and the one that mattered would scroll ' +
      'past unread with the rest.',
    lines: () => [`PD_RECON_HEARTBEAT_TS="${Date.now()}"`],
    secondTurn: true,
  },
  {
    id: 'inbox',
    title: 'One agent asks another a question',
    note: 'Routine traffic — a directed message, addressed to this actor alone.',
    lines: (now) => [
      `PD_RECON_HEARTBEAT_TS="${Date.now()}"`,
      `${inboxKey(ACTOR, 'm1')}="tube: alpha asks which half of reconcile.ts you own | ts:${now}"`,
    ],
  },
  {
    id: 'collision',
    title: 'Two agents on the same file',
    note:
      'The case the product is sold on. Neither agent asked; the daemon noticed ' +
      'the overlap and told them both before either overwrote the other.',
    lines: (now) => [
      `PD_RECON_HEARTBEAT_TS="${Date.now()}"`,
      `${claimKey('lib/squid/reconcile.ts')}="2 agents hold lib/squid/reconcile.ts: alpha, beta | ts:${now}"`,
    ],
  },
  {
    id: 'parley',
    title: 'A parley is convened',
    note:
      'The collision escalated into a negotiation. The summons names the reason ' +
      'and reaches only the parties who have not yet replied.',
    lines: (now) => [
      `PD_RECON_HEARTBEAT_TS="${Date.now()}"`,
      `${parleyKey(ACTOR, 'p-7')}="PARLEY p-7: alpha summons you — both editing lib/squid/reconcile.ts | ts:${now}"`,
      `${claimKey('lib/squid/reconcile.ts')}="2 agents hold lib/squid/reconcile.ts: alpha, beta | ts:${now}"`,
    ],
  },
  {
    id: 'halt',
    title: 'The fleet is halted',
    note:
      'The loudest thing the harness can say, and it is rendered first on ' +
      'purpose — an agent that reads nothing else must still read this.',
    lines: (now) => [
      `PD_RECON_HEARTBEAT_TS="${Date.now()}"`,
      `${PD_HALT_KEY}="HALT: production incident — all agents stop merging | ts:${now}"`,
      `${inboxKey(ACTOR, 'm1')}="tube: alpha asks which half of reconcile.ts you own | ts:${now}"`,
    ],
  },
];

export interface Capture {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  /** Verbatim hook stdout. */
  readonly raw: string;
  /** The string Claude Code prepends to the model's context, or '' when silent. */
  readonly injected: string;
  /** Bytes of context this costs the agent. */
  readonly bytes: number;
  /** Rendered lines, for display. */
  readonly lines: readonly string[];
  readonly silent: boolean;
}

/** Run the REAL hook against a REAL matrix and record what it emits. */
function capture(scenario: Scenario): Capture {
  const scratch = mkdtempSync(join(tmpdir(), 'pd-harness-capture-'));
  try {
    const matrix = join(scratch, 'matrix.env');
    writeFileSync(matrix, `${scenario.lines(new Date().toISOString()).join('\n')}\n`, 'utf8');

    const run = (): string =>
      execFileSync('/bin/sh', [HOOK], {
        input: '{}',
        env: { ...process.env, PD_HOME: scratch, PD_MATRIX_FILE: matrix, PD_ACTOR: ACTOR },
        encoding: 'utf8',
      });

    // Same PD_HOME both times, so the second run sees the first's nag state.
    if (scenario.secondTurn) run();
    const raw = run();

    // The hook speaks Claude Code's UserPromptSubmit shape. Anything else is a
    // contract change and should be visible here rather than silently reshaped.
    let injected = '';
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        injected = String(JSON.parse(trimmed)?.hookSpecificOutput?.additionalContext ?? '');
      } catch {
        injected = trimmed;
      }
    }

    return {
      id: scenario.id,
      title: scenario.title,
      note: scenario.note,
      raw,
      injected,
      bytes: Buffer.byteLength(injected, 'utf8'),
      lines: injected ? injected.split('\n') : [],
      silent: injected === '',
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function captureAll(): Capture[] {
  return SCENARIOS.map(capture);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const results = captureAll();

  if (outIdx !== -1 && args[outIdx + 1]) {
    const out = args[outIdx + 1];
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ capturedAt: Date.now(), actor: ACTOR, scenarios: results }, null, 2)}\n`);
    console.log(`wrote ${results.length} captures to ${out}`);
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ capturedAt: Date.now(), actor: ACTOR, scenarios: results }, null, 2));
    return;
  }

  const silent = results.filter((r) => r.silent).length;
  for (const r of results) {
    console.log(`\n\x1b[1m${r.title}\x1b[0m  \x1b[2m(${r.id})\x1b[0m`);
    console.log(`\x1b[2m${r.note}\x1b[0m`);
    if (r.silent) {
      console.log('  \x1b[32m→ injects nothing (0 bytes)\x1b[0m');
      continue;
    }
    console.log(`  \x1b[33m→ ${r.bytes} bytes into the context window:\x1b[0m`);
    for (const line of r.lines) console.log(`    \x1b[36m│\x1b[0m ${line}`);
  }
  const total = results.reduce((a, r) => a + r.bytes, 0);
  console.log(
    `\n\x1b[2m${results.length} scenarios · ${silent} silent · ` +
      `${total} bytes total · avg ${Math.round(total / results.length)} bytes\x1b[0m`,
  );
}

// Only run when invoked directly, so the capture is importable by the page build.
if (process.argv[1] && process.argv[1].endsWith('capture-harness-context.ts')) main();
