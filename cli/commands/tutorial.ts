/**
 * CLI Tutorial Command — `pd learn`
 *
 * A guided, hands-on tutorial that teaches Port Daddy by actually using it.
 * Walks through maritime signals, port claims, sessions, notes, and more.
 * All actions are real — they run against the live daemon.
 */

import { ANSI, flag, highlightChannel } from '../../lib/maritime.js';
import * as ui from '../utils/ui.js';
import { pdFetch, getDaemonUrl } from '../utils/fetch.js';
import { canPrompt, promptText, promptIdentity, promptConfirm, promptSelect, printRoger } from '../utils/prompt.js';
import { readLineFromControllingTerminal } from '../utils/tty.js';
import type { FetchOptions, PdFetchResponse } from '../utils/fetch.js';

// Tutorial state — track what we create so we can clean up
export interface TutorialState {
  claimedPorts: string[];
  sessionId: string | null;
  agentId: string | null;
  dnsIdentity?: string;
  lockName?: string;
  lockOwnerAgent?: string;
  inboxSenderAgent?: string;
  inboxReceiverAgent?: string;
}

type TutorialFetch = (path: string, options?: FetchOptions) => Promise<PdFetchResponse>;

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
  state.dnsIdentity = undefined;
  state.lockName = undefined;
  state.lockOwnerAgent = undefined;
  state.inboxSenderAgent = undefined;
  state.inboxReceiverAgent = undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function box(lines: string[], width = 63): void {
  const top = `  \u250c${'─'.repeat(width)}\u2510`;
  const bottom = `  \u2514${'─'.repeat(width)}\u2518`;
  process.stderr.write(top + '\n');
  for (const line of lines) {
    // Pad on VISIBLE width. `padEnd` counts ANSI escape bytes as characters, so
    // every coloured line (flags, cyan commands) came up short and the right
    // border went ragged — the first thing an operator sees in the welcome box.
    const pad = ' '.repeat(Math.max(0, width - 2 - ui.visibleWidth(line)));
    process.stderr.write(`  \u2502 ${line}${pad} \u2502\n`);
  }
  process.stderr.write(bottom + '\n');
}

async function pressEnter(): Promise<void> {
  if (!canPrompt()) return;
  process.stderr.write(`\n  ${ANSI.dim}Press Enter to continue...${ANSI.reset}`);

  // Read from the controlling terminal (/dev/tty). Under the bun-compiled
  // binary `process.stdin` can hand back immediate EOF on a real terminal,
  // which made readline resolve instantly and auto-skip every "Press Enter" —
  // the tutorial blasted through (#207). Reading /dev/tty as a *stream* then
  // crashed it outright (ENXIO under bun, EBADF under node), so this goes
  // through the blocking line reader instead.
  if (readLineFromControllingTerminal() === null) {
    // No controlling terminal to read (rare: canPrompt() said fd 0 is a tty).
    // Fall back to stdin rather than blasting through every lesson.
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    await new Promise<void>((resolve) => { rl.question('', () => { rl.close(); resolve(); }); });
  }

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
      ui.warn(`Could not claim port: ${data.error || 'unknown error'}`);
    }
  } catch {
    ui.warn('Could not reach daemon \u2014 skipping live demo');
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
        lifecycle: 'durable',
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
      process.stderr.write(`    ${ANSI.fgCyan}pd begin "${purpose}" --identity tutorial:learn:interactive --lifecycle durable${ANSI.reset}\n`);
      process.stderr.write(`\n  All four syntaxes work:\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin "${purpose}" --lifecycle durable${ANSI.reset}              ${ANSI.dim}# positional${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin --purpose "${purpose}" --lifecycle durable${ANSI.reset}    ${ANSI.dim}# named flag${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin -P "${purpose}" --lifecycle durable${ANSI.reset}           ${ANSI.dim}# short flag${ANSI.reset}\n`);
      process.stderr.write(`    ${ANSI.fgCyan}pd begin${ANSI.reset}                                             ${ANSI.dim}# interactive${ANSI.reset}\n`);
    } else {
      ui.warn(`Could not start session: ${data.error || 'unknown error'}`);
    }
  } catch {
    ui.warn('Could not reach daemon \u2014 skipping live demo');
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
      ui.warn('Could not add note');
    }
  } catch {
    ui.warn('Could not reach daemon \u2014 skipping live demo');
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
    ui.warn('Could not publish \u2014 daemon offline');
  }

  process.stderr.write(`\n  Locks provide exclusive access:\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd with-lock db-migrations npm run migrate${ANSI.reset}\n\n`);
  process.stderr.write(`  This runs your command while holding the lock. If another\n`);
  process.stderr.write(`  agent holds it, you wait. Auto-releases when done (or crash).\n`);

  await pressEnter();
}

