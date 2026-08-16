import { describe, it, expect, vi } from 'vitest';
import { deriveStepModel, derivePurserPlanModel, derivePurserAuthorModel, parseFleetShips } from '../../apps/fleet-executor/src/fleet.ts';
import { KNOWN_GOOD_CF_MODELS } from '../../apps/fleet-executor/src/fleet.ts';

const CHEAP_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MID_MODEL = '@cf/openai/gpt-oss-20b';
const REVIEW_BOT_MODEL = '@cf/openai/gpt-oss-120b';

interface MockAgent {
  plan_model?: string;
  planModel?: string;
  cfPlanModel?: string;
  author_model?: string;
  authorModel?: string;
  cfAuthorModel?: string;
}

describe('model validation tests', () => {
  it('should handle unknown model IDs by falling back to the tier default', () => {
    const agent: MockAgent = { cfPlanModel: '@cf/unknown/model' };
    const result = deriveStepModel(agent.cfPlanModel, CHEAP_MODEL, 'cfPlanModel');
    expect(result).toEqual({ supplied: false });
    expect(result.model).toBeUndefined();
  });

  it('should warn and fallback for empty model values', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent: MockAgent = { cfPlanModel: '' };
    const result = deriveStepModel(agent.cfPlanModel, CHEAP_MODEL, 'cfPlanModel');
    expect(result).toEqual({ supplied: false });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('present but empty'));
    warnSpy.mockRestore();
  });

  it('should prohibit the review bot model for any step', () => {
    const agent: MockAgent = { cfAuthorModel: REVIEW_BOT_MODEL };
    const result = deriveStepModel(agent.cfAuthorModel, MID_MODEL, 'cfAuthorModel');
    expect(result).toEqual({ supplied: false });
    expect(result.model).toBeUndefined();
  });

  it('should default PLAN to the cheap model when no config is provided', () => {
    const agent: MockAgent = {};
    const result = derivePurserPlanModel(agent, CHEAP_MODEL);
    expect(result).toBeUndefined();
  });

  it('should default AUTHOR to the mid tier when no config is provided', () => {
    const agent: MockAgent = {};
    const result = derivePurserAuthorModel(agent, MID_MODEL);
    expect(result).toBeUndefined();
  });

  it('should accept valid model pins that match known good models', () => {
    const agent: MockAgent = { cfPlanModel: CHEAP_MODEL };
    const planResult = derivePurserPlanModel(agent, CHEAP_MODEL);
    expect(planResult).toBeUndefined();

    const authorAgent: MockAgent = { cfAuthorModel: MID_MODEL };
    const authorResult = derivePurserAuthorModel(authorAgent, MID_MODEL);
    expect(authorResult).toBeUndefined();
  });

  it('should not include step model keys for non-purser ships', () => {
    const yaml = [
      'fleet:',
      '  agents:',
      '    qa:',
      '      trigger: pull_request:opened',
      '      prompt: check it',
    ].join('\n');
    const ships = parseFleetShips(yaml, 'pull_request:opened');
    const nonPurserShip = ships[0];
    expect(nonPurserShip.cfPlanModel).toBeUndefined();
    expect(nonPurserShip.cfAuthorModel).toBeUndefined();
  });

  it('should handle camelCase and cf* model keys correctly', () => {
    const agent: MockAgent = { planModel: CHEAP_MODEL, authorModel: MID_MODEL };
    const planResult = derivePurserPlanModel(agent, CHEAP_MODEL);
    expect(planResult).toBeUndefined();

    const authorResult = derivePurserAuthorModel(agent, MID_MODEL);
    expect(authorResult).toBeUndefined();
  });

  it('should not allow the review bot model in any step', () => {
    const agent: MockAgent = { cfPlanModel: REVIEW_BOT_MODEL };
    const planResult = derivePurserPlanModel(agent, CHEAP_MODEL);
    expect(planResult).toBe(CHEAP_MODEL);

    const authorAgent: MockAgent = { cfAuthorModel: REVIEW_BOT_MODEL };
    const authorResult = derivePurserAuthorModel(authorAgent, MID_MODEL);
    expect(authorResult).toBe(MID_MODEL);
  });

  it('should validate known good models against the set', () => {
    expect(KNOWN_GOOD_CF_MODELS.has(CHEAP_MODEL)).toBe(true);
    expect(KNOWN_GOOD_CF_MODELS.has(MID_MODEL)).toBe(true);
    expect(KNOWN_GOOD_CF_MODELS.has(REVIEW_BOT_MODEL)).toBe(false);
  });
});