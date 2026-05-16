import { describe, expect, test } from '@jest/globals';
import { auditSkills } from '../../scripts/audit-skills.mjs';

describe('skill governance audit', () => {
  test('scans every visible repo skill and reports governance gaps', () => {
    const report = auditSkills();

    expect(report.summary.total).toBeGreaterThan(100);
    expect(report.summary.missingGovernance).toBeGreaterThan(0);
    expect(report.summary.runtimeInvalid).toBe(0);
    expect(report.skills.some((skill) => skill.path === 'skills/port-daddy-agent-skill/SKILL.md')).toBe(true);
  });

  test('runtime-required frontmatter fields are fail-closed', () => {
    const report = auditSkills();
    const invalidSkills = report.skills.filter((skill) => skill.runtimeMissing.length > 0);

    expect(invalidSkills).toEqual([]);
  });

  test('classifies the Port Daddy agent skill as first-party and governance-complete', () => {
    const report = auditSkills();
    const portDaddySkill = report.skills.find((skill) => skill.path === 'skills/port-daddy-agent-skill/SKILL.md');

    expect(portDaddySkill).toEqual(expect.objectContaining({
      class: 'first-party',
      missing: [],
      runtimeMissing: [],
      hasChangelog: true,
      hasReferences: true,
    }));
  });

  test('does not collapse imported literature into first-party mutation targets', () => {
    const report = auditSkills();
    const literatureSkill = report.skills.find((skill) => skill.path === 'skills/fipa-00023-agent-management/SKILL.md');

    expect(literatureSkill).toEqual(expect.objectContaining({
      class: 'imported-literature',
    }));
  });
});
