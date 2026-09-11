import { describe, expect, it } from 'vitest';
import { shipAiOptions } from '../src/ship-ai-options.js';
import { ShipTranscript } from '../src/transcript-capture.js';

describe('ship metadata-only gateway options', () => {
  it('preserves affinity and does not introduce gateway routing when absent', () => {
    const options = shipAiOptions(undefined, 'purser');
    expect(options.gateway).toBeUndefined();
    expect(options.extraHeaders).toEqual({ 'x-session-affinity': 'pd-fleet-purser', 'cf-aig-collect-log-payload': 'false' });
  });
  it('correlates repo, run, ship and attempt without sending transcript bodies', () => {
    const capture = new ShipTranscript('run:delivery', 'purser', 2, 'owner/repo');
    const options = shipAiOptions('existing-gateway', 'purser', capture);
    expect(options.gateway).toEqual({ id: 'existing-gateway', metadata: { repo: 'owner/repo', run: 'run:delivery', ship: 'purser', attempt: 2 } });
    expect(Object.keys(options)).toEqual(['extraHeaders', 'gateway']);
    expect(options.extraHeaders['cf-aig-collect-log-payload']).toBe('false');
  });
  it('never invents a run context or changes caching/log-enable settings', () => {
    const options = shipAiOptions('existing-gateway', 'xo');
    expect(options.gateway).toEqual({ id: 'existing-gateway', metadata: { ship: 'xo' } });
    expect(options.gateway).not.toHaveProperty('skipCache');
    expect(options.gateway).not.toHaveProperty('collectLog');
  });
});
