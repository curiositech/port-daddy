import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runLearnOrientation } from '../../cli/commands/tutorial.ts';

const REPO = process.cwd();
const template = readFileSync(join(REPO, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
const fixtures: string[] = [];

/** Create only an isolated project marker; the design never borrows live context. */
function projectFixture(): string {
  const root = join(homedir(), 'coding', 'tmp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'pd-delivery-instructions-'));
  fixtures.push(dir);
  mkdirSync(join(dir, '.portdaddy'));
  return dir;
}

/**
 * Execute the actual release hook, with its optional salvage read pointed offline.
 *
 * @param dir - Generated project directory, never a user's checkout.
 * @param extra - Synthetic environment overrides for contract cases.
 * @returns The emitted Claude context, not a source-string approximation.
 */
function hookContext(dir: string, extra: NodeJS.ProcessEnv = {}): string {
  const output = execFileSync(process.execPath, [join(REPO, 'hooks/sessionstart-pilot.mjs')], {
    input: JSON.stringify({ cwd: dir }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PD_PILOT_DISABLE: '',
      PD_SITREP: 'enforce',
      PD_URL: 'http://127.0.0.1:1',
      PORT_DADDY_URL: 'http://127.0.0.1:1',
      ...extra,
    },
  });
  const envelope = JSON.parse(output);
  expect(envelope.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return envelope.hookSpecificOutput.additionalContext;
}

/** Render the actual offline guide while failing any accidental daemon request. */
async function orientation(): Promise<string> {
  let output = '';
  let calls = 0;
  await runLearnOrientation({
    interactive: false,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Offline orientation must never fetch');
    },
    write: (chunk) => { output += chunk; },
    pause: async () => {},
  });
  expect(calls).toBe(0);
  return output.replace(/\u001b\[[0-9;]*m/g, '');
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('delivery instruction contract', () => {
  test.each(['startup', 'orientation', 'template'] as const)(
    '%s carries review, publication, ownership and protected-merge obligations',
    async (surface) => {
      const text = surface === 'startup' ? hookContext(projectFixture())
        : surface === 'orientation' ? await orientation() : template;
      const compact = text.replace(/\s+/g, ' ');
      for (const phrase of [
        'linked worktree',
        'checkpoints',
        'App/Fleetbot',
        'non-draft',
        'gracious',
        'regression tests',
        'protected merge/queue',
        'merged-head receipt',
        'wrong or harmful',
        'read-only',
        'must not push or merge',
      ]) expect(compact.toLowerCase()).toContain(phrase.toLowerCase());
      expect(compact.toLowerCase()).toMatch(/required (?:checks|gate)/);
      expect(compact.toLowerCase()).toContain('neutral/skipped fleet');
      expect(compact.toLowerCase()).toContain('is not merge');
    },
  );

  test('orientation orders publication and review before session completion', async () => {
    const text = await orientation();
    const publish = text.indexOf('Publish a ready, non-draft PR');
    const reviews = text.indexOf('Respond graciously');
    const merged = text.indexOf('verify the final merged-head receipt');
    const done = text.indexOf('pd done "short outcome"');
    expect(publish).toBeGreaterThan(0);
    expect(reviews).toBeGreaterThan(publish);
    expect(merged).toBeGreaterThan(reviews);
    expect(done).toBeGreaterThan(merged);
    expect(text).toContain('never repeat a successful commit');
    expect(text).toContain('requested research artifacts must be published');
  });

  test('SITREP opt-out does not remove the delivery contract', () => {
    const text = hookContext(projectFixture(), { PD_SITREP: 'off' });
    expect(text).not.toContain('SITREP (end-of-turn');
    expect(text).toContain('OWN DELIVERY TO MAIN');
    expect(text).toContain('RECOVER EXACTLY');
    expect(Buffer.byteLength(text)).toBeLessThan(6000);
  });

  test('startup preserves an existing context and never echoes inherited selector values', () => {
    const dir = projectFixture();
    const context = join(dir, '.portdaddy/current.json');
    const before = JSON.stringify({ sessionId: 'fixture-session', agentId: 'fixture-agent' });
    writeFileSync(context, before);
    const filesBefore = readdirSync(join(dir, '.portdaddy'));
    const text = hookContext(dir, {
      PD_SESSION_ID: 'inherited-parent-session-sentinel',
      PD_AGENT_ID: 'inherited-parent-agent-sentinel',
    });
    expect(readFileSync(context, 'utf8')).toBe(before);
    expect(readdirSync(join(dir, '.portdaddy'))).toEqual(filesBefore);
    expect(text).not.toContain('inherited-parent-session-sentinel');
    expect(text).not.toContain('inherited-parent-agent-sentinel');
    expect(text).toContain('genuinely new child with its own context slot');
    expect(text).toContain('Never clear an existing CONTEXT_CONFLICT');
    expect(text).toContain('supported recovery');
  });

  test('orientation does not turn identity contradiction into blanket selector clearing', async () => {
    const text = await orientation();
    expect(text).toContain('Only at launch of a genuinely new child');
    expect(text).toContain('existing CONTEXT_CONFLICT to bypass a proven contradiction');
    expect(text).not.toContain('PD_SESSION_ID="" PD_AGENT_ID=""');
    expect(text).toContain('exact missing route');
    expect(text).toContain('ad-hoc helper is not a shipped surface');
  });

  test('runtime and roadmap claims remain evidence-specific on startup and orientation', async () => {
    for (const text of [hookContext(projectFixture()), await orientation()]) {
      expect(text).toContain('Claude SessionStart');
      expect(text).toContain('Claude/Codex/Gemini/agy');
      expect(text).toContain('agy Stop is observe-only');
      expect(text.toLowerCase()).toMatch(/generated.*do not prove/);
      expect(text.toLowerCase()).toContain('existing assigned roadmap item');
      expect(text.toLowerCase()).toMatch(/read[- ]back/);
    }
  });

  test('PR form requests attribution and final receipts without silently reconciling peers', () => {
    expect(template).toContain('Responsible Port Daddy agent / session:');
    expect(template).toContain('Final merged commit receipt (fill after merge):');
    expect(template).toContain('accepting successor');
    expect(template).toContain('typed PR field');
    expect(template).toContain('not silently close their PRs or erase plans');
    expect(template).toContain('Porthole recording');
    expect(template).not.toContain('a GIF, and a short screen recording');
    for (const marker of ['pr-requirements-exempt', 'visual-exempt', 'changelog-exempt']) {
      expect(template).not.toMatch(new RegExp(`<!--\\s*${marker}:`));
    }
  });
});
