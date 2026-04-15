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
});
