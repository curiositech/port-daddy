import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditIssueWorkflow } from '../../skills/agent-issue-tracker-workflow/scripts/issue_hygiene.mjs';
import { auditPullRequest } from '../../skills/agent-pr-authoring/scripts/pr_readiness.mjs';
import { auditRoadmapLegibility } from '../../skills/legible-roadmap-with-sidequests/scripts/roadmap_legibility.mjs';
import { auditDogfoodBar } from '../../skills/multi-agent-authoring-product-bar/scripts/dogfood_bar.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const skillIds = [
  'agent-issue-tracker-workflow',
  'agent-pr-authoring',
  'legible-roadmap-with-sidequests',
  'multi-agent-authoring-product-bar',
];

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('agent-workflow skill helpers pass their sample and reject/flag bad input', () => {
  test('auditIssueWorkflow: clean tracker passes; missing dedupe + orphan work fails', () => {
    const clean = auditIssueWorkflow(sample('agent-issue-tracker-workflow'));
    expect(clean.pass).toBe(true);
    expect(clean.findings).toHaveLength(0);

    const bad = clone(sample('agent-issue-tracker-workflow'));
    for (const item of bad.items ?? []) {
      item.dedupeSearched = false;
      item.linkedArtifacts = [];
    }
    const report = auditIssueWorkflow(bad);
    expect(report.pass).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    expect(() => auditIssueWorkflow(null)).toThrow();
  });

  test('auditPullRequest: complete PR passes; no test-plan + oversized diff fails', () => {
    const clean = auditPullRequest(sample('agent-pr-authoring'));
    expect(clean.pass).toBe(true);

    const bad = clone(sample('agent-pr-authoring'));
    bad.body = { ...(bad.body ?? {}), hasTestPlan: false, testPlanHasEvidence: false };
    bad.diff = { ...(bad.diff ?? {}), filesChanged: 300, linesChanged: 9000, mixedConcerns: true };
    const report = auditPullRequest(bad);
    expect(report.pass).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    expect(() => auditPullRequest(null)).toThrow();
  });

  test('auditRoadmapLegibility: linked work passes; untracked sidequest fails', () => {
    const clean = auditRoadmapLegibility(sample('legible-roadmap-with-sidequests'));
    expect(clean.pass).toBe(true);

    const bad = clone(sample('legible-roadmap-with-sidequests'));
    for (const unit of bad.workUnits ?? []) {
      delete unit.roadmapLink;
      delete unit.optOutReason;
      unit.progressEvidence = [];
    }
    const report = auditRoadmapLegibility(bad);
    expect(report.pass).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    expect(() => auditRoadmapLegibility(null)).toThrow();
  });

  test('auditDogfoodBar: real product passes; Potemkin swarm below table stakes fails', () => {
    const clean = auditDogfoodBar(sample('multi-agent-authoring-product-bar'));
    expect(clean.pass).toBe(true);

    const bad = clone(sample('multi-agent-authoring-product-bar'));
    if (bad.differentiators) {
      for (const key of Object.keys(bad.differentiators)) {
        bad.differentiators[key] = { present: true, hasRealBehavior: false, leavesReceipt: false };
      }
    }
    if (bad.stickiness) {
      bad.stickiness.comebackTriggers = [];
      bad.stickiness.usesOverIncumbentForRealWork = false;
    }
    bad.metricsHonest = false;
    const report = auditDogfoodBar(bad);
    expect(report.pass).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    expect(() => auditDogfoodBar(null)).toThrow();
  });
});

describe('agent-workflow skill contract files', () => {
  test.each(skillIds)('%s declares IO contracts and points to existing resources', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
