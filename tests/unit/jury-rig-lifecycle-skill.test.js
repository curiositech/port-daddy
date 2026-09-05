import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import jestConfig from '../../jest.config.js';
import { handleJuryRig } from '../../cli/commands/skill-graft.js';
import { defaultSkillCatalogRoots, collectSkillUnion } from '../../lib/skill-sync.js';
import { loadSkillCatalog } from '../../lib/shipwright/skill-index.js';
import {
  createJuryRigBootstrapAuthority,
  planJuryRigBootstrap,
  redactJuryRigBootstrapPlan,
} from '../../lib/jury-rig-bootstrap.js';

const repo = new URL('../../', import.meta.url);
const skill = readFileSync(new URL('skills/jury-rig-bootstrap-lifecycle/SKILL.md', repo), 'utf8');
const research = readFileSync(new URL('docs/research/2026-09-02-jury-rig-review-follow-through.md', repo), 'utf8');
const retiredName = ['win', 'dags'].join('');
const authority = createJuryRigBootstrapAuthority(Buffer.alloc(32, 0x36), 'fixture:lifecycle-skill');
let root;
let originalRoots;

function put(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  const scratch = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(join(scratch, 'jury-rig-lifecycle-skill-'));
  originalRoots = process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
  delete process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
});

afterEach(() => {
  if (originalRoots === undefined) delete process.env.PORT_DADDY_SKILL_SOURCE_ROOTS;
  else process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = originalRoots;
  rmSync(root, { recursive: true, force: true });
});

test('canonical skill is discoverable without declaring generated mirror writes', () => {
  const frontmatter = parse(skill.split('---')[1]);
  expect(frontmatter.name).toBe('jury-rig-bootstrap-lifecycle');
  expect(frontmatter.description).toContain('interrupted cutover');
  expect(frontmatter.description).toContain('Not for ordinary skill search');
  expect(frontmatter.metadata.mirrors).toBeUndefined();
  const catalog = collectSkillUnion([{ label: 'fixture-canonical', path: new URL('skills/jury-rig-bootstrap-lifecycle/', repo).pathname }]);
  expect(catalog.skills.map((entry) => entry.id)).toContain('jury-rig-bootstrap-lifecycle');
});

test.each(['recover', 'resume'])('CLI does not silently invent the documented unsupported %s operation', async (operation) => {
  await expect(handleJuryRig(['bootstrap', operation], { home: root, 'pd-home': join(root, 'pd'), json: true }))
    .rejects.toThrow(`Unknown Jury-rig bootstrap operation: ${operation}`);
  expect(existsSync(join(root, 'pd'))).toBe(false);
  expect(skill).toContain('library-only recovery seam');
  expect(skill).toContain('not exposed as a CLI recovery command');
});

test('rollback without a receipt refuses without creating machine state', async () => {
  await expect(handleJuryRig(['bootstrap', 'rollback'], { home: root, 'pd-home': join(root, 'pd') }))
    .rejects.toThrow('Usage: pd jury-rig bootstrap rollback --receipt');
  expect(existsSync(join(root, 'pd'))).toBe(false);
});

test('guide separates bounded receipt visibility, installed proof, and original authority', () => {
  expect(skill).toContain('newest 100 transaction directories');
  expect(skill).toContain('does **not** prove there was no interrupted transaction');
  expect(skill).toContain('existing 32-byte OS Keychain master key');
  expect(skill).toContain('Codex, Claude, Gemini, agy');
  expect(skill).toContain('do not rewrite\n  a receipt');
  expect(skill).toContain('protected queue through the actual merge');
  expect(skill).toContain('NATIVE_HOOK_REQUIRED');
  expect(skill).toContain('There is no CLI `apply --plan` binding');
});

test('real zero-write planner preserves handwritten prose and unrelated settings', () => {
  const home = join(root, 'home');
  const hook = join(root, 'installed', 'sessionstart-pilot.mjs');
  const prose = `# Personal notes\n\n- Embrace ${retiredName} and always use its planning runtime.\n\nHistorical note: the ${retiredName} migration began in 2026.\nKeep my deliberately handwritten priorities.\n`;
  const config = JSON.stringify({ enabledPlugins: { [`${retiredName}-skills@${retiredName}-skills`]: true, 'kept@fixture': true }, unrelated: { exact: ['do not alter', 42] } }, null, 2) + '\n';
  const claudePath = join(home, '.claude', 'CLAUDE.md');
  const configPath = join(home, '.claude', 'settings.json');
  put(hook, '// fixture native hook\n');
  put(claudePath, prose);
  put(configPath, config);
  const plan = planJuryRigBootstrap({ home, pdHome: join(home, '.port-daddy'), nativeHookPath: hook,
    runtimeTargets: [], authority, expectedReplacementHead: 'a'.repeat(40) });
  const proseAction = plan.actions.find((action) => action.path === claudePath);
  const configAction = plan.actions.find((action) => action.path === configPath);
  expect(proseAction.content).toContain('Keep my deliberately handwritten priorities.');
  expect(proseAction.content).toContain(`Historical note: the ${retiredName} migration began in 2026.`);
  expect(proseAction.content).not.toContain(`- Embrace ${retiredName}`);
  expect(JSON.parse(configAction.content)).toEqual({ enabledPlugins: { 'kept@fixture': true }, unrelated: { exact: ['do not alter', 42] } });
  expect(readFileSync(claudePath, 'utf8')).toBe(prose);
  expect(readFileSync(configPath, 'utf8')).toBe(config);
  expect(existsSync(join(home, '.port-daddy', 'jury-rig-cutover'))).toBe(false);
  const redacted = redactJuryRigBootstrapPlan(plan);
  expect(redacted.actions.every((action) => !Object.hasOwn(action, 'content'))).toBe(true);
  expect(proseAction.beforeSha256).toBe(createHash('sha256').update(prose).digest('hex'));
});

