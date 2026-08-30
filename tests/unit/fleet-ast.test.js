// tests/unit/fleet-ast.test.js
//
// Verifies ADR-0026 step 1: parseFleetSource returns source-aware FleetAst,
// astToConfig projects it back to a FleetConfig equivalent to loadFleetConfig.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const STARTER_PATH = join(__dir, '../../templates/pd-fleet-starter.yml');

// fleet-ast.ts has no runtime deps on fleet-engine.ts (import type only),
// so no mocks are needed here.
const { parseFleetSource, astToConfig } = await import('../../lib/fleet-ast.js');

const SOURCE = readFileSync(STARTER_PATH, 'utf-8');

// ─── parseFleetSource ─────────────────────────────────────────────────────────

describe('parseFleetSource', () => {
  test('parses only the Jury-rig fleet opt-in and ignores the removed skill-graft keys', () => {
    const current = astToConfig(parseFleetSource(`name: test\nagents:\n  - name: current\n    task: test\n    jury_rig: true\n`));
    const removed = astToConfig(parseFleetSource(`name: test\nagents:\n  - name: removed\n    task: test\n    skill_graft: true\n`));
    expect(current.agents[0].juryRig).toBe(true);
    expect(removed.agents[0].juryRig).toBe(false);
  });

  it('returns null for empty source', () => {
    expect(parseFleetSource('')).toBeNull();
    expect(parseFleetSource('   \n\t  ')).toBeNull();
  });

  it('parses the starter template without error', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast).not.toBeNull();
    expect(ast.kind).toBe('fleet');
  });

  it('extracts the fleet name node with its value', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast.name.kind).toBe('string');
    expect(ast.name.value).toBe('{project}');
  });

  it('extracts the harbor node', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast.harbor?.value).toBe('{project}:fleet');
  });

  it('parses exactly 5 agents', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast.agents.size).toBe(5);
    expect([...ast.agents.keys()]).toEqual(
      expect.arrayContaining(['qa', 'documentarian', 'cartographer', 'spark', 'spider'])
    );
  });

  it('qa trigger points to git:committed', () => {
    const ast = parseFleetSource(SOURCE);
    const qa  = ast.agents.get('qa');
    expect(qa.trigger?.kind).toBe('channelRef');
    expect(qa.trigger?.channel).toBe('git:committed');
  });

  it('git:committed is marked declared after post-parse pass', () => {
    const ast = parseFleetSource(SOURCE);
    const qa  = ast.agents.get('qa');
    expect(qa.trigger?.declared).toBe(true);
  });

  it('spark has a cron schedule node', () => {
    const ast   = parseFleetSource(SOURCE);
    const spark = ast.agents.get('spark');
    expect(spark.schedule?.kind).toBe('cron');
    expect(spark.schedule?.expression).toBe('*/30 * * * *');
  });

  it('spider has both trigger and schedule', () => {
    const ast    = parseFleetSource(SOURCE);
    const spider = ast.agents.get('spider');
    expect(spider.trigger?.channel).toBe('spark:idea');
    expect(spider.schedule?.expression).toBe('0 */2 * * *');
  });

  it('qa onSuccess and onFailure are PublishActionNodes', () => {
    const ast = parseFleetSource(SOURCE);
    const qa  = ast.agents.get('qa');
    expect(qa.onSuccess?.kind).toBe('publishAction');
    expect(qa.onSuccess?.channel.channel).toBe('qa:clean');
    expect(qa.onFailure?.kind).toBe('publishAction');
    expect(qa.onFailure?.channel.channel).toBe('qa:findings');
  });

  it('qa:clean and qa:findings are marked declared', () => {
    const ast = parseFleetSource(SOURCE);
    const qa  = ast.agents.get('qa');
    expect(qa.onSuccess?.channel.declared).toBe(true);
    expect(qa.onFailure?.channel.declared).toBe(true);
  });

  it('parses channels map', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast.channels.size).toBeGreaterThan(3);
    expect(ast.channels.has('git:committed')).toBe(true);
    expect(ast.channels.has('qa:clean')).toBe(true);
    expect(ast.channels.has('qa:findings')).toBe(true);
  });

  it('git:committed channel has consumers list', () => {
    const ast = parseFleetSource(SOURCE);
    const ch  = ast.channels.get('git:committed');
    expect(ch.consumers?.map(c => c.value)).toEqual(
      expect.arrayContaining(['qa', 'documentarian', 'cartographer'])
    );
  });

  it('parses the notify-findings watcher', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast.watchers.has('notify-findings')).toBe(true);
    const w = ast.watchers.get('notify-findings');
    expect(w.trigger.channel).toBe('qa:findings');
    expect(w.trigger.declared).toBe(true);
  });

  // ── Range assertions ──────────────────────────────────────────────────────

  it('qa agent name node is on line 28', () => {
    const ast = parseFleetSource(SOURCE);
    const qa  = ast.agents.get('qa');
    // agents list: qa at line 28, col 5 (1-based, verified by node REPL)
    expect(qa.name.range.start.line).toBe(28);
    expect(qa.name.range.start.column).toBeGreaterThan(0);
  });

  it('qa trigger range offset resolves to the channel string in source', () => {
    const ast     = parseFleetSource(SOURCE);
    const trigger = ast.agents.get('qa').trigger;
    expect(trigger).toBeDefined();
    const { offset: start } = trigger.range.start;
    const { offset: end   } = trigger.range.end;
    expect(SOURCE.slice(start, end)).toContain('git:committed');
  });

  it('spark agent name node is on line 88', () => {
    const ast   = parseFleetSource(SOURCE);
    const spark = ast.agents.get('spark');
    expect(spark.name.range.start.line).toBe(88);
  });

  it('every agent node has a non-zero start line', () => {
    const ast = parseFleetSource(SOURCE);
    for (const [, agent] of ast.agents) {
      expect(agent.range.start.line).toBeGreaterThan(0);
    }
  });

  it('every channel node has a non-zero start line', () => {
    const ast = parseFleetSource(SOURCE);
    for (const [, ch] of ast.channels) {
      expect(ch.range.start.line).toBeGreaterThan(0);
    }
  });
});

