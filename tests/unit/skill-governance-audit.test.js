import { describe, expect, test } from '@jest/globals';
import { auditSkills } from '../../scripts/audit-skills.mjs';

describe('skill governance audit', () => {
  test('scans every visible repo skill and reports governance gaps', () => {
    const report = auditSkills();

    expect(report.summary.total).toBeGreaterThan(100);
    expect(report.summary.missingGovernance).toBeGreaterThan(0);
    expect(report.skills.some((skill) => skill.path === 'skills/port-daddy-cli/SKILL.md')).toBe(true);
  });

  test('classifies the Port Daddy CLI skill as first-party and governance-complete', () => {
    const report = auditSkills();
    const portDaddySkill = report.skills.find((skill) => skill.path === 'skills/port-daddy-cli/SKILL.md');

    expect(portDaddySkill).toEqual(expect.objectContaining({
      class: 'first-party',
      missing: [],
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