async function lesson7Surfaces(): Promise<void> {
  lessonHeader(7, 'Seeing Your Fleet');

  process.stderr.write(`  Everything you just did is live state on the daemon. Here it is:\n\n`);

  try {
    const res: PdFetchResponse = await pdFetch('/health');
    const health = await res.json() as {
      version?: string;
      active_ports?: number;
      fleet?: { projects?: number; agents?: number };
    };
    process.stderr.write(`    Daemon:       ${ANSI.fgGreen}${health.version ?? 'unknown'}${ANSI.reset} at ${ANSI.fgCyan}${getDaemonUrl()}${ANSI.reset}\n`);
    process.stderr.write(`    Active ports: ${health.active_ports ?? 0}\n`);
    process.stderr.write(`    Fleet:        ${health.fleet?.projects ?? 0} project(s), ${health.fleet?.agents ?? 0} agent(s)\n`);
  } catch {
    ui.warn('Could not reach daemon \u2014 skipping live snapshot');
  }

  process.stderr.write(`\n  Three sanctioned surfaces render that same state:\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd dashboard${ANSI.reset}   ${ANSI.dim}# full terminal UI, right here in your shell${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd status${ANSI.reset}      ${ANSI.dim}# one-shot daemon health${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd sitrep${ANSI.reset}      ${ANSI.dim}# what the fleet is doing right now${ANSI.reset}\n\n`);
  process.stderr.write(`  Plus the desktop surfaces: ${ANSI.bold}FleetBar${ANSI.reset} in the menu bar, and from it\n`);
  process.stderr.write(`  ${ANSI.bold}Control Center${ANSI.reset} and the ${ANSI.bold}Operator Console${ANSI.reset} (pd-console).\n\n`);
  process.stderr.write(`  ${flag('uniform')}  ${ANSI.dim}The old browser dashboard is retired. ${getDaemonUrl()} is the${ANSI.reset}\n`);
  process.stderr.write(`     ${ANSI.dim}daemon's HTTP API now, not a UI \u2014 don't point a browser at it.${ANSI.reset}\n`);

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
        const body: Record<string, unknown> = {
          note: 'Result: Completed Port Daddy tutorial. not-applicable: tutorial exercise',
        };
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
        ui.warn('Could not end session \u2014 daemon offline');
      }
    }
  }

  await pressEnter();
}

