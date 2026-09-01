import { describe, expect, test, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  extractSystemPrompt,
  claudeToolList,
  renderClaude,
  renderCodexToml,
  renderGeminiCommandToml,
  installPilotAgents,
  pilotRenderTargets,
  type PilotConfig,
} from '../../lib/pilot-agent-render.ts';
import { installPilotSessionStartHook } from '../../lib/pilot-sessionstart-hook.ts';
import { sourceShaForPayload, stableJsonStringify } from '../../scripts/create-managed-agent.ts';

const SAMPLE_CONFIG: PilotConfig = {
  id: 'port-daddy-pilot',
  name: 'Port Daddy Pilot',
  description: 'The ideal Port Daddy agent: coordinates before it cuts.',
  color: 'green',
  model: { claude_local: 'opus' },
  skills: ['port-daddy-agent-skill'],
  tools: {
    portDaddyMcp: ['begin_session', 'coordination_preflight'],
    editorLocal: ['Read', 'Edit', 'Bash'],
  },
};

const SAMPLE_AGENT_MD = [
  '<!-- header doc that mentions the --- BEGIN SYSTEM PROMPT --- marker inline -->',
  '# Port Daddy Pilot',
  'docs go here',
  '',
  '--- BEGIN SYSTEM PROMPT ---',
  '',
  'You are **Port Daddy Pilot**. Coordinate before you cut.',
  'Leave durable notes.',
  '',
  '--- END SYSTEM PROMPT ---',
  '',
  'trailing docs',
].join('\n');

const tmpDirs: string[] = [];
function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'pilot-test-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('extractSystemPrompt', () => {
  test('extracts the text between line-delimited markers', () => {
    const out = extractSystemPrompt(SAMPLE_AGENT_MD);
    expect(out).toBe('You are **Port Daddy Pilot**. Coordinate before you cut.\nLeave durable notes.');
  });

  test('ignores an inline mention of the marker in the header', () => {
    const out = extractSystemPrompt(SAMPLE_AGENT_MD);
    // The header's inline "--- BEGIN SYSTEM PROMPT ---" must not become the cut point.
    expect(out).not.toContain('header doc');
    expect(out).not.toContain('docs go here');
  });

  test('throws when markers are absent', () => {
    expect(() => extractSystemPrompt('no markers here')).toThrow(/BEGIN\/END SYSTEM PROMPT/);
  });
});

describe('claudeToolList', () => {
  test('prefixes MCP tools and passes editor tools through', () => {
    expect(claudeToolList(SAMPLE_CONFIG)).toEqual([
      'mcp__port-daddy__begin_session',
      'mcp__port-daddy__coordination_preflight',
      'Read',
      'Edit',
      'Bash',
    ]);
  });
});

describe('renderClaude', () => {
  test('emits valid frontmatter with name, description, tools, model, color, then the body', () => {
    const md = renderClaude(SAMPLE_CONFIG, 'BODY-PROMPT');
    expect(md).toBe([
      '---',
      'name: port-daddy-pilot',
      'description: "The ideal Port Daddy agent: coordinates before it cuts."',
      'tools: mcp__port-daddy__begin_session, mcp__port-daddy__coordination_preflight, Read, Edit, Bash',
      'model: opus',
      'color: green',
      '---',
      '',
      'BODY-PROMPT',
      '',
    ].join('\n'));
  });
});

describe('renderCodexToml', () => {
  test('uses name/description/developer_instructions with a literal block', () => {
    const toml = renderCodexToml(SAMPLE_CONFIG, "It's a body with an apostrophe.");
    expect(toml).toContain('name = "port-daddy-pilot"');
    expect(toml).toContain('developer_instructions = \'\'\'');
    expect(toml).toContain("It's a body with an apostrophe.");
  });
});

describe('renderGeminiCommandToml', () => {
  test('wraps the prompt with an adopt-persona preamble', () => {
    const toml = renderGeminiCommandToml(SAMPLE_CONFIG, 'BODY');
    expect(toml).toContain('description = ');
    expect(toml).toContain('Adopt the following operating persona');
    expect(toml).toContain('BODY');
  });
});