// ─── astToConfig (round-trip equivalence) ─────────────────────────────────────

describe('astToConfig', () => {
  let ast;
  let config;

  beforeAll(() => {
    ast    = parseFleetSource(SOURCE);
    config = astToConfig(ast);
  });

  it('produces a FleetConfig with 5 agents', () => {
    expect(config.agents).toBeInstanceOf(Array);
    expect(config.agents.length).toBe(5);
  });

  it('fleet name comes through (raw template token)', () => {
    expect(config.name).toBe('{project}');
  });

  it('harbor comes through', () => {
    expect(config.harbor).toBe('{project}:fleet');
  });

  it('qa agent backend and model', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa).toBeDefined();
    expect(qa.backend).toBe('claude-cli');
    expect(qa.model).toBe('haiku');
  });

  it('qa trigger and on_success / on_failure serialized back to strings', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa.trigger).toBe('git:committed');
    expect(qa.onSuccess).toBe('publish qa:clean');
    expect(qa.onFailure).toBe('publish qa:findings');
  });

  it('qa singleton is false (not set)', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa.singleton).toBe(false);
  });

  it('qa respawn is true (set in template)', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa.respawn).toBe(true);
  });

  it('qa maxRespawns is 3 (explicit in template)', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa.maxRespawns).toBe(3);
  });

  it('documentarian maxRespawns defaults to 3', () => {
    const doc = config.agents.find(a => a.name === 'documentarian');
    expect(doc.maxRespawns).toBe(3);
  });

  it('spark singleton is true', () => {
    const spark = config.agents.find(a => a.name === 'spark');
    expect(spark.singleton).toBe(true);
  });

  it('spark schedule cron string preserved', () => {
    const spark = config.agents.find(a => a.name === 'spark');
    expect(spark.schedule).toBe('*/30 * * * *');
  });

  it('qa worktree is true (Bash in allowedTools)', () => {
    const qa = config.agents.find(a => a.name === 'qa');
    expect(qa.worktree).toBe(true);
  });

  it('documentarian worktree is true (Write in allowedTools)', () => {
    const doc = config.agents.find(a => a.name === 'documentarian');
    expect(doc.worktree).toBe(true);
  });

  it('channels map is populated', () => {
    expect(typeof config.channels).toBe('object');
    expect(config.channels['git:committed']).toBeDefined();
    expect(config.channels['git:committed'].description).toContain('git commit');
    expect(config.channels['git:committed'].consumers).toContain('qa');
  });

  it('watchers array has one entry', () => {
    expect(config.watchers).toBeInstanceOf(Array);
    expect(config.watchers.length).toBe(1);
    const w = config.watchers[0];
    expect(w.name).toBe('notify-findings');
    expect(w.trigger).toBe('qa:findings');
  });

  it('no limits on the starter template', () => {
    expect(config.limits).toBeUndefined();
  });

  it('keeps disabled declarations inspectable in the AST but out of runtime config', () => {
    const disabledSource = `
fleet:
  name: disabled-gate
  agents:
    dark:
      enabled: false
      schedule: "0 1 * * *"
      backend: custom
      prompt: "must never run"
    armed:
      enabled: true
      trigger: git:committed
      backend: claude-cli
      prompt: "review"
`;
    const disabledAst = parseFleetSource(disabledSource);

    expect(disabledAst.agents.get('dark').enabled?.value).toBe(false);
    expect(disabledAst.agents.get('armed').enabled?.value).toBe(true);
    expect(astToConfig(disabledAst).agents.map(agent => agent.name)).toEqual(['armed']);
  });

  it('fails closed when an enabled declaration is present but not boolean', () => {
    const malformedAst = parseFleetSource(`
fleet:
  name: malformed-gate
  agents:
    dark:
      enabled: "false"
      schedule: "0 1 * * *"
      backend: custom
      prompt: "must never run"
`);

    expect(malformedAst.agents.get('dark').enabled?.value).toBe(false);
    expect(astToConfig(malformedAst).agents).toEqual([]);
  });
});
