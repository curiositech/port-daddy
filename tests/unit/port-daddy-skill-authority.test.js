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

  test('the skill teaches the operating loop in order before decision points', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const operatingLoopStart = contents.indexOf('## Operating Loop');
    const decisionPointsStart = contents.indexOf('## Decision Points');
    const cliQuickRefStart = contents.indexOf('## CLI Quick Reference', decisionPointsStart);

    expect(operatingLoopStart).toBeGreaterThan(-1);
    expect(decisionPointsStart).toBeGreaterThan(operatingLoopStart);
    expect(cliQuickRefStart).toBeGreaterThan(decisionPointsStart);

    const operatingLoop = contents.slice(operatingLoopStart, decisionPointsStart);
    const expectedOrder = [
      'pd status',
      'pd briefing',
      'pd salvage --project <project>',
      'pd begin',
      'pd note "Scope:',
      'pd session files add',
      'pd guard check --staged',
      'pd note "Result:',
      'pd done',
    ];

    let previousIndex = -1;
    for (const command of expectedOrder) {
      const index = operatingLoop.indexOf(command);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    // The operating loop is intentionally a tight, opinionated default.
    // Advanced primitives belong in the CLI Quick Reference, not the loop.
    expect(operatingLoop).not.toContain('pd tuple out');
    expect(operatingLoop).not.toContain('pd pheromone');
    expect(operatingLoop).not.toContain('pd fleet up');
    expect(operatingLoop).not.toContain('pd sortie');
  });

  test('the CLI quick reference surfaces the agent-facing primitives', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const cliQuickRefStart = contents.lastIndexOf('## CLI Quick Reference');
    const selfCheckStart = contents.indexOf('## Self-Check');

    expect(cliQuickRefStart).toBeGreaterThan(-1);
    expect(selfCheckStart).toBeGreaterThan(cliQuickRefStart);

    const quickRef = contents.slice(cliQuickRefStart, selfCheckStart);

    expect(quickRef).toContain('project:stack:context');
    expect(quickRef).toContain('pd whoami');
    expect(quickRef).toContain('pd claim');
    expect(quickRef).toContain('pd with-lock');
    expect(quickRef).toContain('pd dns');
    expect(quickRef).toMatch(/integration ready|integration needs/);
    expect(quickRef).toContain('begin_session');
    expect(quickRef).toContain('end_session_full');
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

  test('setup and Homebrew install the canonical skill id into agent runtime mirrors', () => {
    const setup = readFileSync(join(process.cwd(), 'cli', 'commands', 'setup.ts'), 'utf8');
    const formula = readFileSync(join(process.cwd(), 'Formula', 'port-daddy.rb'), 'utf8');

    expect(setup).toContain("AGENT_SKILL_ID = 'port-daddy-agent-skill'");
    expect(setup).toContain("join(prefix, 'share', 'port-daddy', 'skills', AGENT_SKILL_ID)");
    expect(setup).toContain("join(PROJECT_ROOT, 'skills', AGENT_SKILL_ID)");
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

    expect(formula).toContain('"skills/port-daddy-agent-skill" => "skills/port-daddy-agent-skill"');
    expect(formula).toContain('Refreshing Port Daddy cross-tool skill symlinks');
    expect(formula).not.toContain('=> "skills/port-daddy"');
    for (const runtimePath of [
      '~/.codex/skills/port-daddy-agent-skill',
      '~/.claude/skills/port-daddy-agent-skill',
      '~/.agents/skills/port-daddy-agent-skill',
      '~/.gemini/extensions/port-daddy/skills/port-daddy-agent-skill',
    ]) {
      expect(formula).toContain(runtimePath);
    }
  });
});
