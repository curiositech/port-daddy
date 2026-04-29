import { describe, test, expect } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Port Daddy skill authority', () => {
  test('the repo exposes one canonical first-party Port Daddy skill surface', () => {
    const skillsDir = join(process.cwd(), 'skills');
    const portDaddySkills = readdirSync(skillsDir)
      .filter((entry) => entry.startsWith('port-daddy'))
      .sort();

    expect(portDaddySkills).toEqual(['port-daddy-agent-skill']);
    expect(existsSync(join(skillsDir, 'port-daddy', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'port-daddy-cli', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'port-daddy-agent-skill', 'SKILL.md'))).toBe(true);
  });

  test('the authoritative skill declares the canonical name', () => {
    const skill = readFileSync(join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md'), 'utf8');

    expect(skill).toContain('name: port-daddy-agent-skill');
    expect(skill).not.toContain('name: port-daddy-cli');
  });

  test('the authoritative skill carries first-party governance metadata', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const changelogPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'CHANGELOG.md');
    const contents = readFileSync(skillPath, 'utf8');
    const changelog = readFileSync(changelogPath, 'utf8');

    expect(contents).toContain('license: FSL-1.1-MIT');
    expect(contents).toContain('allowed-tools: Read,Bash,Grep,Glob');
    expect(contents).toContain('metadata:');
    expect(contents).toContain('provenance:');
    expect(contents).toContain('authorship:');
    expect(contents).toContain('workgroup: /Users/erichowens/coding/workgroup-ai/skills/port-daddy');
    expect(contents).toContain('user: /Users/erichowens/.agents/skills/port-daddy-agent-skill');
    expect(changelog).toContain('## 2026-04-26');
    expect(changelog).toContain('Navigator/Cartographer');
  });

  test('the skill starts with one idiomatic agent happy path before advanced surfaces', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const happyPathStart = contents.indexOf('## Default Agent Happy Path');
    const decisionTableStart = contents.indexOf('## Small Decision Table');
    const advancedStart = contents.indexOf('## Advanced Surfaces');
    const quickReferenceStart = contents.indexOf('## CLI Quick Reference');

    expect(happyPathStart).toBeGreaterThan(-1);
    expect(decisionTableStart).toBeGreaterThan(happyPathStart);
    expect(advancedStart).toBeGreaterThan(decisionTableStart);
    expect(quickReferenceStart).toBeGreaterThan(advancedStart);

    const happyPath = contents.slice(happyPathStart, decisionTableStart);
    const expectedOrder = [
      'pd status',
      'pd briefing',
      'pd salvage --project <project>',
      'pd begin',
      'pd whoami',
      'pd advise',
      'pd note "Scope:',
      'pd session files add',
      'pd note "Result:',
      'pd done',
    ];

    let previousIndex = -1;
    for (const command of expectedOrder) {
      const index = happyPath.indexOf(command);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(happyPath).not.toContain('pd tuple out');
    expect(happyPath).not.toContain('pd pheromone');
    expect(happyPath).not.toContain('pd fleet');
    expect(happyPath).not.toContain('pd sortie');
    expect(happyPath).not.toContain('pd agent "');
  });

  test('roadmap and skill-drift work is routed through live actor surfaces', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const actorTruthStart = contents.indexOf('## Roadmap, Skill, And Actor Truth');
    const mcpStart = contents.indexOf('## MCP Equivalents');

    expect(actorTruthStart).toBeGreaterThan(-1);
    expect(mcpStart).toBeGreaterThan(actorTruthStart);

    const actorTruth = contents.slice(actorTruthStart, mcpStart);

    expect(actorTruth).toContain('pd actors --project <project>');
    expect(actorTruth).toContain('pd actor cartographer --project <project>');
    expect(actorTruth).toContain('pd actor navigator --inbox-stats');
    expect(actorTruth).toContain('pd actor navigator --inbox --unread');
    expect(actorTruth).toContain('pd actor navigator --message');
    expect(actorTruth).toContain('pd actor lookout --message');
    expect(actorTruth).toContain('Mailbox delivery is durable but not an immediate answer');
    expect(actorTruth).toContain('docs/recovery/CURRENT-WORK.md');
    expect(actorTruth).toContain('.cartographer/README.md');
    expect(actorTruth).toContain('.cartographer/status.md');
  });

  test('the skill teaches ambient coordination instead of forced agent chat', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-agent-skill', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');
    const ambientStart = contents.indexOf('## Ambient Peer Coordination');
    const actorTruthStart = contents.indexOf('## Roadmap, Skill, And Actor Truth');

    expect(ambientStart).toBeGreaterThan(-1);
    expect(actorTruthStart).toBeGreaterThan(ambientStart);

    const ambient = contents.slice(ambientStart, actorTruthStart);

    expect(ambient).toContain('not to make agents talk constantly');
    expect(ambient).toContain('shared facts');
    expect(ambient).toContain('pd note');
    expect(ambient).toContain('fix bounded Port Daddy dogfood bugs when you discover them');
    expect(ambient).toContain('targeted actor message');
    expect(ambient).toContain('symbol/region claims');
    expect(ambient).toContain('coordination:inconsistency');
    expect(ambient).toContain('not just collision avoidance');
    expect(ambient).toContain('Operator-worthy callouts');
    expect(ambient).toContain('implied-goal contradictions');
    expect(ambient).toContain('security, auth, privacy, data-retention, trust-boundary');
    expect(ambient).toContain('raw text or unauthenticated endpoints');
    expect(ambient).toContain('authenticated, secure API');
    expect(ambient).toContain('sessions marked active while their agent registry bodies are dead or missing');
    expect(ambient).toContain('Routine progress stays in notes');
  });
});
