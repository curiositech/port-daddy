import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runLearnOrientation } from '../../cli/commands/tutorial.ts';
import { extractSystemPrompt, pilotRenderTargets, type PilotConfig } from '../../lib/pilot-agent-render.ts';

const REPO = process.cwd();
const template = readFileSync(join(REPO, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
const fixtures: string[] = [];
const publicRoots = ['skills', '.codex/skills', '.claude/skills', '.agents/skills', '.gemini/extensions/port-daddy/skills'];
const internalRoots = ['skills', '.codex/skills', '.claude/skills', '.agents/skills'];

/** Read source-owned instructions; the test must not consult installed user agents. */
function source(path: string): string {
  return readFileSync(join(REPO, path), 'utf8');
}

/** Select a named instruction section so an unrelated later disclaimer cannot satisfy it. */
function section(text: string, start: string, end: string): string {
  const begin = text.indexOf(start);
  const finish = text.indexOf(end, begin + start.length);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(finish).toBeGreaterThan(begin);
  return text.slice(begin, finish);
}

/** Assert delivery milestones in order, rejecting a premature completion command. */
function expectDeliveryOrder(text: string): void {
  const compact = text.replace(/\s+/g, ' ');
  const publish = compact.indexOf('ready, non-draft App/Fleetbot PR');
  const review = compact.toLowerCase().indexOf('gracious', publish);
  const merge = compact.indexOf('actual merged-head receipt', review);
  const done = compact.indexOf('pd done', merge);
  expect(publish).toBeGreaterThan(-1);
  expect(review).toBeGreaterThan(publish);
  expect(merge).toBeGreaterThan(review);
  expect(done).toBeGreaterThan(merge);
}

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
  test('canonical Pilot renders its full delivery and recovery contract into all five real formats', () => {
    const dir = projectFixture();
    const config = JSON.parse(source('agents/port-daddy-pilot/agent.config.json')) as PilotConfig;
    const system = extractSystemPrompt(source('agents/port-daddy-pilot/AGENT.md'));
    const before = readdirSync(dir);
    const targets = pilotRenderTargets(dir, config, system);
    expect(targets.map(target => target.runtime)).toEqual([
      'Claude Code', 'Codex CLI', 'Gemini CLI', 'Gemini extension (Antigravity)', 'Generic agents',
    ]);
    expect(new Set(targets.map(target => target.path)).size).toBe(5);
    for (const target of targets) {
      expect(target.path.startsWith(`${dir}/`)).toBe(true);
      expect(target.content).toContain(system);
      expectDeliveryOrder(target.content);
      for (const phrase of ['linked worktree', 'checkpoints', 'regression tests', 'protected merge/queue',
        'required checks', 'Neutral/skipped', 'queue admission is not merge', 'read-only',
        'must not push or merge', 'wrong or harmful', 'accepting successor', 'typed PR receipt',
        'complete', 'pd plan set', 'prior plan history', 'all GitHub access is', 'broker-routed',
        'repository/operator policy', 'is not a shipped surface', 'CONTEXT_CONFLICT',
        'genuinely new child with its own context slot', 'exact successor/claim',
        'Jury-rig', 'pd jury-rig query', 'pd jury-rig reference']) {
        expect(target.content.replace(/\s+/g, ' ').toLowerCase()).toContain(phrase.toLowerCase());
      }
      expect(target.content).not.toContain('PD_SESSION_ID="" PD_AGENT_ID=""');
      expect(target.content).not.toContain('/Cellar/windags/');
      expect(target.content).not.toContain('windags_skill_');
    }
    // Pure rendering is not installation or runtime enforcement.
    expect(readdirSync(dir)).toEqual(before);
    expect(config.description).toContain("Port Daddy's Jury-rig");
    expect(config.mcpServers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'port-daddy' })]));
    // Third-party catalog identifiers remain provenance, not a required runtime.
    expect(config.skills).toContain('next-move');
    expect(system).toContain('Do not require\n  or install an external planning runtime');
  });

  test.each(publicRoots)('%s public instructions and decision tree are exact canonical mirrors', (prefix) => {
    for (const suffix of ['SKILL.md', 'decisions/before-publish.md']) {
      expect(source(`${prefix}/port-daddy-agent-skill/${suffix}`))
        .toBe(source(`skills/port-daddy-agent-skill/${suffix}`));
    }
  });

  test.each(internalRoots)('%s contributor instructions retain exact canonical parity', (prefix) => {
    expect(source(`${prefix}/port-daddy-internal-dev/SKILL.md`))
      .toBe(source('skills/port-daddy-internal-dev/SKILL.md'));
  });

  test('both public quick loops defer completion until the full PR finish line', () => {
    const text = source('skills/port-daddy-agent-skill/SKILL.md');
    const loops = [section(text, '## Default Agent Happy Path', '## Plan & Todo List Tracking'),
      section(text, '## Operating Loop', '## Decision Points')];
    for (const loop of loops) {
      const compact = loop.replace(/\s+/g, ' ');
      const publish = compact.indexOf('ready, non-draft App/Fleetbot PR');
      const merged = compact.indexOf('merged-head receipt', publish);
      expect(publish).toBeGreaterThan(-1);
      expect(merged).toBeGreaterThan(publish);
      expect(compact.indexOf('pd done')).toBeGreaterThan(merged);
    }
    const finish = section(text, '## PR Finish Line', '## Small Decision Table').replace(/\s+/g, ' ');
    expect(finish).toContain('all GitHub access is broker-routed');
    expect(finish).toContain('honor that policy for reads too');
    expect(finish).toContain('Read-only reviewers');
    expect(finish).toContain('must not push or merge');
    expect(finish).toContain('accepting successor');
    expect(finish).toContain('postCommitAudit.commit');
    expect(finish).toContain('does not undo Git');
    expect(text).toContain('a caller-supplied reason is not operator authority');
    expect(text).toContain('This verifier runs even when the branch is fully pushed');
  });

  test('contributor lifecycle and decision tree cannot turn PR creation or missing context into done', () => {
    const internal = source('skills/port-daddy-internal-dev/SKILL.md');
    const lifecycle = section(internal, '## PR Lifecycle', '### Shell gotchas').replace(/\s+/g, ' ');
    expectDeliveryOrder(lifecycle);
    for (const phrase of ['do not run', 'at PR creation', 'actual merge',
      'all GitHub access is broker-routed', 'honor that policy for reads too',
      'accepting handoff', 'planned ActionReceipt API', 'is not a shipped surface']) {
      expect(lifecycle).toContain(phrase);
    }
    const recovery = section(internal, '- **A `git add -A` / `reset --hard`', '- **Binary drift');
    expect(recovery.replace(/\s+/g, ' ')).toContain('Do not rerun `pd begin`');
    expect(recovery).toContain('Never clear an existing');
    expect(recovery).toContain('`CONTEXT_CONFLICT`');
    expect(recovery).not.toContain('PD_SESSION_ID="" PD_AGENT_ID=""');
    const loop = section(internal, '## Operating Loop (contributor)', '**For releases**');
    expectDeliveryOrder(loop);
    expect(loop).not.toContain('gh pr create');
    expect(loop).not.toContain('git push -u');
    const tree = source('skills/port-daddy-agent-skill/decisions/before-publish.md');
    for (const phrase of ['not automatic `pd begin`', 'age is not authority', 'queue admission is not merge',
      'all GitHub access is broker-routed', 'honor\nthat policy for reads too', 'ready, non-draft App/Fleetbot PR',
      'hotfix does not grant an exception', 'Only after actual merge']) expect(tree).toContain(phrase);
    expect(tree).not.toContain('safe to resolve');
    expect(tree).not.toContain('open PR if one is expected');
    expect(internal).toContain('Guard receipt lookups must not infer absence from a capped list');
    expect(internal).toContain('Generated relay migration ledgers land through a PR');
  });

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
