import { describe, test, expect } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const unique = (values) => Array.from(new Set(values));

describe('Port Daddy skill authority', () => {
  test('the repo exposes a canonical first-party Port Daddy agent-skill surface', () => {
    // The original fragmentation was three variants of the SAME instruction
    // manual (`port-daddy`, `port-daddy-cli`, `port-daddy-agent-skill`).
    // We allow other first-party `port-daddy-*` surfaces (e.g.
    // `port-daddy-marketing-copy` is a different concern entirely — copy
    // generation, not agent guidance) — but the legacy duplicates must
    // stay gone, and the canonical agent skill must exist.
    const skillsDir = join(process.cwd(), 'skills');
    const portDaddySkills = readdirSync(skillsDir)
      .filter((entry) => entry.startsWith('port-daddy'))
      .sort();

    // The agent-skill is the single canonical *coordination* surface for
    // any agent on any project; the marketing-copy skill is a deliberate,
    // scoped second surface for website voice; the internal-dev skill is
    // the contributor-only manual for editing this repo (private, never
    // published downstream); the expository-writer skill (added by PR #148)
    // is a scoped surface for long-form expository docs/blog authoring;
    // the users skill is a persona catalog (24 named personas) consumed by
    // ux-friction-analyzer/product-appeal-analyzer, not agent guidance.
    // Adding any other port-daddy-* skill should fail this assertion until
    // it's explicitly listed here.
    expect(portDaddySkills).toEqual([
      'port-daddy-agent-skill',
      'port-daddy-expository-writer',
      'port-daddy-internal-dev',
      'port-daddy-marketing-copy',
      'port-daddy-user-surrogate-pm-review',
      'port-daddy-users',
    ]);
    expect(existsSync(join(skillsDir, 'port-daddy', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'port-daddy-cli', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'port-daddy-agent-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'port-daddy-marketing-copy', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'port-daddy-internal-dev', 'SKILL.md'))).toBe(true);
  });

  test('the authoritative skill declares the canonical name', () => {
    const skill = readFileSync(join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md'), 'utf8');

    expect(skill).toContain('name: port-daddy-agent-skill');
    expect(skill).not.toContain('name: port-daddy-cli');
  });

  test('the authoritative skill carries first-party governance metadata', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');

    expect(contents).toContain('license: FSL-1.1-MIT');
    expect(contents).toContain('allowed-tools:');
    expect(contents).toContain('metadata:');
    expect(contents).toContain('provenance:');
    expect(contents).toContain('authorship:');
    // Mirrors block must list the in-repo runtime stub locations so brew/setup
    // can fan the canonical content out to every runtime that reads it.
    expect(contents).toContain('mirrors:');
    expect(contents).toContain('repo: skills/port-daddy-agent-skill');
  });

  test('the skill teaches the current operating loop before advanced routing', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const firstFiveStart = contents.indexOf('## First five minutes');
    const operatingLoopStart = contents.indexOf('## Normal operating loop');
    const sessionActionsStart = contents.indexOf('## Session actions are distinct');
    const quickMapStart = contents.indexOf('## Quick command map');
    const referenceRoutingStart = contents.indexOf('## Reference routing');

    expect(firstFiveStart).toBeGreaterThan(-1);
    expect(operatingLoopStart).toBeGreaterThan(firstFiveStart);
    expect(sessionActionsStart).toBeGreaterThan(operatingLoopStart);
    expect(quickMapStart).toBeGreaterThan(sessionActionsStart);
    expect(referenceRoutingStart).toBeGreaterThan(quickMapStart);

    const firstFive = contents.slice(firstFiveStart, sessionActionsStart);
    const expectedOrder = [
      'pd attention',
      'pd sitrep',
      'pd briefing',
      'pd sessions --all-worktrees',
      'pd salvage --project <project>',
      'pd begin',
      '--roadmap <roadmap-item-slug>',
      'pd whoami',
      'pd note "Scope:',
      'pd session files add',
      'pd note "Result:',
      'pd done',
    ];

    let previousIndex = -1;
    for (const command of expectedOrder) {
      const index = firstFive.indexOf(command);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(contents).toContain('Never hardcode the preferred bind seed');
    expect(contents).toContain('pd dev up --from "$(pwd)" --label <feature>');
    expect(contents).toContain('There is no default task deadline');
    expect(contents).toContain('pd spawn cancel <agent-id> --reason "<why>"');
    expect(contents).toContain('pd squid on');
    expect(contents).toContain('pd guard check --staged');
    expect(contents).toContain('The operator uses FleetBar, Fleet Control Center, and native console surfaces.');
  });

  test('the quick command map surfaces current agent-facing primitives', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const quickMapStart = contents.indexOf('## Quick command map');
    const referenceRoutingStart = contents.indexOf('## Reference routing');

    expect(quickMapStart).toBeGreaterThan(-1);
    expect(referenceRoutingStart).toBeGreaterThan(quickMapStart);

    const quickMap = contents.slice(quickMapStart, referenceRoutingStart);

    expect(quickMap).toContain('attention / sitrep / briefing / status');
    expect(quickMap).toContain('begin / whoami / note / plan / done');
    expect(quickMap).toContain('session / sessions / files / who-owns');
    expect(quickMap).toContain('claim / release / ports / find');
    expect(quickMap).toContain('lock / unlock / with-lock');
    expect(quickMap).toContain('spawn / spawned / sortie / work / watch');
    expect(quickMap).toContain('squid / hooks / mcp / skill-graft');
    expect(quickMap).toContain('doctor / attest / safe / guard / advise');
    expect(quickMap).toContain('actor / roster / tuple / graph / memory');
  });

  /*
   * The previous authority test enforced old heading names and a duplicated
   * mini-manual. The new field guide is intentionally progressive: the tight
   * loop comes first, current action/runtime contracts follow, and full CLI,
   * API, and SDK inventories are routed to references.
   */
  test('the root skill stays compact and routes detailed inventories', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');

    expect(contents).toContain('references/cli-reference.md');
    expect(contents).toContain('references/api-reference.md');
    expect(contents).toContain('references/sdk-reference.md');
    expect(contents.split('\n').length).toBeLessThan(340);
    expect(contents).not.toContain('## CLI Quick Reference');
    expect(contents).not.toContain('## Decision Points');
  });

  test('release metadata names the canonical skill exactly once', () => {
    const marketplacePath = join(process.cwd(), '.claude-plugin', 'marketplace.json');
    const exportConfigPath = join(process.cwd(), 'config', 'public-repo-export.json');
    const geminiPath = join(process.cwd(), '.gemini', 'extensions', 'port-daddy', 'GEMINI.md');

    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    const exportConfig = JSON.parse(readFileSync(exportConfigPath, 'utf8'));
    const gemini = readFileSync(geminiPath, 'utf8');

    const marketplaceSkills = marketplace.plugins.flatMap((plugin) => plugin.skills ?? []);
    const exportIncludes = exportConfig.includePrefixes
      .filter((entry) => entry.includes('port-daddy-agent-skill'));

    expect(marketplaceSkills).toEqual(unique(marketplaceSkills));
    expect(marketplaceSkills).toContain('./skills/port-daddy-agent-skill');
    expect(marketplaceSkills).not.toContain('./skills/port-daddy-cli');
    expect(exportIncludes).toEqual(['skills/port-daddy-agent-skill/']);
    expect(gemini).toContain('port-daddy-agent-skill');
    expect(gemini).not.toContain('port-daddy-cli');
  });

  test('MCP skill discovery does not duplicate the canonical candidate', () => {
    const server = readFileSync(join(process.cwd(), 'mcp', 'server.ts'), 'utf8');
    const candidatesStart = server.indexOf('const candidates = [', server.indexOf('Search for skill'));
    const candidatesEnd = server.indexOf('];', candidatesStart);
    const candidates = server.slice(candidatesStart, candidatesEnd);
    const canonicalCandidate = "join(mcpDir, '..', 'skills', 'port-daddy-agent-skill', 'SKILL.md')";

    expect(candidates.match(/port-daddy-agent-skill/g) ?? []).toHaveLength(1);
    expect(candidates).toContain(canonicalCandidate);
    expect(server).toContain('legacy alias/install');
  });

  test('setup installs the canonical skill id and release automation delegates the formula to the tap', () => {
    const setup = readFileSync(join(process.cwd(), 'cli', 'commands', 'setup.ts'), 'utf8');
    const release = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    expect(setup).toContain("AGENT_SKILL_ID = 'port-daddy-agent-skill'");
    expect(setup).toContain("resolveSquidAsset(join('skills', AGENT_SKILL_ID, 'SKILL.md'), options)");
    expect(setup).not.toContain("spawnSync('brew', ['--prefix']");
    expect(setup).toContain('syncAgentSkills');
    expect(setup).toContain('ensureGeminiPortDaddyExtension');
    expect(setup).toContain("options['dry-run']");
    expect(setup).toContain("options['skill-status']");

    for (const runtimePath of [
      "'.codex', 'skills', AGENT_SKILL_ID",
      "'.claude', 'skills', AGENT_SKILL_ID",
      "'.agents', 'skills', AGENT_SKILL_ID",
      "'.gemini', 'extensions', 'port-daddy', 'skills', AGENT_SKILL_ID",
    ]) {
      expect(setup).toContain(runtimePath);
    }

    expect(setup).not.toContain("'.claude', 'skills', 'port-daddy'");
    expect(setup).not.toContain("'.gemini', 'extensions', 'port-daddy', 'skills', 'port-daddy'");

    expect(release).toContain('repository: curiositech/homebrew-tap');
    expect(release).toContain('event-type: update-formula');
    expect(release).toContain('github.event.release.prerelease == false');
    expect(existsSync(join(process.cwd(), 'Formula', 'port-daddy.rb'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'port-daddy.rb'))).toBe(false);
  });
});
