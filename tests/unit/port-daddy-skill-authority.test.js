import { describe, test, expect } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Port Daddy skill authority', () => {
  test('the repo exposes exactly one authoritative Port Daddy skill surface', () => {
    const skillsDir = join(process.cwd(), 'skills');
    const portDaddySkills = readdirSync(skillsDir)
      .filter((entry) => entry.startsWith('port-daddy'))
      .sort();

    expect(portDaddySkills).toEqual(['port-daddy-cli']);
    expect(existsSync(join(skillsDir, 'port-daddy', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(skillsDir, 'port-daddy-cli', 'SKILL.md'))).toBe(true);
  });

  test('the authoritative skill declares the matching canonical name', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-cli', 'SKILL.md');
    const contents = readFileSync(skillPath, 'utf8');

    expect(contents).toContain('name: port-daddy-cli');
    expect(contents).not.toContain('name: port-daddy\n');
  });

  test('the skill starts with one idiomatic agent happy path before advanced surfaces', () => {
    const skillPath = join(process.cwd(), 'skills', 'port-daddy-cli', 'SKILL.md');
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
});
