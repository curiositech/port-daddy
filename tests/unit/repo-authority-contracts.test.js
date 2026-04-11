import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../setup-unit.js';
import {
  createHarborTokens,
  HARBOR_TOKEN_PHASE2_VERSION,
} from '../../lib/harbor-tokens.js';

const graphEdgesSource = readFileSync(new URL('../../lib/graph-edges.ts', import.meta.url), 'utf8');
const harborTokensSource = readFileSync(new URL('../../lib/harbor-tokens.ts', import.meta.url), 'utf8');

const roadmapText = readFileSync(new URL('../../docs/V4-UNIFIED-ROADMAP.md', import.meta.url), 'utf8');
const securityText = readFileSync(new URL('../../docs/SECURITY_SOUNDNESS.md', import.meta.url), 'utf8');
const whitepaperText = readFileSync(new URL('../../docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md', import.meta.url), 'utf8');

function decodeTokenSegment(token, index) {
  return JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8'));
}

describe('repo authority contracts', () => {
  test('graph_edges exists in code and roadmap authority no longer describes it as missing', () => {
    expect(graphEdgesSource).toMatch(/CREATE TABLE IF NOT EXISTS graph_edges/);
    expect(graphEdgesSource).toMatch(/idx_graph_edges_unique/);
    expect(roadmapText).toMatch(/graph_edges/);

    for (const pattern of [
      /\[NEXT — NO COMMITS YET, SOME STUBS BUILT\]/i,
      /not yet wired into server\.ts/i,
      /built but not wired/i,
      /waiting for the graph proper to land/i,
      /nobody built the graph table/i,
      /graph_edges migration remains a 1-hour task/i,
    ]) {
      expect(roadmapText).not.toMatch(pattern);
    }
  });

  test('active harbor issuance is phase 2 Ed25519 and HS256 stays compatibility-only', async () => {
    const db = createTestDb();

    try {
      const harborTokens = createHarborTokens(db);
      await harborTokens.initDaemonIdentity();

      const token = await harborTokens.issueHarborCard({
        agentId: 'agent-truth-guard',
        harborName: 'truth:guard',
        capabilities: ['docs:write'],
        lastHeartbeat: Date.now(),
      });

      const header = decodeTokenSegment(token, 0);
      const payload = decodeTokenSegment(token, 1);

      expect(header.alg).toBe('EdDSA');
      expect(payload.hv).toBe(HARBOR_TOKEN_PHASE2_VERSION);
      await expect(harborTokens.verifyHarborCard(token, 'truth:guard')).resolves.not.toBeNull();
      await expect(harborTokens.verifyLegacyPhase1HarborCard(token, 'truth:guard')).resolves.toBeNull();
    } finally {
      db.close();
    }

    expect(harborTokensSource).toMatch(/Phase 2 active path/i);
    expect(harborTokensSource).toMatch(/New issuance never falls back to HS256/);
    expect(harborTokensSource).toMatch(/strictly for compatibility/i);

    expect(securityText).not.toMatch(/HS256 \(and soon, asymmetric Ed25519\)/i);
    expect(whitepaperText).not.toMatch(/Each Harbor is assigned a unique Ed25519 keypair/i);
    expect(whitepaperText).not.toMatch(/Port Daddy v4 introduces multi-hop delegation/i);

    for (const [path, text] of [
      ['docs/SECURITY_SOUNDNESS.md', securityText],
      ['docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md', whitepaperText],
    ]) {
      if (/HS256/.test(text)) {
        expect(/Phase 1|legacy|compatibility/i.test(text)).toBe(true);
      }
      if (/Ed25519|EdDSA/.test(text)) {
        expect(/Current runtime|Design target|target architecture|Phase 2/i.test(text)).toBe(true);
      }
    }
  });
});
