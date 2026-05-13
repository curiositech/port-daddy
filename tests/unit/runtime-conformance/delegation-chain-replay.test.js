/**
 * RUNTIME CONFORMANCE: ProVerif chain-replay.pv ←→ lib/delegation-chain.ts
 *
 * Spec:    proofs/anchor/delegation/chain-replay.pv
 * Runtime: lib/delegation-chain.ts
 *
 * The .pv proves: a chain accepted at depth N was originally signed by
 * exactly the principal P with exactly the agent identifiers (A, B, C)
 * and exactly the message m. Replay across hops or message-substitution
 * must be rejected.
 *
 * Defense modeled: each hop signature binds
 *   hopBind(nonce, prev_id, next_id, message_hash)
 * and the verifier checks that all nonces are fresh (issued, not consumed).
 *
 * Test cases operationalize the attack patterns from the .pv:
 *
 *   (H)  Happy path: valid 3-hop chain accepted exactly once
 *   (R1) Nonce replay: re-submitting an accepted chain is rejected
 *        (consumed_nonce check)
 *   (S1) Splice: substituting hop 2 from a different chain is rejected
 *        (chain_id_mismatch + sig_verify_failed)
 *   (M1) Message substitution: changing messageHash at one hop is rejected
 *        (message_hash_mismatch + sig_verify_failed)
 *   (P1) Principal mismatch: wrong principalId claim is rejected
 *   (I1) Broken connectivity: nextId ≠ nextHop.prevId is rejected
 *   (F1) Signature tamper: flipping a byte in a hop sig is rejected
 *   (N1) Nonce not issued: forged nonce that was never issued is rejected
 *   (D1) depth-1 chain: single hop (direct principal→final) works
 *   (D5) depth-5 chain: five hops, same guarantees apply
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import {
  NonceTable,
  signHop,
  verifyDelegationChain,
  agentIdFromSeed,
  hashMessage,
  hopBindBytes,
} from '../../../lib/delegation-chain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshSeed() {
  return randomBytes(32);
}

/**
 * Build a complete N-hop delegation chain.
 *
 * seeds[0] = principal seed
 * seeds[1..N-1] = intermediate agent seeds
 * finalId = id of the final recipient (not a signer itself)
 */
