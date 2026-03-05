/**
 * CLI Tutorial Command — `pd learn`
 *
 * A guided, hands-on tutorial that teaches Port Daddy by actually using it.
 * Walks through maritime signals, port claims, sessions, notes, and more.
 * All actions are real — they run against the live daemon.
 */

import { execFile } from 'node:child_process';
import { ANSI, flag, highlightChannel, status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, getDaemonUrl } from '../utils/fetch.js';
import { canPrompt, promptText, promptIdentity, promptConfirm, promptSelect, printRoger } from '../utils/prompt.js';
import type { PdFetchResponse } from '../utils/fetch.js';

// Tutorial state — track what we create so we can clean up
interface TutorialState {
  claimedPorts: string[];
  sessionId: string | null;
  agentId: string | null;
}

// Mutable state — reset at the start of each handleLearn() invocation
const state: TutorialState = {
  claimedPorts: [],
  sessionId: null,
  agentId: null,
};

function resetState(): void {
  state.claimedPorts = [];
  state.sessionId = null;
  state.agentId = null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function box(lines: string[], width = 63): void {
  const top = `  \u250c${'─'.repeat(width)}\u2510`;
  const bottom = `  \u2514${'─'.repeat(width)}\u2518`;
  process.stderr.write(top + '\n');
  for (const line of lines) {
    process.stderr.write(`  \u2502 ${line.padEnd(width - 2)} \u2502\n`);
  }
  process.stderr.write(bottom + '\n');
}

async function pressEnter(): Promise<void> {
  if (!canPrompt()) return;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  await new Promise<void>((resolve) => {
    rl.question(`\n  ${ANSI.dim}Press Enter to continue...${ANSI.reset}`, () => {
      rl.close();
      resolve();
    });
  });
  process.stderr.write('\n');
}

function lessonHeader(num: number, title: string): void {
  process.stderr.write(`\n${'─'.repeat(4)} Lesson ${num}: ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}\n\n`);
}

// ─────────────────────────────────────────────────────────────────────
// Lessons
// ─────────────────────────────────────────────────────────────────────

async function welcome(): Promise<boolean> {
  process.stderr.write('\n');
  box([
    '',
    `${flag('kilo')}  Welcome aboard, Captain.`,
    `   Kilo flag ${ANSI.dim}\u2014 "Ready to communicate"${ANSI.reset}`,
    '',
    'Port Daddy manages ports, sessions, and agent',
    'coordination for multi-service development.',
    '',
    'This tutorial uses real commands \u2014 everything',
    'you do here actually runs against the daemon.',
    '',
  ]);

  return promptConfirm('Ready to begin?', true);
}

async function lesson1Flags(): Promise<void> {
  lessonHeader(1, 'Maritime Signals');

  process.stderr.write(`  Port Daddy uses nautical signal flags as status indicators.\n`);
  process.stderr.write(`  Here's your codebook:\n\n`);

  const flags: Array<[string, string, string]> = [
    ['charlie', 'Charlie', '"Affirmative" \u2014 Success, acquired, done'],
    ['november', 'November', '"Negative" \u2014 Errors, failures'],
    ['kilo', 'Kilo', '"Ready to talk" \u2014 Prompts, standby'],
    ['uniform', 'Uniform', '"Danger ahead" \u2014 Warnings, conflicts'],
    ['victor', 'Victor', '"Need assistance" \u2014 Help, mayday'],
    ['lima', 'Lima', '"Stop immediately" \u2014 Blocked, halt'],
  ];

  for (const [name, label, meaning] of flags) {
    process.stderr.write(`    ${flag(name as 'charlie')}  ${ANSI.bold}${label.padEnd(10)}${ANSI.reset} ${meaning}\n`);
  }

  process.stderr.write(`\n  Radio signals (you'll see these in messages):\n\n`);
  process.stderr.write(`    ${ANSI.fgGreen}HAIL${ANSI.reset}     \u2014 Announcing presence\n`);
  process.stderr.write(`    ${ANSI.fgGreen}ROGER${ANSI.reset}    \u2014 Message received\n`);
  process.stderr.write(`    ${ANSI.fgRed}MAYDAY${ANSI.reset}   \u2014 Emergency help needed\n`);
  process.stderr.write(`    ${ANSI.fgYellow}PAN-PAN${ANSI.reset}  \u2014 Urgent, not critical\n`);
  process.stderr.write(`    ${ANSI.fgCyan}SECURITE${ANSI.reset} \u2014 Safety information\n`);

  process.stderr.write(`\n  These are purely visual \u2014 the text always tells you what happened.\n`);

  await pressEnter();
}

async function lesson2Claim(): Promise<void> {
  lessonHeader(2, 'Claiming Ports');

  process.stderr.write(`  Every service needs a port. Port Daddy assigns them using\n`);
  process.stderr.write(`  semantic identities: ${ANSI.fgCyan}project${ANSI.reset}:${ANSI.fgYellow}stack${ANSI.reset}:${ANSI.fgGreen}context${ANSI.reset}\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}project${ANSI.reset}  = your app name       ${ANSI.dim}(cyan, like the sea)${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgYellow}stack${ANSI.reset}    = the service layer   ${ANSI.dim}(yellow, like signal flags)${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgGreen}context${ANSI.reset}  = branch or purpose   ${ANSI.dim}(green, starboard)${ANSI.reset}\n`);
  process.stderr.write(`\n  Let's claim a port for a demo service:\n\n`);

  const identity = await promptIdentity({ suggested: 'tutorial:demo:learn' }) || 'tutorial:demo:learn';

  try {
    const res: PdFetchResponse = await pdFetch('/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: identity }),
    });
    const data = await res.json();

    if (res.ok) {
      state.claimedPorts.push(identity);
      printRoger(`Port ${data.port} claimed for ${highlightChannel(identity)}`);
      process.stderr.write(`\n  Try it yourself:\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd claim ${identity} -q${ANSI.reset}    \u2192 ${data.port}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd find tutorial:*${ANSI.reset}          \u2192 list all tutorial services\n`);
    } else {
      process.stderr.write(`  ${maritimeStatus('warning', `Could not claim port: ${data.error || 'unknown error'}`)}\n`);
    }
  } catch {
    process.stderr.write(`  ${maritimeStatus('warning', 'Could not reach daemon \u2014 skipping live demo')}\n`);
  }

  await pressEnter();
}

