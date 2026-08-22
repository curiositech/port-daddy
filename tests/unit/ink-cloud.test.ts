import { readInkCloudFromText } from '../../lib/local-citizen/ink-cloud.js';

describe('Ink Cloud shared matrix parser', () => {
  test('preserves legacy POSIX quoting while decoding escaped double quotes', () => {
    const cloud = readInkCloudFromText([
      'export PD_ALERT_RELEASE = "value with \\"quote\\" and \\\\ slash"',
      "PD_PHEROMONE_NOTE='single quoted value'",
      'PD_LOCK_LIB_FOO_TS=agent-1',
      'PD_ALERT_NUMERIC=42',
      'malformed line without equals',
    ].join('\n'));

    expect(cloud.alerts).toEqual({
      RELEASE: 'value with "quote" and \\ slash',
      NUMERIC: '42',
    });
    expect(cloud.pheromones).toEqual({ NOTE: 'single quoted value' });
    expect(cloud.locks).toEqual({ LIB_FOO_TS: 'agent-1' });
    expect(cloud.raw).not.toHaveProperty('malformed line without equals');
  });
});