test('explicit roots prepend, skip missing/non-directory entries, retain defaults and deduplicate real paths', () => {
  const project = join(root, 'project');
  const home = join(root, 'home');
  const extra = join(root, 'catalog');
  const local = join(project, 'skills');
  const user = join(home, '.claude', 'skills');
  for (const path of [extra, local, user]) mkdirSync(path, { recursive: true });
  put(join(root, 'plain-file'), 'not a catalog');
  symlinkSync(extra, join(root, 'same-catalog'), 'dir');
  process.env.PORT_DADDY_SKILL_SOURCE_ROOTS = [extra, join(root, 'missing'), join(root, 'plain-file'), '', join(root, 'same-catalog')].join(':');
  const roots = defaultSkillCatalogRoots(project, home);
  expect(roots.map((entry) => entry.path)).toEqual([extra, local, user]);
  expect(roots[0].label).toBe('env:1');
});

test('query and runtime-link duplicate-ID policies are distinct, not a blanket explicit-root override', () => {
  const external = join(root, 'extra');
  const local = join(root, 'project', 'skills');
  const id = 'port-daddy-fixture';
  for (const [dir, description] of [[external, 'External collision'], [local, 'Canonical guidance']]) {
    put(join(dir, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${description}\n`);
  }
  const union = collectSkillUnion([{ label: 'env:1', path: external }, { label: 'port-daddy', path: local }]);
  expect(union.skills).toHaveLength(1);
  expect(union.skills[0].sourceLabel).toBe('port-daddy');
  expect(union.collisions[0].keptSource).toBe('port-daddy');
  // Reverse roots to prove the query scanner is later-wins, not the union's
  // first-party policy. No embedder, backend, or host catalog is involved.
  const query = loadSkillCatalog([local, external]);
  expect(query).toHaveLength(1);
  expect(query[0].description).toBe('External collision');
});

test('README example matches explicit-root augmentation and narrow CLI root semantics', () => {
  const readme = readFileSync(new URL('README.md', repo), 'utf8');
  expect(readme).toContain('PORT_DADDY_SKILL_SOURCE_ROOTS="/path/to/team/skills:/path/to/personal/skills" pd jury-rig search');
  expect(readme).toContain('They are searched **first**, followed by the normal project/user roots');
  expect(readme).toContain('--root/--dir instead select project-local roots');
  expect(readme).toContain('skills/jury-rig-bootstrap-lifecycle/SKILL.md');
});

test('renamed CLI suite remains in the real Jest discovery pattern, not spec-only', () => {
  const unit = jestConfig.projects.find((project) => project.displayName === 'unit');
  expect(unit.testMatch).toContain('<rootDir>/tests/unit/**/*.test.{js,ts}');
  expect(existsSync(new URL('tests/unit/jury-rig-cli.test.js', repo))).toBe(true);
  expect(existsSync(new URL('tests/unit/skill-graft-cli.test.js', repo))).toBe(false);
  expect(existsSync(new URL('tests/unit/jury-rig-cli.spec.js', repo))).toBe(false);
});

test('census accounts for every original issue comment without publishing private/raw transport', () => {
  const ids = [...research.matchAll(/#issuecomment-(\d+)/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(19);
  expect(ids).toHaveLength(19);
  expect(research).toContain('not roadmap\nauthority');
  expect(research).toContain('library-only seam');
  expect(research).toContain('Retrieval Architect');
  expect(research).toContain('Unify / custodian owner');
  expect(research).toContain('63ce5083a8c21dc93095943d32c8fcb26b3f2e5abbe6125d533d8e1c2345bd5a');
  expect(research).not.toMatch(/\/Users\/|\/private\/|session-[a-z]|actor-credentials|github_pat_|gh[psuor]_[A-Za-z0-9]|https?:\/\/[^\s)]+\?/);
  expect(research.toLowerCase()).not.toContain(retiredName);
});