async function lesson3Session(): Promise<void> {
  lessonHeader(3, 'Agent Sessions');

  process.stderr.write(`  When working on a task, start a session. This lets other\n`);
  process.stderr.write(`  agents know what you're doing and which files you own.\n\n`);

  const purpose = await promptText({
    label: 'What are you working on?',
    default: 'Learning Port Daddy tutorial',
  }) || 'Learning Port Daddy tutorial';

  try {
    const res: PdFetchResponse = await pdFetch('/sugar/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose,
        identity: 'tutorial:learn:interactive',
      }),
    });
    const data = await res.json();

    if (res.ok) {
      state.agentId = data.agentId as string;
      state.sessionId = data.sessionId as string;

      printRoger('Session started!');
      process.stderr.write(`    Agent:   ${data.agentId}\n`);
      process.stderr.write(`    Session: ${data.sessionId}\n`);
      process.stderr.write(`    Purpose: ${purpose}\n`);

      process.stderr.write(`\n  You just ran the equivalent of:\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin "${purpose}" --identity tutorial:learn:interactive${ANSI.reset}\n`);
      process.stderr.write(`\n  All four syntaxes work:\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin "${purpose}"${ANSI.reset}              ${ANSI.dim}# positional${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin --purpose "${purpose}"${ANSI.reset}    ${ANSI.dim}# named flag${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin -P "${purpose}"${ANSI.reset}           ${ANSI.dim}# short flag${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin${ANSI.reset}                           ${ANSI.dim}# interactive${ANSI.reset}\n`);
    } else {
      process.stderr.write(`  ${maritimeStatus('warning', `Could not start session: ${data.error || 'unknown error'}`)}\n`);
    }
  } catch {
    process.stderr.write(`  ${maritimeStatus('warning', 'Could not reach daemon \u2014 skipping live demo')}\n`);
  }

  await pressEnter();
}

async function lesson4Notes(): Promise<void> {
  lessonHeader(4, 'Leaving Notes');

  process.stderr.write(`  Notes are immutable breadcrumbs. If your session dies,\n`);
  process.stderr.write(`  another agent can read your notes and continue your work.\n\n`);
  process.stderr.write(`  Types:\n`);
  process.stderr.write(`    ${ANSI.fgYellow}progress${ANSI.reset}  \u2014 What you've done so far\n`);
  process.stderr.write(`    ${ANSI.fgYellow}decision${ANSI.reset}  \u2014 A choice you made and why\n`);
  process.stderr.write(`    ${ANSI.fgYellow}blocker${ANSI.reset}   \u2014 Something stopping you\n`);
  process.stderr.write(`    ${ANSI.fgYellow}question${ANSI.reset}  \u2014 Need input from someone\n`);
  process.stderr.write(`    ${ANSI.fgYellow}handoff${ANSI.reset}   \u2014 Passing work to another agent\n\n`);

  const noteContent = await promptText({
    label: 'Leave a progress note:',
    default: 'Completed tutorial lessons 1-4',
  }) || 'Completed tutorial lessons 1-4';

  try {
    const res: PdFetchResponse = await pdFetch('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: noteContent, type: 'progress' }),
    });

    if (res.ok) {
      printRoger('Note added (type: progress)');
      process.stderr.write(`\n  You just ran: ${ANSI.fgCyan}pd n "${noteContent}" --type progress${ANSI.reset}\n`);
    } else {
      process.stderr.write(`  ${maritimeStatus('warning', 'Could not add note')}\n`);
    }
  } catch {
    process.stderr.write(`  ${maritimeStatus('warning', 'Could not reach daemon \u2014 skipping live demo')}\n`);
  }

  await pressEnter();
}