async function lesson9Dns(): Promise<void> {
  lessonHeader(9, 'DNS and Service Discovery');

  process.stderr.write(`  Port Daddy can register DNS records for your services, making them\n`);
  process.stderr.write(`  accessible by name instead of port number.\n\n`);
  process.stderr.write(`  Let's register a DNS record for a tutorial service.\n\n`);

  const dnsIdentity = 'tutorial:dns:lesson9';

  try {
    const res: PdFetchResponse = await pdFetch(`/dns/${encodeURIComponent(dnsIdentity)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'tutorial-lesson9.local', port: 9999 }),
    });
    const record = await res.json();

    if (res.ok) {
      state.dnsIdentity = dnsIdentity;
      printRoger('DNS record registered:');
      process.stderr.write(`    ${record.hostname || 'tutorial-lesson9.local'} \u2192 port ${record.port || 9999}\n`);
    } else {
      ui.warn(`Could not register DNS: ${record.error || 'unknown error'}`);
    }
  } catch {
    ui.warn('Could not reach daemon \u2014 skipping live DNS demo');
  }

  // List DNS records
  try {
    const listRes: PdFetchResponse = await pdFetch('/dns');
    // /dns answers { success, records, count } — reading it as a bare array
    // reported "0 total" one line after registering a record.
    const body = await listRes.json() as { records?: unknown[]; count?: number };
    const count = typeof body?.count === 'number'
      ? body.count
      : Array.isArray(body?.records) ? body.records.length : 0;
    process.stderr.write(`\n  DNS records (${count} total)\n`);
  } catch {
    // silently skip listing if daemon is offline
  }

  // Show resolver status
  try {
    const statusRes: PdFetchResponse = await pdFetch('/dns/status');
    const dnsStatus = await statusRes.json();
    const active = dnsStatus.resolver && (dnsStatus.resolver as Record<string, unknown>).isSetUp;
    process.stderr.write(`  Resolver status: ${active ? `${ANSI.fgGreen}active${ANSI.reset}` : `${ANSI.dim}inactive${ANSI.reset}`}\n`);
  } catch {
    // silently skip status if daemon is offline
  }

  process.stderr.write(`\n  The resolver can write entries to /etc/hosts so your services\n`);
  process.stderr.write(`  are accessible by hostname. Use '${ANSI.fgCyan}pd dns setup${ANSI.reset}' to enable it\n`);
  process.stderr.write(`  (requires sudo).\n\n`);
  process.stderr.write(`  CLI equivalents:\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd claim myapp:api --dns${ANSI.reset}    ${ANSI.dim}# claim port + register DNS${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd dns list${ANSI.reset}                 ${ANSI.dim}# list all DNS records${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd dns status${ANSI.reset}               ${ANSI.dim}# check resolver status${ANSI.reset}\n`);

  await pressEnter();
}

async function lesson10Orchestration(): Promise<void> {
  lessonHeader(10, 'Stack Orchestration');

  process.stderr.write(`  Port Daddy can start your entire dev stack with a single command.\n\n`);
  process.stderr.write(`  Create a ${ANSI.fgYellow}.portdaddyrc${ANSI.reset} file in your project root:\n\n`);

  process.stderr.write(`  ${ANSI.dim}{${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}  "services": {${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    "api": {${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "cmd": "npm run dev:api",${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "port": "auto",${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "healthCheck": "/health"${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    },${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    "web": {${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "cmd": "npm run dev:web",${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "port": "auto",${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "env": { "API_URL": "http://localhost:{{api.port}}" },${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "dependsOn": ["api"]${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    },${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    "worker": {${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "cmd": "npm run worker",${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}      "dependsOn": ["api"]${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}    }${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}  }${ANSI.reset}\n`);
  process.stderr.write(`  ${ANSI.dim}}${ANSI.reset}\n`);

  process.stderr.write(`\n  Then start everything:\n\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd up${ANSI.reset}        ${ANSI.dim}# start all services in dependency order${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd down${ANSI.reset}      ${ANSI.dim}# graceful shutdown${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd scan${ANSI.reset}      ${ANSI.dim}# auto-detect frameworks, generate config${ANSI.reset}\n`);

  process.stderr.write(`\n  Key features:\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Dependency ordering \u2014 services start after their dependencies\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Health checks \u2014 waits for services to be ready\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Port injection \u2014 {{service.port}} templates in env vars\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Auto-detection \u2014 'pd scan' detects 60+ frameworks\n`);

  await pressEnter();
}

async function lesson11Locks(): Promise<void> {
  lessonHeader(11, 'Distributed Locks');

  process.stderr.write(`  When multiple agents need exclusive access to a resource (like running\n`);
  process.stderr.write(`  database migrations), distributed locks prevent conflicts.\n\n`);
  process.stderr.write(`  Let's acquire a lock, check it, and release it.\n\n`);

  const lockName = 'tutorial-lock';
  const lockOwnerAgent = `tutorial-lock-agent-${Date.now()}`;

  try {
    const registerRes: PdFetchResponse = await pdFetch('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: lockOwnerAgent,
        type: 'tutorial',
        purpose: 'Distributed lock demo owner',
      }),
    });
    if (registerRes.ok) {
      state.lockOwnerAgent = lockOwnerAgent;
    } else {
      ui.warn('Could not register the lock demo owner — skipping the live lock demo');
    }
  } catch {
    ui.warn('Could not reach daemon — skipping the live lock demo');
  }

  // Acquire lock
  if (state.lockOwnerAgent) {
    try {
      const acquireRes: PdFetchResponse = await pdFetch(`/locks/${encodeURIComponent(lockName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: state.lockOwnerAgent, ttl: 60000 }),
      });
      const lock = await acquireRes.json();

      if (acquireRes.ok) {
        state.lockName = lockName;
        printRoger(`Lock acquired: ${lockName}`);
        process.stderr.write(`    Owner: ${lock.owner || state.lockOwnerAgent}\n`);
        process.stderr.write(`    TTL: ${lock.ttl || 60000}ms\n`);
      } else {
        ui.warn(`Could not acquire lock: ${lock.error || 'unknown error'}`);
      }
    } catch {
      ui.warn('Could not reach daemon \u2014 skipping live lock demo');
    }
  }

  // Check lock status
  if (state.lockName) {
    try {
      const checkRes: PdFetchResponse = await pdFetch(`/locks/${encodeURIComponent(lockName)}`);
      const lockInfo = await checkRes.json();
      const held = lockInfo.held || lockInfo.owner;
      process.stderr.write(`\n  Lock status: ${held ? `${ANSI.fgYellow}held${ANSI.reset}` : `${ANSI.fgGreen}available${ANSI.reset}`}\n`);
    } catch {
      // silently skip check if daemon is offline
    }
  }

  // Release lock
  if (state.lockName) {
    try {
      const releaseRes: PdFetchResponse = await pdFetch(`/locks/${encodeURIComponent(lockName)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: state.lockOwnerAgent }),
      });
      if (releaseRes.ok || releaseRes.status === 404) {
        printRoger('Lock released');
        state.lockName = undefined; // already cleaned up
      } else {
        ui.warn('Could not release lock \u2014 cleanup will retry');
      }
    } catch {
      ui.warn('Could not release lock \u2014 cleanup will retry');
    }
  }

  if (!state.lockName && state.lockOwnerAgent) {
    try {
      const response = await pdFetch(`/agents/${encodeURIComponent(state.lockOwnerAgent)}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) state.lockOwnerAgent = undefined;
    } catch {
      ui.warn('Could not unregister the lock demo owner — cleanup will retry');
    }
  }

  process.stderr.write(`\n  Locks auto-expire after their TTL, so a crashed agent won't\n`);
  process.stderr.write(`  hold a lock forever.\n\n`);
  process.stderr.write(`  CLI equivalents:\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd lock db-migrations${ANSI.reset}                    ${ANSI.dim}# acquire${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd locks${ANSI.reset}                                 ${ANSI.dim}# list all locks${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd unlock db-migrations${ANSI.reset}                  ${ANSI.dim}# release${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd with-lock db-migrations -- npm run migrate${ANSI.reset}  ${ANSI.dim}# run under lock${ANSI.reset}\n`);

  await pressEnter();
}

async function lesson12Phases(): Promise<void> {
  lessonHeader(12, 'Session Phases & Integration');

  process.stderr.write(`  Sessions can track their progress through 6 phases:\n\n`);
  process.stderr.write(`    ${ANSI.dim}setup \u2192 planning \u2192 implementing \u2192 testing \u2192 reviewing \u2192 cleanup${ANSI.reset}\n\n`);
  process.stderr.write(`  Let's see how phases and integration signals work together.\n\n`);

  process.stderr.write(`  Advancing a session through phases:\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd session phase <session-id> implementing${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd session phase <session-id> testing${ANSI.reset}\n`);

  process.stderr.write(`\n  Integration signals let agents coordinate:\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd integration ready <session> api${ANSI.reset}      ${ANSI.dim}# "API is done"${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd integration needs <session> api${ANSI.reset}      ${ANSI.dim}# "I need the API"${ANSI.reset}\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd integration list${ANSI.reset}                     ${ANSI.dim}# show all signals${ANSI.reset}\n`);

  process.stderr.write(`\n  Agent liveness is monitored automatically:\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Agents send heartbeats every 5 minutes\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Stale after 10 min without heartbeat\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} Dead after 20 min \u2192 enters salvage queue\n`);
  process.stderr.write(`    ${ANSI.fgGreen}\u2022${ANSI.reset} The adaptive reaper adjusts thresholds based on load\n`);

  process.stderr.write(`\n  Get a full project briefing:\n`);
  process.stderr.write(`    ${ANSI.fgCyan}pd briefing myproject${ANSI.reset}\n`);
  process.stderr.write(`  Shows active agents, sessions, signals, and recent notes.\n`);

  await pressEnter();
}

async function lesson13Inbox(): Promise<void> {
  lessonHeader(13, 'Agent Inbox — Direct Messaging');

  process.stderr.write(`  Every registered agent has a personal inbox.\n`);
  process.stderr.write(`  Use it for targeted handoffs; use pub/sub for broadcasts.\n\n`);

  const ts = Date.now();
  const aliceId = `tutorial-alice-${ts}`;
  const bobId   = `tutorial-bob-${ts}`;
  state.inboxSenderAgent   = aliceId;
  state.inboxReceiverAgent = bobId;

  // Register two agents
  await pdFetch('/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: aliceId, type: 'tutorial', purpose: 'Inbox demo sender' }),
  }).catch(() => {});
  await pdFetch('/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bobId, type: 'tutorial', purpose: 'Inbox demo receiver' }),
  }).catch(() => {});
  process.stderr.write(`  Registered agents: ${aliceId} and ${bobId}\n\n`);

  // Alice sends Bob a message
  process.stderr.write(`  ${ANSI.fgCyan}Alice → Bob:${ANSI.reset} "Migrations complete, ready for review"\n`);
  await pdFetch(`/agents/${encodeURIComponent(bobId)}/inbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Migrations complete, ready for review', from: aliceId, type: 'handoff' }),
  }).catch(() => {});

  // Bob checks stats
  const statsResp = await pdFetch(`/agents/${encodeURIComponent(bobId)}/inbox/stats`).catch(() => null);
  const stats = (statsResp?.ok ? await statsResp.json() : {}) as { total?: number; unread?: number };
  process.stderr.write(`  Bob's inbox: total=${stats?.total ?? '?'}, unread=${stats?.unread ?? '?'}\n\n`);

  // Bob reads
  const readResp = await pdFetch(`/agents/${encodeURIComponent(bobId)}/inbox`).catch(() => null);
  const inbox = (readResp?.ok ? await readResp.json() : {}) as { messages?: Array<{ from?: string; content: string; type: string }> };
  for (const msg of (inbox?.messages ?? [])) {
    process.stderr.write(`  ${ANSI.fgGreen}[${msg.type}]${ANSI.reset} From ${msg.from ?? 'unknown'}: ${msg.content}\n`);
  }

  // Mark all read and clear
  await pdFetch(`/agents/${encodeURIComponent(bobId)}/inbox/read-all`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => {});
  await pdFetch(`/agents/${encodeURIComponent(bobId)}/inbox`, { method: 'DELETE' }).catch(() => {});
  process.stderr.write(`\n  Inbox cleared.\n\n`);

  process.stderr.write(`  CLI: ${ANSI.fgCyan}pd inbox list <agentId>${ANSI.reset}\n`);
  process.stderr.write(`       ${ANSI.fgCyan}pd inbox send <agentId> "message"${ANSI.reset}\n`);

  await pressEnter();
}

async function summary(): Promise<void> {
  process.stderr.write(`\n${'─'.repeat(4)} Tutorial Complete! ${'─'.repeat(43)}\n\n`);

  process.stderr.write(`  ${flag('charlie')} ${ANSI.fgGreen}Well done, Captain!${ANSI.reset}\n\n`);

  box([
    `${ANSI.bold}What You Learned${ANSI.reset}`,
    '',
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 1:  Maritime signal flags and radio codes`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 2:  Claiming ports with semantic identities`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 3:  Starting agent sessions`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 4:  Leaving immutable notes`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 5:  Agent resurrection and salvage`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 6:  Channels and locks for coordination`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 7:  Surfaces \u2014 dashboard, status, FleetBar`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 8:  Ending sessions cleanly`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 9:  DNS and service discovery`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 10: Stack orchestration with .portdaddyrc`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 11: Distributed locks for exclusive access`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 12: Session phases and integration signals`,
    `${ANSI.fgGreen}\u2713${ANSI.reset} Lesson 13: Agent inbox — direct messaging`,
  ]);

  process.stderr.write('\n');

  box([
    `${ANSI.bold}Quick Reference${ANSI.reset}`,
    '',
    `${ANSI.fgCyan}pd begin "task" --lifecycle durable${ANSI.reset}    Start working (register + session)`,
    `${ANSI.fgCyan}pd n "update"${ANSI.reset}      Leave a note`,
    `${ANSI.fgCyan}pd done "note"${ANSI.reset}     Finish up (end session + unregister)`,
    `${ANSI.fgCyan}pd whoami${ANSI.reset}          Show current context`,
    `${ANSI.fgCyan}pd claim <id>${ANSI.reset}      Claim a port`,
    `${ANSI.fgCyan}pd find [pattern]${ANSI.reset}  Find services`,
    `${ANSI.fgCyan}pd salvage${ANSI.reset}         Check for dead agents to continue`,
    `${ANSI.fgCyan}pd dns list${ANSI.reset}        List DNS records`,
    `${ANSI.fgCyan}pd up / pd down${ANSI.reset}    Start/stop service stacks`,
    `${ANSI.fgCyan}pd lock <name>${ANSI.reset}     Acquire a distributed lock`,
    `${ANSI.fgCyan}pd briefing <id>${ANSI.reset}   Full project briefing`,
    `${ANSI.fgCyan}pd scan [dir]${ANSI.reset}      Discover services in a project`,
    `${ANSI.fgCyan}pd dashboard${ANSI.reset}       Terminal dashboard (the web one is retired)`,
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

/**
 * Release every temporary tutorial resource. Exported only as a direct test
 * seam; this is not a CLI or public API surface.
 */
export async function cleanupTutorialState(
  tutorialState: TutorialState,
  fetchImpl: TutorialFetch = pdFetch,
): Promise<void> {
  const unreleasedPorts: string[] = [];
  for (const id of tutorialState.claimedPorts) {
    try {
      const response = await fetchImpl('/release', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok && response.status !== 404) unreleasedPorts.push(id);
    } catch {
      unreleasedPorts.push(id);
    }
  }
  tutorialState.claimedPorts = unreleasedPorts;

  if (tutorialState.sessionId && tutorialState.agentId) {
    try {
      const response = await fetchImpl('/sugar/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: tutorialState.agentId,
          sessionId: tutorialState.sessionId,
          note: 'Result: Tutorial cleanup completed. not-applicable: tutorial exercise',
        }),
      });
      if (response.ok || response.status === 404) {
        tutorialState.sessionId = null;
        tutorialState.agentId = null;
      }
    } catch {}
  }

  // Clean up DNS record from lesson 9
  if (tutorialState.dnsIdentity) {
    try {
      const response = await fetchImpl(`/dns/${encodeURIComponent(tutorialState.dnsIdentity)}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) tutorialState.dnsIdentity = undefined;
    } catch {}
  }

  // Clean up lock from lesson 11 (if not already released)
  if (tutorialState.lockName) {
    try {
      const response = await fetchImpl(`/locks/${encodeURIComponent(tutorialState.lockName)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: tutorialState.lockOwnerAgent ?? 'tutorial-agent' }),
      });
      if (response.ok || response.status === 404) tutorialState.lockName = undefined;
    } catch {}
  }

  // The owner is part of the lock-release credential. Preserve it whenever
  // lock cleanup failed so a later finalizer pass can retry the same release.
  if (!tutorialState.lockName && tutorialState.lockOwnerAgent) {
    try {
      const response = await fetchImpl(`/agents/${encodeURIComponent(tutorialState.lockOwnerAgent)}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) tutorialState.lockOwnerAgent = undefined;
    } catch {}
  }

  // Clean up inbox agents from lesson 13
  if (tutorialState.inboxReceiverAgent) {
    try {
      await fetchImpl(`/agents/${encodeURIComponent(tutorialState.inboxReceiverAgent)}/inbox`, { method: 'DELETE' });
    } catch {}
    try {
      const response = await fetchImpl(`/agents/${encodeURIComponent(tutorialState.inboxReceiverAgent)}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) tutorialState.inboxReceiverAgent = undefined;
    } catch {}
  }
  if (tutorialState.inboxSenderAgent) {
    try {
      const response = await fetchImpl(`/agents/${encodeURIComponent(tutorialState.inboxSenderAgent)}`, { method: 'DELETE' });
      if (response.ok || response.status === 404) tutorialState.inboxSenderAgent = undefined;
    } catch {}
  }
}

async function cleanup(): Promise<void> {
  await cleanupTutorialState(state);
}

/** Test seam for the lifecycle guarantee used by handleLearn(). */
export async function runWithTutorialCleanup(
  run: () => Promise<void>,
  cleanupFn: () => Promise<void> = cleanup,
): Promise<void> {
  try {
    await run();
  } finally {
    await cleanupFn();
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
  const handleInterrupt = async () => {
    process.stderr.write(`\n\n  ${flag('november')} Tutorial interrupted \u2014 cleaning up...\n`);
    await cleanup();
    process.exit(0);
  };
  process.once('SIGINT', handleInterrupt);

  try {
    await runWithTutorialCleanup(async () => {
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
      await lesson7Surfaces();
      await lesson8Ending();
      await lesson9Dns();
      await lesson10Orchestration();
      await lesson11Locks();
      await lesson12Phases();
      await lesson13Inbox();
      await summary();
    });
  } finally {
    process.removeListener('SIGINT', handleInterrupt);
  }
}