describe('installPilotAgents', () => {
  function seedSource(): string {
    const src = makeTmp();
    writeFileSync(join(src, 'agent.config.json'), JSON.stringify(SAMPLE_CONFIG));
    writeFileSync(join(src, 'AGENT.md'), SAMPLE_AGENT_MD);
    return src;
  }

  test('writes every runtime definition under the base dir', () => {
    const src = seedSource();
    const base = makeTmp();
    const result = installPilotAgents({ sourceDir: src, baseDir: base });
    expect(result.errors).toEqual([]);
    expect(result.written).toHaveLength(5);
    expect(result.written.map((w) => w.runtime)).toEqual([
      'Claude Code',
      'Codex CLI',
      'Gemini CLI',
      'Gemini extension (Antigravity)',
      'Generic agents',
    ]);
    expect(pilotRenderTargets(base, SAMPLE_CONFIG, 'x').map((target) => target.path).filter(existsSync))
      .toHaveLength(5);
    expect(readFileSync(join(base, '.claude', 'agents', 'port-daddy-pilot.md'), 'utf8'))
      .toContain('You are **Port Daddy Pilot**');
  });

  test('is idempotent: a second install reports no changes', () => {
    const src = seedSource();
    const base = makeTmp();
    installPilotAgents({ sourceDir: src, baseDir: base });
    const targets = pilotRenderTargets(base, SAMPLE_CONFIG, extractSystemPrompt(SAMPLE_AGENT_MD));
    const contentsAfterFirstInstall = targets.map((target) => [
      target.runtime,
      target.path,
      readFileSync(target.path, 'utf8'),
    ]);

    const second = installPilotAgents({ sourceDir: src, baseDir: base });

    expect(second.written.map((w) => [w.runtime, w.changed])).toEqual([
      ['Claude Code', false],
      ['Codex CLI', false],
      ['Gemini CLI', false],
      ['Gemini extension (Antigravity)', false],
      ['Generic agents', false],
    ]);
    expect(targets.map((target) => [
      target.runtime,
      target.path,
      readFileSync(target.path, 'utf8'),
    ])).toEqual(contentsAfterFirstInstall);
  });

  test('refuses to clobber a foreign file at the target path', () => {
    const src = seedSource();
    const base = makeTmp();
    const claudePath = join(base, '.claude', 'agents', 'port-daddy-pilot.md');
    const foreignContent = 'hand-written file with no pilot id';
    mkdirSync(join(base, '.claude', 'agents'), { recursive: true });
    writeFileSync(claudePath, foreignContent);
    const result = installPilotAgents({ sourceDir: src, baseDir: base });
    expect(result.errors).toContainEqual({
      runtime: 'Claude Code',
      path: claudePath,
      error: 'exists and is not a Port Daddy Pilot file — skipping',
    });
    expect(result.written.map((w) => w.runtime)).not.toContain('Claude Code');
    expect(readFileSync(claudePath, 'utf8')).toBe(foreignContent);
  });

  test('reports a missing source directory as an install error', () => {
    const result = installPilotAgents({ sourceDir: join(makeTmp(), 'missing'), baseDir: makeTmp() });
    expect(result.written).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ runtime: 'source', error: expect.stringContaining('agent.config.json') }),
    ]);
  });

  test('removes stale generated copies without deleting foreign files', () => {
    const src = seedSource();
    const base = makeTmp();
    const staleGenerated = join(base, '.codex', 'agents', 'port-daddy-pilot.md');
    const staleForeign = join(base, '.agents', 'port-daddy-pilot.md');
    mkdirSync(join(base, '.codex', 'agents'), { recursive: true });
    mkdirSync(join(base, '.agents'), { recursive: true });
    writeFileSync(staleGenerated, 'old generated port-daddy-pilot markdown');
    writeFileSync(staleForeign, 'hand-written universal agent');

    const result = installPilotAgents({ sourceDir: src, baseDir: base });

    expect(result.cleaned).toContainEqual({
      runtime: 'Codex CLI',
      path: staleGenerated,
      changed: true,
    });
    expect(result.cleaned).toContainEqual({
      runtime: 'Generic agents',
      path: staleForeign,
      changed: false,
    });
    expect(existsSync(staleGenerated)).toBe(false);
    expect(readFileSync(staleForeign, 'utf8')).toBe('hand-written universal agent');
  });
});

