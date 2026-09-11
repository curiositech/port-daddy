import { describe, expect, test } from '@jest/globals';
import { compareAuditBaseline, highSeverityAdvisories } from '../../scripts/check-npm-audit.mjs';

const via = (source, name, severity = 'high') => ({
  source,
  name,
  severity,
  url: `https://github.com/advisories/GHSA-${source}`,
});

describe('npm audit baseline gate', () => {
  test('extracts and de-duplicates only high and critical advisory records', () => {
    const high = via(123, 'danger');
    const report = {
      vulnerabilities: {
        danger: { via: [high, 'transitive-name'] },
        duplicate: { via: [high] },
        moderate: { via: [via(456, 'less-danger', 'moderate')] },
      },
    };
    expect(highSeverityAdvisories(report)).toEqual([{
      id: '123',
      package: 'danger',
      severity: 'high',
      url: 'https://github.com/advisories/GHSA-123',
    }]);
  });

  test('fails closed on new, resolved, or changed advisories', () => {
    const baseline = [
      { id: '1', package: 'same', severity: 'high', url: 'one' },
      { id: '2', package: 'resolved', severity: 'high', url: 'two' },
      { id: '3', package: 'changed', severity: 'high', url: 'three' },
    ];
    const current = [
      baseline[0],
      { ...baseline[2], severity: 'critical' },
      { id: '4', package: 'new', severity: 'high', url: 'four' },
    ];
    expect(compareAuditBaseline(current, baseline)).toEqual({
      added: [current[2]],
      resolved: [baseline[1]],
      changed: [current[1]],
    });
  });
});
