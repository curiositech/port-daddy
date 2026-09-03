import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { installPilotAgents, loadPilotSource, pilotRenderTargets, uninstallPilotAgents } from '../../lib/pilot-agent-render.js';
import { createPilotTargetExecutor, pilotTargetExecutor } from '../../lib/pilot-agent-targets.js';

describe('Pilot target ownership, using only owned filesystem fixtures', () => {
  let root: string;
  let sourceDir: string;
  let baseDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(homedir(), 'coding', 'tmp', 'pd-pilot-target-test-'));
    sourceDir = join(root, 'source');
    baseDir = join(root, 'targets');
    mkdirSync(sourceDir);
    mkdirSync(baseDir);
    writeFileSync(join(sourceDir, 'agent.config.json'), JSON.stringify({
      id: 'port-daddy-pilot', name: 'Fixture Pilot', description: 'Synthetic source only', tools: {},
    }));
    writeFileSync(join(sourceDir, 'AGENT.md'), '# Fixture Pilot\n\n--- BEGIN SYSTEM PROMPT ---\nCoordinate synthetic work.\n--- END SYSTEM PROMPT ---\n');
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function input() {
    const { config, system, provenance } = loadPilotSource(sourceDir);
    return { baseDir, id: config.id, source: provenance, targets: pilotRenderTargets(baseDir, config, system) };
  }

  it('creates five verified outputs and makes a second apply unchanged', () => {
    const first = installPilotAgents({ sourceDir, baseDir });
    expect(first.errors).toEqual([]);
    expect(first.outcome).toBe('complete');
    expect(first.written).toHaveLength(5);
    const second = installPilotAgents({ sourceDir, baseDir });
    expect(second.errors).toEqual([]);
    expect(second.outcome).toBe('unchanged');
    expect(second.written.every(w => !w.changed)).toBe(true);
  });

  it('updates only its prior generated outputs and preserves their modes', () => {
    const first = installPilotAgents({ sourceDir, baseDir });
    expect(first.outcome).toBe('complete');
    fs.chmodSync(first.written[0].path, 0o640);
    writeFileSync(join(sourceDir, 'AGENT.md'), '--- BEGIN SYSTEM PROMPT ---\nNew fixture prompt.\n--- END SYSTEM PROMPT ---\n');
    const next = installPilotAgents({ sourceDir, baseDir });
    expect(next.errors).toEqual([]);
    expect(next.outcome).toBe('complete');
    expect(readFileSync(next.written[0].path, 'utf8')).toContain('New fixture prompt.');
    expect(lstatSync(next.written[0].path).mode & 0o777).toBe(0o640);
  });

  it('uninstalls verified outputs through the same receipt boundary', () => {
    const first = installPilotAgents({ sourceDir, baseDir });
    expect(first.outcome).toBe('complete');
    const removed = uninstallPilotAgents({ sourceDir, baseDir });
    expect(removed.errors).toEqual([]);
    expect(removed.outcome).toBe('complete');
    expect(first.written.every(w => !existsSync(w.path))).toBe(true);
  });

  it('preview writes no state or target directories', () => {
    const result = installPilotAgents({ sourceDir, baseDir, dryRun: true });
    expect(result.errors).toEqual([]);
    expect(result.outcome).toBe('preview');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  it('rejects an exact preview after a target appears, before any installer write', () => {
    const plan = pilotTargetExecutor.preview(input());
    const target = plan.entries[0];
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(baseDir, target.path), 'A later user edit');
    const result = pilotTargetExecutor.apply(plan, plan.digest);
    expect(result.outcome).toBe('blocked');
    expect(existsSync(join(baseDir, '.port-daddy'))).toBe(false);
    expect(readFileSync(join(baseDir, target.path), 'utf8')).toBe('A later user edit');
  });

  it('rolls back one completed write after a later real I/O failure, then recovers idempotently', () => {
    let links = 0;
    const faulty = createPilotTargetExecutor({ ...fs, linkSync: ((...args: Parameters<typeof fs.linkSync>) => {
      if (++links === 2) throw Object.assign(new Error('fixture second publish'), { code: 'EIO' });
      return fs.linkSync(...args);
    }) } as typeof fs);
    const request = input();
    const plan = faulty.preview(request);
    const stopped = faulty.apply(plan, plan.digest);
    expect(stopped.outcome).toBe('partial');
    expect(stopped.written).toHaveLength(1);
    expect(stopped.recovery).toBeDefined();
    const recovered = pilotTargetExecutor.recover(baseDir, request.id, stopped.recovery!.runId, request.source);
    expect(recovered.errors).toEqual([]);
    expect(recovered.outcome).toBe('recovered');
    expect(request.targets.every(t => !existsSync(t.path))).toBe(true);
    const again = pilotTargetExecutor.recover(baseDir, request.id, stopped.recovery!.runId, request.source);
    expect(again.outcome).toBe('recovered');
    expect(again.written).toEqual([]);
  });

  it('preserves later user edits and the journal instead of forcing recovery', () => {
    let links = 0;
    const faulty = createPilotTargetExecutor({ ...fs, linkSync: ((...args: Parameters<typeof fs.linkSync>) => {
      if (++links === 2) throw Object.assign(new Error('fixture second publish'), { code: 'EIO' });
      return fs.linkSync(...args);
    }) } as typeof fs);
    const request = input();
    const plan = faulty.preview(request);
    const stopped = faulty.apply(plan, plan.digest);
    writeFileSync(request.targets[0].path, 'User edit after interruption');
    const recovered = pilotTargetExecutor.recover(baseDir, request.id, stopped.recovery!.runId, request.source);
    expect(recovered.outcome).toBe('partial');
    expect(readFileSync(request.targets[0].path, 'utf8')).toBe('User edit after interruption');
    expect(existsSync(join(stopped.recovery!.directory, 'journal.json'))).toBe(true);
  });

  it('cleans a verified prior-layout output only after the replacement is readable', () => {
    const previous = input();
    const oldPath = join(baseDir, '.codex', 'agents', 'port-daddy-pilot.md');
    previous.targets[1] = { ...previous.targets[1], path: oldPath, cleanup: [] };
    const oldPlan = pilotTargetExecutor.preview(previous);
    expect(pilotTargetExecutor.apply(oldPlan, oldPlan.digest).outcome).toBe('complete');
    const current = input();
    let removed = false;
    const watched = createPilotTargetExecutor({ ...fs, unlinkSync: ((path: fs.PathLike) => {
      if (String(path) === oldPath) {
        expect(readFileSync(current.targets[1].path, 'utf8')).toBe(current.targets[1].content);
        removed = true;
      }
      return fs.unlinkSync(path);
    }) } as typeof fs);
    const plan = watched.preview(current);
    const result = watched.apply(plan, plan.digest);
    expect(result.errors).toEqual([]);
    expect(removed).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
  });

  it('leaves a verified predecessor intact when replacement publication fails', () => {
    const previous = input();
    const oldPath = join(baseDir, '.codex', 'agents', 'port-daddy-pilot.md');
    previous.targets[1] = { ...previous.targets[1], path: oldPath, cleanup: [] };
    const oldPlan = pilotTargetExecutor.preview(previous);
    expect(pilotTargetExecutor.apply(oldPlan, oldPlan.digest).outcome).toBe('complete');
    const faulty = createPilotTargetExecutor({ ...fs, linkSync: (() => {
      throw Object.assign(new Error('fixture publication failure'), { code: 'EIO' });
    }) } as typeof fs);
    const plan = faulty.preview(input());
    const result = faulty.apply(plan, plan.digest);
    expect(result.outcome).toBe('partial');
    expect(readFileSync(oldPath, 'utf8')).toBe(previous.targets[1].content);
  });

  it.each(['bad-json', 'wrong-receipt-hash', 'missing-journal', 'wrong-owner-output'])('preserves targets with %s evidence', kind => {
    expect(installPilotAgents({ sourceDir, baseDir }).outcome).toBe('complete');
    const state = join(baseDir, '.port-daddy', 'pilot-installations', 'port-daddy-pilot');
    const pointerPath = join(state, 'current.json');
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    if (kind === 'bad-json') writeFileSync(pointerPath, '{broken');
    if (kind === 'wrong-receipt-hash') {
      pointer.sha256 = 'f'.repeat(64);
      writeFileSync(pointerPath, JSON.stringify(pointer));
    }
    if (kind === 'missing-journal') rmSync(join(state, 'runs', pointer.run, 'journal.json'));
    if (kind === 'wrong-owner-output') {
      const journalPath = join(state, 'runs', pointer.run, 'journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.plan.entries[0].content = 'forged-shaped output';
      writeFileSync(journalPath, JSON.stringify(journal));
    }
    const before = input().targets.map(t => readFileSync(t.path, 'utf8'));
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(result.outcome).toBe('blocked');
    expect(input().targets.map(t => readFileSync(t.path, 'utf8'))).toEqual(before);
  });

  it('refuses a receipt-directory symlink without reading or writing its destination', () => {
    const outside = join(root, 'unrelated');
    mkdirSync(outside);
    mkdirSync(join(baseDir, '.port-daddy'), { recursive: true });
    symlinkSync(outside, join(baseDir, '.port-daddy', 'pilot-installations'));
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(result.outcome).toBe('blocked');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses redirected target parents before receipt or output creation', () => {
    const outside = join(root, 'unrelated');
    mkdirSync(outside);
    symlinkSync(outside, join(baseDir, '.claude'));
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(result.outcome).toBe('blocked');
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(existsSync(join(baseDir, '.port-daddy'))).toBe(false);
  });

  it('rejects colliding current and stale paths before writes', () => {
    const request = input();
    request.targets[0].cleanup = [request.targets[0].path];
    expect(() => pilotTargetExecutor.preview(request)).toThrow('CONFLICTING_TARGET_PATH');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  it('rejects an altered preview digest without creating state', () => {
    const plan = pilotTargetExecutor.preview(input());
    plan.entries[0].content = 'altered after preview';
    expect(pilotTargetExecutor.apply(plan, plan.digest).outcome).toBe('blocked');
    expect(fs.readdirSync(baseDir)).toEqual([]);
  });

  it('does not admit a second installer while an interrupted run owns the lock', () => {
    const faulty = createPilotTargetExecutor({ ...fs, linkSync: (() => {
      throw Object.assign(new Error('fixture'), { code: 'EIO' });
    }) } as typeof fs);
    const plan = faulty.preview(input());
    const partial = faulty.apply(plan, plan.digest);
    expect(partial.outcome).toBe('partial');
    const active = join(baseDir, '.port-daddy', 'pilot-installations', 'port-daddy-pilot', 'active.json');
    const original = readFileSync(active, 'utf8');
    const second = installPilotAgents({ sourceDir, baseDir });
    expect(second.outcome).toBe('blocked');
    expect(second.errors.some(e => e.code === 'INSTALLATION_PENDING')).toBe(true);
    expect(readFileSync(active, 'utf8')).toBe(original);
  });

  it('can recover a create interrupted between no-clobber link and staged unlink', () => {
    let failed = false;
    const faulty = createPilotTargetExecutor({ ...fs, unlinkSync: ((path: fs.PathLike) => {
      if (!failed && String(path).includes('/.pd-pilot-')) {
        failed = true;
        throw Object.assign(new Error('fixture staged unlink'), { code: 'EIO' });
      }
      return fs.unlinkSync(path);
    }) } as typeof fs);
    const request = input();
    const plan = faulty.preview(request);
    const partial = faulty.apply(plan, plan.digest);
    expect(partial.outcome).toBe('partial');
    const result = pilotTargetExecutor.recover(baseDir, request.id, partial.recovery!.runId, request.source);
    expect(result.errors).toEqual([]);
    expect(result.outcome).toBe('recovered');
    expect(request.targets.every(t => !existsSync(t.path))).toBe(true);
  });

  it('preserves a custom target containing the Pilot ID', () => {
    const path = join(baseDir, '.claude', 'agents', 'port-daddy-pilot.md');
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    const custom = '# My instructions\nI sometimes use port-daddy-pilot.\n';
    writeFileSync(path, custom);
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(readFileSync(path, 'utf8')).toBe(custom);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('does not adopt an unmanaged file merely because new output is identical', () => {
    const { config, system } = loadPilotSource(sourceDir);
    const target = pilotRenderTargets(baseDir, config, system)[0];
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    writeFileSync(target.path, target.content);
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(readFileSync(target.path, 'utf8')).toBe(target.content);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('preserves a stale custom file containing the Pilot ID', () => {
    const stale = join(baseDir, '.codex', 'agents', 'port-daddy-pilot.md');
    mkdirSync(join(baseDir, '.codex', 'agents'), { recursive: true });
    const custom = 'My port-daddy-pilot notes; this is not generated output.';
    writeFileSync(stale, custom);
    installPilotAgents({ sourceDir, baseDir });
    expect(existsSync(stale)).toBe(true);
    expect(readFileSync(stale, 'utf8')).toBe(custom);
  });

  it('uninstall preserves a foreign target without a prior installation receipt', () => {
    const path = join(baseDir, '.claude', 'agents', 'port-daddy-pilot.md');
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    writeFileSync(path, 'My custom agent');
    uninstallPilotAgents({ sourceDir, baseDir });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('My custom agent');
  });

  it('preserves a broken target symlink rather than treating it as absence', () => {
    const path = join(baseDir, '.claude', 'agents', 'port-daddy-pilot.md');
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    symlinkSync(join(root, 'missing-user-file'), path);
    const result = installPilotAgents({ sourceDir, baseDir });
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