describe('installPilotSessionStartHook', () => {
  test('registers the hook and preserves existing SessionStart entries', () => {
    const projectDir = makeTmp();
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'pd attention --json' }] }] } }),
    );
    const r = installPilotSessionStartHook({ projectDir, projectRoot: process.cwd() });
    expect(r).toEqual(expect.objectContaining({ changed: true, reason: 'registered new hook', ok: true }));
    const settings = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8'));
    const commands = settings.hooks.SessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toContain('pd attention --json'); // preserved
    expect(commands.filter((c: string) => c.includes('sessionstart-pilot.mjs'))).toHaveLength(1);
  });

  test('is idempotent and stays ok', () => {
    const projectDir = makeTmp();
    installPilotSessionStartHook({ projectDir, projectRoot: process.cwd() });
    const second = installPilotSessionStartHook({ projectDir, projectRoot: process.cwd() });
    expect(second.changed).toBe(false);
    expect(second.ok).toBe(true);
  });

  test('reports invalid Claude settings without overwriting them, and flags ok:false', () => {
    const projectDir = makeTmp();
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{not json');

    const result = installPilotSessionStartHook({ projectDir, projectRoot: process.cwd() });

    expect(result).toEqual(expect.objectContaining({
      changed: false,
      reason: 'existing settings.json is not valid JSON — skipping',
      ok: false,
    }));
    expect(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8')).toBe('{not json');
  });

});

describe('managed-agent payload hashing', () => {
  test('uses deterministic object key ordering for the source hash', () => {
    const a = { name: 'Pilot', tools: [{ z: 1, a: 2 }], model: { id: 'opus', speed: 'standard' } };
    const b = { model: { speed: 'standard', id: 'opus' }, tools: [{ a: 2, z: 1 }], name: 'Pilot' };

    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
    expect(sourceShaForPayload(a)).toBe(sourceShaForPayload(b));
    expect(sourceShaForPayload(a)).toHaveLength(64);
  });
});

describe('sessionstart-pilot.mjs hook script', () => {
  const script = join(process.cwd(), 'hooks', 'sessionstart-pilot.mjs');

  function run(payload: object, env: Record<string, string> = {}): string {
    try {
      return execFileSync('node', [script], {
        input: JSON.stringify(payload),
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
    } catch {
      return '';
    }
  }

  test('emits SessionStart steering in a Port Daddy-active repo', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    const out = JSON.parse(run({ cwd: dir }));
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(out.hookSpecificOutput.additionalContext).toContain('Port Daddy Pilot');
  });

  test('stays silent outside a Port Daddy repo', () => {
    const dir = makeTmp();
    expect(run({ cwd: dir })).toBe('');
  });

  test('stays silent when a non-default agent is selected', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    expect(run({ cwd: dir, agent: 'debugger' })).toBe('');
  });

  test('stays silent when disabled via PD_PILOT_DISABLE', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    expect(run({ cwd: dir }, { PD_PILOT_DISABLE: '1' })).toBe('');
  });

  // ── SITREP duty at session birth (operator doctrine 2026-08-22) ──
  // SessionStart teaches the same per-repo sitrep.endOfTurn dial the per-turn
  // pd-hook-prompt tentacle enforces: default enforce, opt-out per repo.

  test('teaches the end-of-turn SITREP duty by default (dial enforce)', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    const out = JSON.parse(run({ cwd: dir }));
    const ctx = out.hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain('Port Daddy Pilot'); // base steering still present
    expect(ctx).toContain('SITREP (end-of-turn, per-repo dial)');
    expect(ctx).toContain('pd sitrep --template');
    expect(ctx).toContain('pd roadmap upsert');
  });

  test('omits the SITREP duty when the repo dials endOfTurn off', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(dir, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const out = JSON.parse(run({ cwd: dir }));
    const ctx = out.hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain('Port Daddy Pilot');
    expect(ctx).not.toContain('SITREP (end-of-turn');
  });

  test('PD_SITREP env override wins over the repo dial at session start', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(dir, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );
    const silenced = JSON.parse(run({ cwd: dir }, { PD_SITREP: 'off' }));
    expect(silenced.hookSpecificOutput.additionalContext).not.toContain('SITREP (end-of-turn');

    writeFileSync(
      join(dir, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const compelled = JSON.parse(run({ cwd: dir }, { PD_SITREP: 'suggest' }));
    expect(compelled.hookSpecificOutput.additionalContext).toContain('SITREP (end-of-turn');
  });

  test('malformed agent.config.json fails toward the default duty (enforce), never silence', () => {
    // Fail-direction proof at the birth surface: a config the hook cannot
    // parse must not be treated as an opt-out — the duty still ships.
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(join(dir, 'agent.config.json'), '{not valid json — deliberately malformed');
    const out = JSON.parse(run({ cwd: dir }));
    expect(out.hookSpecificOutput.additionalContext).toContain('SITREP (end-of-turn, per-repo dial)');
  });

  test('conflicting nested configs: the nearest directory wins at session start', () => {
    // Nearest-wins contract, mirrored from the prompt tentacle: the walk
    // exhausts all three candidate files per directory before ascending, so a
    // child repo's opt-out in a lower-ranked file beats the ancestor's
    // enforce in the highest-ranked file — and the ancestor keeps its own.
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(dir, 'agent.config.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'enforce' } }),
    );
    const child = join(dir, 'pkg');
    mkdirSync(join(child, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(child, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );

    const fromChild = JSON.parse(run({ cwd: child }));
    expect(fromChild.hookSpecificOutput.additionalContext).not.toContain('SITREP (end-of-turn');

    const fromParent = JSON.parse(run({ cwd: dir }));
    expect(fromParent.hookSpecificOutput.additionalContext).toContain('SITREP (end-of-turn, per-repo dial)');
  });

  test('.portdaddy/sitrep.json governs the SessionStart duty like the prompt tentacle', () => {
    const dir = makeTmp();
    mkdirSync(join(dir, '.portdaddy'), { recursive: true });
    writeFileSync(
      join(dir, '.portdaddy', 'sitrep.json'),
      JSON.stringify({ sitrep: { endOfTurn: 'off' } }),
    );
    const out = JSON.parse(run({ cwd: dir }));
    expect(out.hookSpecificOutput.additionalContext).not.toContain('SITREP (end-of-turn');
  });
});