function buildChain(seeds, finalId, messageHash, table) {
  const ids = seeds.map((s) => agentIdFromSeed(s));
  const hops = [];

  for (let i = 0; i < seeds.length; i++) {
    const nextId = i < seeds.length - 1 ? ids[i + 1] : finalId;
    const hop = signHop(seeds[i], nextId, messageHash, table);
    hops.push(hop);
  }

  return { hops, principalId: ids[0] };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MESSAGE = new TextEncoder().encode('transfer:agent-A:read-logs:2026-05');

let tableH; // fresh NonceTable per test
let seedP, seedA, seedB, seedC, seedFinal;
let idP, idA, idB, idC, idFinal;
let msgHash;

beforeEach(() => {
  tableH = new NonceTable();
  seedP = freshSeed();
  seedA = freshSeed();
  seedB = freshSeed();
  seedC = freshSeed();
  seedFinal = freshSeed();
  idP = agentIdFromSeed(seedP);
  idA = agentIdFromSeed(seedA);
  idB = agentIdFromSeed(seedB);
  idC = agentIdFromSeed(seedC);
  idFinal = agentIdFromSeed(seedFinal);
  msgHash = hashMessage(MESSAGE);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtime conformance: delegation chain replay (chain-replay.pv ↔ delegation-chain.ts)', () => {
  it('(H) happy path: valid 3-hop chain is accepted', () => {
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    const result = verifyDelegationChain(
      [hop1, hop2, hop3],
      idP,
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(true);
    expect(result.rejectReason).toBeUndefined();
  });

  it('(R1) nonce replay: accepted chain is rejected on second submission', () => {
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);
    const hops = [hop1, hop2, hop3];

    const first = verifyDelegationChain(hops, idP, idFinal, msgHash, tableH);
    expect(first.ok).toBe(true);

    // Replay the same chain — all nonces are now consumed
    const second = verifyDelegationChain(hops, idP, idFinal, msgHash, tableH);
    expect(second.ok).toBe(false);
    expect(second.rejectReason).toBe('nonce_already_consumed');
    expect(second.hopIndex).toBe(0);
  });

  it('(R1b) partial replay: re-using even one nonce from a different chain is rejected', () => {
    // Build chain #1 and accept it
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);
    verifyDelegationChain([hop1, hop2, hop3], idP, idFinal, msgHash, tableH);

    // Build chain #2 but try to reuse hop1 from chain #1
    const hop2b = signHop(seedA, idB, msgHash, tableH);
    const hop3b = signHop(seedB, idFinal, msgHash, tableH);

    const result = verifyDelegationChain([hop1, hop2b, hop3b], idP, idFinal, msgHash, tableH);
    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('nonce_already_consumed');
    expect(result.hopIndex).toBe(0);
  });

  it('(S1) splice: substituting a hop signed by a different agent is rejected', () => {
    // Build two separate chains for two different messages
    const msg2 = new TextEncoder().encode('transfer:agent-A:write-logs:2026-05');
    const msgHash2 = hashMessage(msg2);

    const tableS = new NonceTable();
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    // hop2 is signed for a different message — splice attempt
    const hop2_splice = signHop(seedA, idB, msgHash2, tableS);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    // Inject hop2_splice into a chain that otherwise claims msgHash
    const result = verifyDelegationChain(
      [hop1, hop2_splice, hop3],
      idP,
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    // Rejected because hop2_splice.messageHash !== msgHash
    expect(result.rejectReason).toBe('message_hash_mismatch');
    expect(result.hopIndex).toBe(1);
  });

  it('(S2) id splice: swapping nextId/prevId to break chain connectivity is rejected', () => {
    // hop2 targets idC instead of idB — breaks the P→A→B→final connectivity
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2_wrong = signHop(seedA, idC, msgHash, tableH); // wrong next
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    const result = verifyDelegationChain(
      [hop1, hop2_wrong, hop3],
      idP,
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    // hop2_wrong.nextId = idC ≠ hop3.prevId = idB
    expect(result.rejectReason).toBe('chain_id_mismatch');
    expect(result.hopIndex).toBe(1);
  });

  it('(M1) message substitution: changing messageHash in the claim is rejected', () => {
    // Build a valid chain for msgHash
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    // Attacker claims a different message hash at verification time
    const fakeHash = hashMessage(new TextEncoder().encode('evil:payload'));
    const result = verifyDelegationChain(
      [hop1, hop2, hop3],
      idP,
      idFinal,
      fakeHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('message_hash_mismatch');
    expect(result.hopIndex).toBe(0);
  });

  it('(P1) principal mismatch: wrong principalId is rejected', () => {
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    // Claim that idA is the principal instead of idP
    const result = verifyDelegationChain(
      [hop1, hop2, hop3],
      idA, // wrong principal
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('principal_mismatch');
    expect(result.hopIndex).toBe(0);
  });

  it('(F1) signature tamper: flipping a byte in hop sig is rejected', () => {
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    // Flip byte 4 of hop2's signature
    const sigBytes = Buffer.from(hop2.sig, 'hex');
    sigBytes[4] ^= 0xff;
    const tamperedHop2 = { ...hop2, sig: sigBytes.toString('hex') };

    const result = verifyDelegationChain(
      [hop1, tamperedHop2, hop3],
      idP,
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('sig_verify_failed');
    expect(result.hopIndex).toBe(1);
  });

  it('(N1) nonce not issued: forged nonce never issued is rejected', () => {
    const hop1 = signHop(seedP, idA, msgHash, tableH);
    const hop2 = signHop(seedA, idB, msgHash, tableH);
    const hop3 = signHop(seedB, idFinal, msgHash, tableH);

    // Replace hop2's nonce with one that was never issued to tableH
    const forgedNonce = Buffer.from(randomBytes(16)).toString('hex');
    const tamperedHop2 = { ...hop2, nonce: forgedNonce };

    const result = verifyDelegationChain(
      [hop1, tamperedHop2, hop3],
      idP,
      idFinal,
      msgHash,
      tableH,
    );

    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('nonce_not_issued');
    expect(result.hopIndex).toBe(1);
  });

  it('(D1) depth-1 chain: single hop from principal to final is accepted', () => {
    const hop1 = signHop(seedP, idFinal, msgHash, tableH);

    const result = verifyDelegationChain([hop1], idP, idFinal, msgHash, tableH);

    expect(result.ok).toBe(true);
  });

  it('(D5) depth-5 chain: five hops are all verified', () => {
    const seeds = [seedP, seedA, seedB, seedC, freshSeed()];
    const { hops, principalId } = buildChain(seeds, idFinal, msgHash, tableH);

    expect(hops.length).toBe(5);

    const result = verifyDelegationChain(hops, principalId, idFinal, msgHash, tableH);
    expect(result.ok).toBe(true);
  });

  it('(D5-R) depth-5 chain replay is rejected after acceptance', () => {
    const seeds = [seedP, seedA, seedB, seedC, freshSeed()];
    const { hops, principalId } = buildChain(seeds, idFinal, msgHash, tableH);

    const first = verifyDelegationChain(hops, principalId, idFinal, msgHash, tableH);
    expect(first.ok).toBe(true);

    const second = verifyDelegationChain(hops, principalId, idFinal, msgHash, tableH);
    expect(second.ok).toBe(false);
    expect(second.rejectReason).toBe('nonce_already_consumed');
  });

  it('empty hop list is rejected', () => {
    const result = verifyDelegationChain([], idP, idFinal, msgHash, tableH);
    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe('invalid_hop_count');
  });

  it('hopBindBytes is deterministic for same inputs', () => {
    const a = hopBindBytes('nonce1', 'prev', 'next', 'mhash');
    const b = hopBindBytes('nonce1', 'prev', 'next', 'mhash');
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  it('hopBindBytes differs when any field differs', () => {
    const base = hopBindBytes('nonce1', 'prev', 'next', 'mhash');
    expect(Buffer.from(hopBindBytes('NONCE1', 'prev', 'next', 'mhash')).toString('hex')).not.toBe(
      Buffer.from(base).toString('hex'),
    );
    expect(Buffer.from(hopBindBytes('nonce1', 'PREV', 'next', 'mhash')).toString('hex')).not.toBe(
      Buffer.from(base).toString('hex'),
    );
    expect(Buffer.from(hopBindBytes('nonce1', 'prev', 'NEXT', 'mhash')).toString('hex')).not.toBe(
      Buffer.from(base).toString('hex'),
    );
    expect(Buffer.from(hopBindBytes('nonce1', 'prev', 'next', 'MHASH')).toString('hex')).not.toBe(
      Buffer.from(base).toString('hex'),
    );
  });

  it('agentIdFromSeed returns consistent id for the same seed', () => {
    const id1 = agentIdFromSeed(seedP);
    const id2 = agentIdFromSeed(seedP);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64); // 32-byte public key as hex
  });

  it('agentIdFromSeed returns different ids for different seeds', () => {
    expect(agentIdFromSeed(seedP)).not.toBe(agentIdFromSeed(seedA));
  });
});