async function lesson5Resurrection(): Promise<void> {
  lessonHeader(5, 'Resurrection & Agent Salvage');

  process.stderr.write(`  If an agent ${ANSI.bold}dies${ANSI.reset} without ending its session (crash, timeout,\n`);
  process.stderr.write(`  context window exceeded), Port Daddy preserves its work:\n\n`);
  process.stderr.write(`    1. Agent stops heartbeating\n`);
  process.stderr.write(`    2. After 10 min \u2192 marked ${ANSI.fgYellow}"stale"${ANSI.reset}\n`);
  process.stderr.write(`    3. After 20 min \u2192 marked ${ANSI.fgRed}"dead"${ANSI.reset}\n`);
  process.stderr.write(`    4. Dead agent's session, notes, and file claims are preserved\n`);
  process.stderr.write(`    5. New agent runs: ${ANSI.fgCyan}pd salvage${ANSI.reset}\n`);
  process.stderr.write(`    6. Claims the dead agent's work and continues\n\n`);
  process.stderr.write(`  This is what makes multi-agent coordination resilient \u2014\n`);
  process.stderr.write(`  no work is ever lost, even when agents crash.\n`);

  await pressEnter();
}

async function lesson6Coordination(): Promise<void> {
  lessonHeader(6, 'Channels, Locks & Coordination');

  process.stderr.write(`  Multiple agents can coordinate using channels and locks.\n\n`);
  process.stderr.write(`    ${ANSI.bold}Channels${ANSI.reset} = pub/sub messaging (fire and forget)\n`);
  process.stderr.write(`    ${ANSI.bold}Locks${ANSI.reset}    = mutual exclusion (only one agent at a time)\n\n`);

  const channel = await promptText({
    label: 'Channel name?',
    hint: 'e.g., build:done, deploy:staging',
    default: 'tutorial:learn:complete',
  }) || 'tutorial:learn:complete';

  try {
    const res: PdFetchResponse = await pdFetch(`/msg/${encodeURIComponent(channel)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { lesson: 6, status: 'learning' } }),
    });

    if (res.ok) {
      printRoger(`Published to ${highlightChannel(channel)}`);
    }
  } catch {
    process.stderr.write(`  ${maritimeStatus('warning', 'Could not publish \u2014 daemon offline')}\n`);
  }

  process.stderr.write(`\n  Locks provide exclusive access:\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd with-lock db-migrations npm run migrate${ANSI.reset}\n\n`);
  process.stderr.write(`  This runs your command while holding the lock. If another\n`);
  process.stderr.write(`  agent holds it, you wait. Auto-releases when done (or crash).\n`);

  await pressEnter();
}

async function lesson7Dashboard(): Promise<void> {
  lessonHeader(7, 'The Dashboard');

  const dashUrl = getDaemonUrl();

  process.stderr.write(`  Everything you just did is visible in the web dashboard.\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd dashboard${ANSI.reset}\n\n`);
  process.stderr.write(`  Opens ${ANSI.fgCyan}${dashUrl}${ANSI.reset} in your browser.\n\n`);
  process.stderr.write(`  You'll see:\n`);
  process.stderr.write(`    \u2022 Services panel with your claimed ports\n`);
  process.stderr.write(`    \u2022 Sessions panel with your session history\n`);
  process.stderr.write(`    \u2022 Agents panel showing who's registered\n`);
  process.stderr.write(`    \u2022 Channels showing messages you published\n`);
  process.stderr.write(`    \u2022 Activity log of everything that happened\n`);

  const openDash = await promptConfirm('Open the dashboard now?', false);
  if (openDash) {
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    execFile(openCmd, [dashUrl], (err) => {
      if (err) {
        process.stderr.write(`  Could not open browser. Visit: ${dashUrl}\n`);
      }
    });
    process.stderr.write(`\n  Opening ${dashUrl}...\n`);
  }

  await pressEnter();
}

async function lesson8Ending(): Promise<void> {
  lessonHeader(8, 'Ending Sessions');

  process.stderr.write(`  When you're done, end your session:\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd done "Finished the task"${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd done --note "Finished" --status completed${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd done${ANSI.reset}  ${ANSI.dim}# interactive${ANSI.reset}\n\n`);

  if (state.sessionId) {
    const endSession = await promptConfirm('End your tutorial session?', true);
    if (endSession) {
      try {
        const body: Record<string, unknown> = { note: 'Completed Port Daddy tutorial' };
        if (state.agentId) body.agentId = state.agentId;
        if (state.sessionId) body.sessionId = state.sessionId;

        const res: PdFetchResponse = await pdFetch('/sugar/done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = await res.json();
          printRoger('Session completed!');
          if (data.notesCount) process.stderr.write(`    Notes: ${data.notesCount}\n`);
          state.sessionId = null;
          state.agentId = null;
        }
      } catch {
        process.stderr.write(`  ${maritimeStatus('warning', 'Could not end session \u2014 daemon offline')}\n`);
      }
    }
  }

  await pressEnter();
}

async function summary(): Promise<void> {
  process.stderr.write(`\n${'─'.repeat(4)} Tutorial Complete! ${'─'.repeat(43)}\n\n`);

  process.stderr.write(`  ${flag('charlie')} ${ANSI.fgGreen}Well done, Captain!${ANSI.reset}\n\n`);

  box([
    `${ANSI.bold}Quick Reference${ANSI.reset}`,
    '',
    `${ANSI.fgCyan}pd begin "task"${ANSI.reset}    Start working (register + session)`,
    `${ANSI.fgCyan}pd n "update"${ANSI.reset}      Leave a note`,
    `${ANSI.fgCyan}pd done "note"${ANSI.reset}     Finish up (end session + unregister)`,
    `${ANSI.fgCyan}pd whoami${ANSI.reset}          Show current context`,
    `${ANSI.fgCyan}pd claim <id>${ANSI.reset}      Claim a port`,
    `${ANSI.fgCyan}pd find [pattern]${ANSI.reset}  Find services`,
    `${ANSI.fgCyan}pd salvage${ANSI.reset}         Check for dead agents to continue`,
    `${ANSI.fgCyan}pd scan [dir]${ANSI.reset}      Discover services in a project`,
    `${ANSI.fgCyan}pd dashboard${ANSI.reset}       Open the web dashboard`,
    `${ANSI.fgCyan}pd learn${ANSI.reset}           Run this tutorial again`,
    '',
    `All commands support: ${ANSI.fgCyan}--json${ANSI.reset} (-j), ${ANSI.fgCyan}--quiet${ANSI.reset} (-q),`,
    `${ANSI.fgCyan}--purpose${ANSI.reset} (-P), ${ANSI.fgCyan}--note${ANSI.reset} (-n), ${ANSI.fgCyan}--content${ANSI.reset} (-c)`,
    '',
    'Or just run any command with no args for interactive mode!',
  ]);

  process.stderr.write('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  for (const id of state.claimedPorts) {
    try {
      await pdFetch('/release', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

  if (state.sessionId && state.agentId) {
    try {
      await pdFetch('/sugar/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: state.agentId,
          sessionId: state.sessionId,
          note: 'Tutorial cleanup',
        }),
      });
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────

export async function handleLearn(): Promise<void> {
  if (!canPrompt()) {
    console.error('The tutorial requires an interactive terminal.');
    console.error('Run pd learn from a TTY (not piped or in CI).');
    process.exit(1);
  }

  // Reset state for re-entrant safety (e.g., tests calling handleLearn twice)
  resetState();

  // Handle Ctrl+C gracefully — register before any daemon interaction
  process.on('SIGINT', async () => {
    process.stderr.write(`\n\n  ${flag('november')} Tutorial interrupted \u2014 cleaning up...\n`);
    await cleanup();
    process.exit(0);
  });

  const ready = await welcome();
  if (!ready) {
    process.stderr.write(`\n  No worries \u2014 run ${ANSI.fgCyan}pd learn${ANSI.reset} anytime.\n\n`);
    return;
  }

  await lesson1Flags();
  await lesson2Claim();
  await lesson3Session();
  await lesson4Notes();
  await lesson5Resurrection();
  await lesson6Coordination();
  await lesson7Dashboard();
  await lesson8Ending();
  await summary();

  // Clean up tutorial ports (session already ended in lesson 8)
  for (const id of state.claimedPorts) {
    try {
      await pdFetch('/release', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }
}
