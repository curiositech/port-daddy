// tests/unit/purser/transcript-event-ordering.test.ts
//
// This test validates the contract clause:
// “Transcript events must be displayed in chronological order …”
// by asserting that the fixture‑provided transcript arrays are already
// sorted by their timestamp strings.  If any agent’s events are out of
// order the test will fail, forcing the implementation to enforce
// chronological ordering (e.g. via sorting before rendering).

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

type TranscriptEvent = {
  id: string;
  timestamp: string; // ISO‑8601 or similar parsable format
  kind: string;
  text: string;
};

type DurableAgent = {
  id: string;
  name: string;
  initials: string;
  state: string;
  statusLine: string;
  ageSeconds?: number | null;
  following: boolean;
  durable: boolean;
  lineage?: string | null;
  body?: string | null;
  contextPercent?: number | null;
  costUSD?: number | null;
  transcript: TranscriptEvent[];
};

type AgentRoster = {
  note?: string;
  agents: DurableAgent[];
};

describe('Transcript ordering contract', () => {
  // Resolve the path to the agents fixture JSON relative to this test file.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fixturePath = join(
    __dirname,
    '../../../apps/pd-ios/PortDaddy/agents.fixture.json'
  );

  let roster: AgentRoster;

  beforeAll(async () => {
    const raw = await readFile(fixturePath, { encoding: 'utf8' });
    roster = JSON.parse(raw) as AgentRoster;
  });

  test('each agent transcript is sorted chronologically', () => {
    // Basic shape guards – if the fixture is malformed we want a clear error.
    expect(roster).toBeDefined();
    expect(Array.isArray(roster.agents)).toBe(true);

    const agentsWithBadOrder: string[] = [];

    for (const agent of roster.agents) {
      const { transcript, id } = agent;

      // Empty or single‑item transcripts are trivially ordered.
      if (!Array.isArray(transcript) || transcript.length <= 1) continue;

      // Convert timestamps to numeric epoch values.
      const times = transcript.map((e) => {
        const ms = Date.parse(e.timestamp);
        if (Number.isNaN(ms)) {
          throw new Error(
            `Agent "${id}" contains an unparseable timestamp: "${e.timestamp}"`
          );
        }
        return ms;
      });

      // Verify non‑decreasing order.
      for (let i = 1; i < times.length; i++) {
        if (times[i] < times[i - 1]) {
          agentsWithBadOrder.push(id);
          break;
        }
      }
    }

    // The contract demands *no* out‑of‑order events.
    expect(agentsWithBadOrder).toEqual([]);
  });
});