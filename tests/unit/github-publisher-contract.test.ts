import { describe, expect, test } from '@jest/globals';
import {
  FLEETBOT_ACTION_SCHEMA,
  fleetbotIdempotencyPreimage,
  roadmapTrailers,
  stampFleetbotMessage,
  stampPullRequestBody,
  validateRoadmapTrailer,
  type FleetbotActionRequest,
  type FleetbotAuthorship,
} from '../../lib/github-publisher-contract.js';

const authorship: FleetbotAuthorship = {
  actorId: '01ACTOR',
  agentId: 'agent-publisher',
  sessionId: 'session-publisher',
  purpose: 'Publish a tested fix',
  roadmapItem: 'provable-action-adjudicator',
  sidequestReason: null,
  worktreeId: 'worktree-1',
  sourceBranch: 'codex/fix',
};

describe('Fleetbot publisher contract', () => {
  test('canonicalizes nested objects without changing array order', () => {
    const left: FleetbotActionRequest = {
      schema: FLEETBOT_ACTION_SCHEMA,
      operation: 'pull-request.publish',
      repository: 'curiositech/port-daddy',
      sessionId: authorship.sessionId,
      authorship,
      payload: { z: 2, nested: { b: 2, a: 1 }, files: ['b', 'a'] },
    };
    const right = {
      ...left,
      payload: { files: ['b', 'a'], nested: { a: 1, b: 2 }, z: 2 },
    };
    expect(fleetbotIdempotencyPreimage(left)).toBe(fleetbotIdempotencyPreimage(right));
  });

  test('requires exactly one trailer matching daemon-stored roadmap rent', () => {
    expect(validateRoadmapTrailer(
      '## Summary\nGood fix.\n\nRoadmap-Item: provable-action-adjudicator',
      authorship,
    )).toBeNull();
    expect(validateRoadmapTrailer(
      'Roadmap-Item: other\nRoadmap-Item: provable-action-adjudicator',
      authorship,
    )?.code).toBe('ROADMAP_TRAILER_INVALID');
    expect(validateRoadmapTrailer('Roadmap-Item: other', authorship)?.code)
      .toBe('ROADMAP_OWNERSHIP_MISMATCH');
  });

  test('sidequests require a specific opt-out rather than a claimed slug', () => {
    const sidequest = { ...authorship, roadmapItem: null, sidequestReason: 'Deterministic fixture hotfix only' };
    expect(validateRoadmapTrailer(
      'Roadmap-Item: none — deterministic fixture hotfix only',
      sidequest,
    )).toBeNull();
    expect(validateRoadmapTrailer('Roadmap-Item: none — tiny', sidequest)?.code)
      .toBe('ROADMAP_OPT_OUT_INVALID');
  });

  test('stamps PR bodies visibly before the sole roadmap trailer and is idempotent', () => {
    const body = '## Summary\nA complete fix.\n\nRoadmap-Item: provable-action-adjudicator\n';
    const once = stampPullRequestBody({ body, authorship, receiptId: 'receipt-1', sourceHeadSha: 'a'.repeat(40) });
    const twice = stampPullRequestBody({ body: once, authorship, receiptId: 'receipt-1', sourceHeadSha: 'a'.repeat(40) });
    expect(twice).toBe(once);
    expect(roadmapTrailers(once)).toEqual(['provable-action-adjudicator']);
    expect(once.indexOf('Published by Port Daddy Fleetbot')).toBeLessThan(once.indexOf('Roadmap-Item:'));
    expect(once).toContain('agent-publisher');
    expect(once).toContain('session-publisher');
  });

  test('stamps comments with responsible-agent and receipt provenance', () => {
    const stamped = stampFleetbotMessage({ body: 'Addressed the review.', authorship, receiptId: 'receipt-2' });
    expect(stamped).toContain('Addressed the review.');
    expect(stamped).toContain('Responsible agent: `agent-publisher`');
    expect(stamped).toContain('Relay receipt: `receipt-2`');
  });
});
