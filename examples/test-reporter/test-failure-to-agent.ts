#!/usr/bin/env npx tsx
import { spawn } from 'node:child_process';
import { resolveExampleDaemonUrl } from '../_daemon-url.js';

const DEFAULT_DAEMON_URL = resolveExampleDaemonUrl();
const CHANNEL = process.env.PD_TUBE_CHANNEL ?? 'dev:test-failed';
const TUBE_KIND = 'tube.msg';

type CommandResult = {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

type TubeEnvelope = {
  v: 1;
  kind: typeof TUBE_KIND;
  body: string;
  inReplyTo?: number;
};

function daemonUrl() {
  return DEFAULT_DAEMON_URL.replace(/\/+$/, '');
}

function channelUrl() {
  return `${daemonUrl()}/msg/${encodeURIComponent(CHANNEL)}`;
}

function tubeEnvelope(body: unknown, inReplyTo?: number): TubeEnvelope {
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return inReplyTo ? { v: 1, kind: TUBE_KIND, body: text, inReplyTo } : { v: 1, kind: TUBE_KIND, body: text };
}

async function publishTube(body: unknown, sender = 'test-reporter') {
  const res = await fetch(channelUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender, payload: tubeEnvelope(body) }),
  });

  if (!res.ok) {
    throw new Error(`Port Daddy publish failed: HTTP ${res.status}`);
  }

  return (await res.json()) as { id: number };
}

async function readMessages(after: number) {
  const res = await fetch(`${channelUrl()}?after=${after}`);
  if (!res.ok) {
    throw new Error(`Port Daddy read failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id: number; sender?: string; payload?: unknown }> };
  return data.messages ?? [];
}

function decodeTubePayload(message: { payload?: unknown }) {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object') return null;
  const envelope = payload as Partial<TubeEnvelope>;
  return envelope.kind === TUBE_KIND ? envelope : null;
}

async function waitForReply(parentId: number, timeoutMs = 120000) {
  let cursor = parentId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await readMessages(cursor);
    for (const message of messages) {
      cursor = Math.max(cursor, message.id);
      const payload = decodeTubePayload(message);
      if (payload?.inReplyTo === parentId) {
        return { message, payload };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  return null;
}

function commandFromArgs(argv: string[]) {
  const wait = !argv.includes('--no-wait');
  const cleaned = argv.filter((arg) => arg !== '--no-wait');
  const separator = cleaned.indexOf('--');
  if (separator >= 0 && cleaned.length > separator + 1) {
    return { wait, command: cleaned.slice(separator + 1) };
  }

  return {
    wait,
    command: [
      process.execPath,
      '-e',
      "console.error('sample failure: expected status 200 but received 500'); process.exit(1)",
    ],
  };
}

function runCommand(command: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({ command, exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function truncate(text: string, max = 6000) {
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

async function main() {
  const { command, wait } = commandFromArgs(process.argv.slice(2));
  const result = await runCommand(command);

  if (result.exitCode === 0) {
    console.log('[pd-test-reporter] command passed; no tube event published.');
    return;
  }

  const event = {
    kind: 'test.failure',
    cwd: process.cwd(),
    command: result.command.join(' '),
    exitCode: result.exitCode,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    ask: 'Investigate this failure in the current repo. Reply with the cause, changed files if any, and the command I should run next.',
    at: new Date().toISOString(),
  };

  const posted = await publishTube(event);

  console.log('');
  console.log(`[pd-test-reporter] published failure ${posted.id} to ${CHANNEL}`);
  console.log(`[pd-test-reporter] agent side: pd tube ${CHANNEL}`);
  console.log(`[pd-test-reporter] reply with: printf '%s\\n' "diagnosis" | pd tube ${CHANNEL} --reply ${posted.id}`);

  if (!wait) {
    process.exitCode = result.exitCode;
    return;
  }

  console.log('[pd-test-reporter] waiting up to 120s for an agent reply...');
  const reply = await waitForReply(posted.id);
  if (!reply) {
    console.log('[pd-test-reporter] no reply before timeout.');
    process.exitCode = result.exitCode;
    return;
  }

  console.log('');
  console.log(`[pd-test-reporter] reply from ${reply.message.sender ?? 'agent'}:`);
  console.log(reply.payload.body);
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
