/**
 * A6 egress-snapshot unit tests (jest). ADR-0088 Phase A test plan:
 *   - nettop / lsof output parsed DEFENSIVELY (tolerate missing fields, blank
 *     lines, version-varying columns).
 *   - flows correlate to a known PD agent via the injected spawn lookup.
 *   - a flow seen only in lsof (no bytes) or only in nettop (no binary) still
 *     surfaces — a missing field never drops the flow.
 *   - it is EVIDENCE only (no enforcement assertions — there is nothing to assert).
 */
import {
  parseLsof,
  parseNettop,
  joinFlows,
  captureEgressSnapshot,
  type EgressRunner,
  type SpawnLookup,
} from '../../lib/safe/egress-snapshot.js';
import type { KnownSpawn } from '../../lib/safe/types.js';

// ── lsof parsing ─────────────────────────────────────────────────────────────

const LSOF_OUT = [
  'COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME',
  'node    12345 test  23u  IPv4 0x111      0t0  TCP 192.168.1.2:54321->140.82.112.3:443 (ESTABLISHED)',
  'curl    67890 test  5u   IPv4 0x222      0t0  TCP 10.0.0.5:50000->1.2.3.4:443 (ESTABLISHED)',
  'sshd    11111 test  3u   IPv4 0x333      0t0  TCP *:22 (LISTEN)', // no remote → dropped
  'broken-row-with-too-few-cols',
].join('\n');

describe('parseLsof — defensive', () => {
  test('keeps only rows with an established remote endpoint', () => {
    const rows = parseLsof(LSOF_OUT);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      pid: 12345,
      command: 'node',
      remoteHost: '140.82.112.3',
      remotePort: 443,
    });
    expect(rows[1].remoteHost).toBe('1.2.3.4');
  });
  test('LISTEN sockets (no remote) and malformed lines are skipped, not thrown on', () => {
    expect(() => parseLsof(LSOF_OUT)).not.toThrow();
    const rows = parseLsof(LSOF_OUT);
    expect(rows.find((r) => r.pid === 11111)).toBeUndefined();
  });
  test('empty input → empty array', () => {
    expect(parseLsof('')).toEqual([]);
  });
});

// ── nettop parsing ───────────────────────────────────────────────────────────

const NETTOP_OUT = [
  'time,,bytes_in,bytes_out,',
  ',node.12345,,,',
  ',,140.82.112.3:443,1024,2048,',
  ',curl.67890,,,',
  ',,1.2.3.4:443,512,256,',
  '', // blank line tolerated
].join('\n');

describe('parseNettop — defensive', () => {
  test('associates flow rows to the preceding process row and sums bytes', () => {
    const rows = parseNettop(NETTOP_OUT);
    const node = rows.find((r) => r.pid === 12345);
    expect(node?.remoteHost).toBe('140.82.112.3');
    expect(node?.remotePort).toBe(443);
    expect(node?.bytes).toBe(1024 + 2048);
    const curl = rows.find((r) => r.pid === 67890);
    expect(curl?.bytes).toBe(512 + 256);
  });
  test('missing byte columns tolerated → bytes null, flow still present', () => {
    const out = [',node.999,,', ',,8.8.8.8:53,,'].join('\n');
    const rows = parseNettop(out);
    // No header → inIdx/outIdx unknown → bytes null, but the flow surfaces.
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe(999);
    expect(rows[0].remoteHost).toBe('8.8.8.8');
    expect(rows[0].bytes).toBeNull();
  });
  test('empty input → empty array', () => {
    expect(parseNettop('')).toEqual([]);
  });
});

// ── join + correlate ─────────────────────────────────────────────────────────

const KNOWN: KnownSpawn = {
  agentId: 'agent-abc',
  name: 'lookout',
  identity: 'port-daddy:lookout',
  pid: 12345,
};
const lookup: SpawnLookup = (pid) => (pid === 12345 ? KNOWN : null);

describe('joinFlows — correlate to known agents', () => {
  test('flow attributes to a known PD agent when the PID is registered', () => {
    const flows = joinFlows(parseNettop(NETTOP_OUT), parseLsof(LSOF_OUT), lookup);
    const node = flows.find((f) => f.pid === 12345);
    expect(node?.agent?.name).toBe('lookout');
    expect(node?.binary).toBe('node'); // binary from lsof
    expect(node?.bytes).toBe(3072); // bytes from nettop
    const curl = flows.find((f) => f.pid === 67890);
    expect(curl?.agent).toBeNull(); // unknown PID → bare flow
  });

  test('a flow seen only in lsof still surfaces (bytes null)', () => {
    const flows = joinFlows([], parseLsof(LSOF_OUT), lookup);
    const node = flows.find((f) => f.pid === 12345);
    expect(node).toBeDefined();
    expect(node?.binary).toBe('node');
    expect(node?.bytes).toBeNull();
  });

  test('a flow seen only in nettop still surfaces (binary null)', () => {
    const flows = joinFlows(parseNettop(NETTOP_OUT), [], lookup);
    const node = flows.find((f) => f.pid === 12345);
    expect(node).toBeDefined();
    expect(node?.binary).toBeNull();
    expect(node?.bytes).toBe(3072);
  });

  test('a throwing lookup does not crash the join (defensive)', () => {
    const throwing: SpawnLookup = () => {
      throw new Error('registry exploded');
    };
    expect(() => joinFlows(parseNettop(NETTOP_OUT), parseLsof(LSOF_OUT), throwing)).not.toThrow();
  });
});

// ── full capture with injected runner ────────────────────────────────────────

describe('captureEgressSnapshot — injected runner', () => {
  test('joins nettop+lsof and reports tool availability', () => {
    const run: EgressRunner = (cmd) => {
      if (cmd === 'nettop') return NETTOP_OUT;
      if (cmd === 'lsof') return LSOF_OUT;
      return null;
    };
    const snap = captureEgressSnapshot({ run, lookup });
    expect(snap.nettopAvailable).toBe(true);
    expect(snap.lsofAvailable).toBe(true);
    expect(snap.flows.find((f) => f.pid === 12345)?.agent?.name).toBe('lookout');
  });

  test('both tools unavailable → empty snapshot, flags false, no throw', () => {
    const snap = captureEgressSnapshot({ run: () => null, lookup });
    expect(snap.flows).toEqual([]);
    expect(snap.nettopAvailable).toBe(false);
    expect(snap.lsofAvailable).toBe(false);
  });
});
