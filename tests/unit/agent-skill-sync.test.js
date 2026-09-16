import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const {
  collectSkillUnion,
  defaultSkillCatalogRoots,
  ensureGeminiPortDaddyExtension,
  findUnclaimedSkillLinks,
  runtimeSkillTargets,
  syncAgentSkills,
} = await import('../../lib/skill-sync.js');

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
  test('default catalog uses local and explicit roots without Jury-rig runtime discovery', () => {
    const projectRoot = join(tmpRoot, 'project');
    const home = join(tmpRoot, 'home');
    const explicit = join(tmpRoot, 'explicit-skills');
    mkdirSync(join(projectRoot, 'skills'), { recursive: true });
    mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
    mkdirSync(explicit, { recursive: true });

    const previous = process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
    process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = explicit;
    try {
      const roots = defaultSkillCatalogRoots(projectRoot, home);
      expect(roots.map((root) => root.label)).toEqual(expect.arrayContaining(['env:1', 'port-daddy', 'user-agents']));
      expect(roots.some((root) => /jury_rig|workgroup-ai/i.test(`${root.label}:${root.path}`))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
      else process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = previous;
    }
  });

  test('default catalog skips empty, missing, and non-directory explicit roots', () => {
    const projectRoot = join(tmpRoot, 'project');
    const home = join(tmpRoot, 'home');
    const valid = join(tmpRoot, 'valid-skills');
    const missing = join(tmpRoot, 'missing-skills');
    const file = join(tmpRoot, 'not-a-directory');
    mkdirSync(valid, { recursive: true });
    writeFileSync(file, 'not a skill root');

    const previous = process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
    process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = `:${missing}:${file}:${valid}:`;
    try {
      const roots = defaultSkillCatalogRoots(projectRoot, home);
      expect(roots.filter((root) => root.label.startsWith('env:'))).toEqual([
        { label: 'env:4', path: valid },
      ]);
    } finally {
      if (previous === undefined) delete process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
      else process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = previous;
    }
  });

  test('collectSkillUnion resolves duplicate ids by source order and candidate quality', () => {
    const jury_rig = join(tmpRoot, 'jury_rig');
    const workgroup = join(tmpRoot, 'workgroup');
    writeSkill(jury_rig, 'alpha', 'alpha', 'from jury_rig');
    writeSkill(workgroup, 'alpha', 'alpha', 'from workgroup');
    writeSkill(workgroup, 'skill-architect/output', 'skill-architect', 'generated output');
    const canonicalSkillArchitect = writeSkill(workgroup, 'skill-architect/skill-architect', 'skill-architect', 'canonical nested copy');

    const union = collectSkillUnion([
      { label: 'jury_rig', path: jury_rig },
      { label: 'workgroup', path: workgroup },
    ]);

    const alpha = union.skills.find((skill) => skill.id === 'alpha');
    const skillArchitect = union.skills.find((skill) => skill.id === 'skill-architect');

    expect(alpha.sourceLabel).toBe('jury_rig');
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
    expect(result.audit.currentLinks).toBe(4);
    expect(result.audit.freshnessPct).toBe(100);
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
    expect(result.audit.blockedNonSymlinks).toBe(1);
    expect(readFileSync(join(localAlpha, 'SKILL.md'), 'utf8')).toBe('local copy\n');
  });

  test('syncAgentSkills audits missing, stale, and blocked runtime links without writing in status mode', () => {
    const source = join(tmpRoot, 'source');
    const home = join(tmpRoot, 'home');
    const targetRoot = join(home, '.codex', 'skills');
    const alphaDir = writeSkill(source, 'alpha', 'alpha');
    writeSkill(source, 'beta', 'beta');
    writeSkill(source, 'gamma', 'gamma');
    writeSkill(source, 'delta', 'delta');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(alphaDir, join(targetRoot, 'alpha'), 'dir');
    symlinkSync(alphaDir, join(targetRoot, 'gamma'), 'dir');
    mkdirSync(join(targetRoot, 'delta'), { recursive: true });
    writeFileSync(join(targetRoot, 'delta', 'SKILL.md'), 'local copy\n');

    const result = syncAgentSkills({
      baseDir: home,
      projectRoot: tmpRoot,
      scope: 'user',
      statusOnly: true,
      sourceRoots: [{ label: 'source', path: source }],
      targets: [{ label: 'Codex', path: targetRoot }],
    });

    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.audit.expectedLinks).toBe(4);
    expect(result.audit.currentLinks).toBe(1);
    expect(result.audit.missingLinks).toBe(1);
    expect(result.audit.staleSymlinks).toBe(1);
    expect(result.audit.blockedNonSymlinks).toBe(1);
    expect(result.audit.freshnessPct).toBe(25);
    expect(existsSync(join(targetRoot, 'beta'))).toBe(false);
    expect(readlinkSync(join(targetRoot, 'gamma'))).toBe(alphaDir);
    expect(readFileSync(join(targetRoot, 'delta', 'SKILL.md'), 'utf8')).toBe('local copy\n');
  });

  test('syncAgentSkills treats equivalent relative symlinks as already current', () => {
    const source = join(tmpRoot, 'source');
    const home = join(tmpRoot, 'home');
    const targetRoot = join(home, '.codex', 'skills');
    const alphaDir = writeSkill(source, 'alpha', 'alpha');
    mkdirSync(targetRoot, { recursive: true });
    const relativeAlpha = relative(targetRoot, alphaDir);
    symlinkSync(relativeAlpha, join(targetRoot, 'alpha'), 'dir');

    const result = syncAgentSkills({
      baseDir: home,
      projectRoot: tmpRoot,
      scope: 'user',
      sourceRoots: [{ label: 'source', path: source }],
      targets: [{ label: 'Codex', path: targetRoot }],
    });

    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.alreadyLinked).toBe(1);
    expect(result.audit.currentLinks).toBe(1);
    expect(result.audit.freshnessPct).toBe(100);
    expect(readlinkSync(join(targetRoot, 'alpha'))).toBe(relativeAlpha);
  });

  test('a deleted skill leaves a link behind, and the sync reaps it', () => {
    // The audit walks skills x targets, so it can only ever see links the
    // catalog still expects. Ten links from one retired skill family
    // outlived their skills in ~/.claude/skills exactly this way: dangling,
    // invisible, reported as no drift at all. This is that shape, in a
    // sandbox.
    const source = join(tmpRoot, 'skills');
    writeSkill(source, 'kept-skill', 'kept-skill');
    const deleted = writeSkill(source, 'deleted-skill', 'deleted-skill');
    const baseDir = join(tmpRoot, 'home');
    const roots = [{ label: 'test', path: source }];
    const targets = [{ label: 'Claude', path: join(baseDir, '.claude', 'skills') }];

    const first = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets });
    expect(first.created).toBe(2);
    expect(first.audit.orphanedLinks).toBe(0);

    rmSync(deleted, { recursive: true, force: true });
    const orphan = join(targets[0].path, 'deleted-skill');
    expect(lstatSync(orphan).isSymbolicLink()).toBe(true);
    expect(existsSync(orphan)).toBe(false); // dangling: the link is there, the skill is not

    const status = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets, statusOnly: true });
    expect(status.audit.orphanedLinks).toBe(1);
    expect(status.audit.examples.orphaned[0].skill).toBe('deleted-skill');
    expect(status.removed).toBe(0); // status mode reports, never writes
    expect(lstatSync(orphan).isSymbolicLink()).toBe(true);

    const second = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets });
    expect(second.removed).toBe(1);
    expect(second.audit.orphanedLinks).toBe(0);
    expect(lstatSync(join(targets[0].path, 'kept-skill')).isSymbolicLink()).toBe(true);
  });

  test('an orphan is still an orphan when the catalog root is reached through a symlink', () => {
    // The same reap, with one symlink between the caller's path to the catalog
    // and the catalog itself -- which is not an exotic setup, it is macOS.
    // There /var is a link to /private/var, so every temp and work tree is
    // reached through one, and the test above failed on macOS while passing on
    // Linux for as long as it existed. The cause was an asymmetric comparison:
    // the managed roots were realpath'd and the link's destination was not, so
    // "is this orphan inside a root we own?" answered no for every orphan on
    // that platform. The reaper counted them, named them in the audit, and
    // removed none -- a fail-open in the tool written to close one, visible
    // only where the paths disagree. Linux can be made to disagree on purpose,
    // which is what this does.
    const realSource = join(tmpRoot, 'real-skills');
    writeSkill(realSource, 'kept-skill', 'kept-skill');
    const deleted = writeSkill(realSource, 'deleted-skill', 'deleted-skill');
    const linkedSource = join(tmpRoot, 'skills-via-link');
    symlinkSync(realSource, linkedSource, 'dir');

    const baseDir = join(tmpRoot, 'home-symlinked');
    const roots = [{ label: 'test', path: linkedSource }];
    const targets = [{ label: 'Claude', path: join(baseDir, '.claude', 'skills') }];

    expect(syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets }).created).toBe(2);
    rmSync(deleted, { recursive: true, force: true });

    const status = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets, statusOnly: true });
    expect(status.audit.orphanedLinks).toBe(1);
    expect(status.audit.unmanagedLinks).toBe(0); // NOT filed away as somebody else's
    expect(status.audit.examples.orphaned[0].skill).toBe('deleted-skill');

    const second = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets });
    expect(second.removed).toBe(1);
    expect(existsSync(join(targets[0].path, 'deleted-skill'))).toBe(false);
    expect(lstatSync(join(targets[0].path, 'kept-skill')).isSymbolicLink()).toBe(true);
  });

  test('the reap takes only links it could have made, never an operator\'s own', () => {
    const source = writeSkill(join(tmpRoot, 'skills'), 'real-skill', 'real-skill') && join(tmpRoot, 'skills');
    const elsewhere = join(tmpRoot, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const baseDir = join(tmpRoot, 'home');
    const targetDir = join(baseDir, '.claude', 'skills');
    const roots = [{ label: 'test', path: source }];
    const targets = [{ label: 'Claude', path: targetDir }];
    syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets });

    // An alias the operator made, pointing outside anything we manage, and a
    // real directory somebody dropped in by hand. Neither is ours to delete.
    const alias = join(targetDir, 'my-alias');
    symlinkSync(elsewhere, alias);
    const handMade = join(targetDir, 'hand-made');
    mkdirSync(handMade, { recursive: true });
    // A dangling link that points nowhere near a managed root: still not ours.
    const foreignDangler = join(targetDir, 'foreign-dangler');
    symlinkSync(join(tmpRoot, 'no-such-place'), foreignDangler);

    const unclaimed = findUnclaimedSkillLinks(
      collectSkillUnion(roots).skills,
      targets,
      roots,
    );
    expect(unclaimed.orphaned).toEqual([]);
    expect(unclaimed.unmanaged.map((entry) => entry.skill).sort()).toEqual(['foreign-dangler', 'my-alias']);

    const result = syncAgentSkills({ baseDir, projectRoot: tmpRoot, scope: 'user', sourceRoots: roots, targets });
    expect(result.removed).toBe(0);
    expect(result.audit.unmanagedLinks).toBe(2);
    expect(lstatSync(alias).isSymbolicLink()).toBe(true);
    expect(lstatSync(foreignDangler).isSymbolicLink()).toBe(true);
    expect(existsSync(handMade)).toBe(true);
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

  test('runtimeSkillTargets fans skills out to repo-local agy/Codex/Claude dirs in project scope', () => {
    const targets = runtimeSkillTargets('/repo', 'project');
    const byLabel = new Map(targets.map((target) => [target.label, target.path]));

    // The commit-time sync (scripts/sync-skills.ts --scope project) writes these
    // dotfile dirs into the repo root so every agent runtime shares one catalog.
    expect(byLabel.get('agy')).toBe('/repo/.agy/skills');
    expect(byLabel.get('Codex')).toBe('/repo/.codex/skills');
    expect(byLabel.get('Claude')).toBe('/repo/.claude/skills');
    expect(byLabel.get('AGENTS universal')).toBe('/repo/.agents/skills');

    // user-only legacy runtimes must not leak into project scope
    const labels = targets.map((target) => target.label);
    expect(labels).not.toContain('Cline');
    expect(labels).not.toContain('Codeium Windsurf legacy');
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
