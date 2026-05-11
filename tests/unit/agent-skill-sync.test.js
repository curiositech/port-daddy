import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  collectSkillUnion,
  ensureGeminiPortDaddyExtension,
  runtimeSkillTargets,
  syncAgentSkills,
} = await import('../../cli/utils/skill-sync.js');

let tmpRoot;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `pd-skill-sync-${process.pid}-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSkill(root, rel, name, description = 'test skill') {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
  return dir;
}

describe('cross-tool agent skill sync', () => {
  test('collectSkillUnion resolves duplicate ids by source order and candidate quality', () => {
    const windags = join(tmpRoot, 'windags');
    const workgroup = join(tmpRoot, 'workgroup');
    writeSkill(windags, 'alpha', 'alpha', 'from windags');
    writeSkill(workgroup, 'alpha', 'alpha', 'from workgroup');
    writeSkill(workgroup, 'skill-architect/output', 'skill-architect', 'generated output');
    const canonicalSkillArchitect = writeSkill(workgroup, 'skill-architect/skill-architect', 'skill-architect', 'canonical nested copy');

    const union = collectSkillUnion([
      { label: 'windags', path: windags },
      { label: 'workgroup', path: workgroup },
    ]);

    const alpha = union.skills.find((skill) => skill.id === 'alpha');
    const skillArchitect = union.skills.find((skill) => skill.id === 'skill-architect');

    expect(alpha.sourceLabel).toBe('windags');
    expect(skillArchitect.path).toBe(canonicalSkillArchitect);
    expect(union.collisions.some((collision) => collision.id === 'alpha')).toBe(true);
    expect(union.collisions.some((collision) => collision.id === 'skill-architect')).toBe(true);
  });

  test('collectSkillUnion keeps Port Daddy first-party skills from the Port Daddy source', () => {
    const workgroup = join(tmpRoot, 'workgroup');
    const portDaddy = join(tmpRoot, 'port-daddy');
    writeSkill(workgroup, 'port-daddy-agent-skill', 'port-daddy-agent-skill', 'workgroup mirror');
    const canonical = writeSkill(portDaddy, 'port-daddy-agent-skill', 'port-daddy-agent-skill', 'port daddy source');

    const union = collectSkillUnion([
      { label: 'workgroup', path: workgroup },
      { label: 'port-daddy', path: portDaddy },
    ]);

    expect(union.skills.find((skill) => skill.id === 'port-daddy-agent-skill').path).toBe(canonical);
  });

  test('collectSkillUnion keeps Port Daddy first-party skills from canonical explicit roots', () => {
    const mirrorRoot = join(tmpRoot, 'workgroup-ai', 'skills');
    const portDaddyRoot = join(tmpRoot, 'port-daddy', 'skills');
    writeSkill(mirrorRoot, 'port-daddy-agent-skill', 'port-daddy-agent-skill', 'workgroup mirror');
    const canonical = writeSkill(portDaddyRoot, 'port-daddy-agent-skill', 'port-daddy-agent-skill', 'port daddy source');

    const union = collectSkillUnion([
      { label: 'env:1', path: mirrorRoot },
      { label: 'env:2', path: portDaddyRoot },
    ]);

    expect(union.skills.find((skill) => skill.id === 'port-daddy-agent-skill').path).toBe(canonical);
  });

  test('syncAgentSkills links discovered skills into Codex and Gemini-style targets', () => {
    const source = join(tmpRoot, 'source');
    const home = join(tmpRoot, 'home');
    const alphaDir = writeSkill(source, 'alpha', 'alpha');
    writeSkill(source, 'beta', 'beta');

    const result = syncAgentSkills({
      baseDir: home,
      projectRoot: tmpRoot,
      scope: 'user',
      sourceRoots: [{ label: 'source', path: source }],
      targets: [
        { label: 'Codex', path: join(home, '.codex', 'skills') },
        { label: 'Gemini', path: join(home, '.gemini', 'skills') },
      ],
    });

    expect(result.skillCount).toBe(2);
    expect(result.created).toBe(4);
    expect(lstatSync(join(home, '.codex', 'skills', 'alpha')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, '.codex', 'skills', 'alpha'))).toBe(alphaDir);
    expect(existsSync(join(home, '.gemini', 'skills', 'beta', 'SKILL.md'))).toBe(true);
  });

  test('syncAgentSkills skips existing non-symlink skill directories instead of overwriting local edits', () => {
    const source = join(tmpRoot, 'source');
    const home = join(tmpRoot, 'home');
    writeSkill(source, 'alpha', 'alpha');
    const localAlpha = join(home, '.claude', 'skills', 'alpha');
    mkdirSync(localAlpha, { recursive: true });
    writeFileSync(join(localAlpha, 'SKILL.md'), 'local copy\n');

    const result = syncAgentSkills({
      baseDir: home,
      projectRoot: tmpRoot,
      scope: 'user',
      sourceRoots: [{ label: 'source', path: source }],
      targets: [{ label: 'Claude', path: join(home, '.claude', 'skills') }],
    });

    expect(result.created).toBe(0);
    expect(result.skippedExisting).toHaveLength(1);
    expect(readFileSync(join(localAlpha, 'SKILL.md'), 'utf8')).toBe('local copy\n');
  });

  test('runtimeSkillTargets includes Codex, Claude, Gemini, and AGENTS-aware targets', () => {
    const targets = runtimeSkillTargets('/Users/example', 'user');
    const labels = targets.map((target) => target.label);

    expect(labels).toEqual(expect.arrayContaining([
      'AGENTS universal',
      'Codex',
      'Claude',
      'Gemini skills',
      'Gemini Port Daddy extension',
      'Cursor',
      'Continue',
      'Windsurf',
      'Cline',
    ]));
  });

  test('ensureGeminiPortDaddyExtension writes extension metadata from the repo copy', () => {
    const projectRoot = join(tmpRoot, 'project');
    const home = join(tmpRoot, 'home');
    const extensionSrc = join(projectRoot, '.gemini', 'extensions', 'port-daddy');
    mkdirSync(extensionSrc, { recursive: true });
    writeFileSync(join(extensionSrc, 'gemini-extension.json'), '{"name":"port-daddy"}\n');
    writeFileSync(join(extensionSrc, 'GEMINI.md'), '# Port Daddy\n');
    writeFileSync(join(extensionSrc, 'mcp.json'), '{"mcpServers":{}}\n');

    const result = ensureGeminiPortDaddyExtension(home, projectRoot);

    expect(result.errors).toHaveLength(0);
    expect(result.written).toHaveLength(3);
    expect(readFileSync(join(home, '.gemini', 'extensions', 'port-daddy', 'GEMINI.md'), 'utf8')).toBe('# Port Daddy\n');
  });
});
