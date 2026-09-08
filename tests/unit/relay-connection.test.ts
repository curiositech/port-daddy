/**
 * Honest-status contract of the daemon relay connection lifecycle
 * (lib/relay-connection.ts + the RelayConnectionManager it drives).
 *
 * The one property everything here defends: the status surface NEVER claims
 * connected when it is not. Concretely —
 *   - no relay_url            → disabled, connected false, no loop
 *   - no card                 → backoff with NO_CARD, handshake never attempted
 *   - handshake succeeded     → session facts recorded, connected STILL false
 *                               (the stream is not open yet — this window is
 *                               the exact lie the old stub refused to tell)
 *   - SSE stream accepted     → connected true, and only now
 *   - stream error / stop     → connected false immediately
 *
 * All collaborators are injected (fake handshake, fake subscribe, captured
 * sleep), so these are state-machine proofs, not network tests.
 */

import { describe, it, expect, jest } from '@jest/globals';
import Database from 'better-sqlite3';

import { DaemonRelayConnection } from '../../lib/relay-connection.js';
import {
  RelayConnectionManager,
  RelayError,
  RELAY_RECONNECT_MIN_MS,
  setRelayUrl,
  setRelayCard,
  getRelayUrl,
  getRelayCard,
  type ServerHello,
  type RelaySubscription,
  subscribeRelay,
} from '../../lib/relay-client.js';
import { relayReadableEvent, type EnvelopeSigner } from '../../lib/relay-seal.js';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';

/** Let queued microtasks + immediates drain so async lifecycle steps settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const HELLO: ServerHello = {
  v: 1,
  server_hello: true,
  session_id: 'sess-1',
  nonce_c: 'nc',
  nonce_s: 'ns',
  accepted_subs: [{ channel: 'h:ops:deploys', tip_seq: null, tip_hash: null }],
  rejected_subs: [],
  sig: 'aa',
  relay_pub_key: 'bb',
};

type SubscribeFn = typeof subscribeRelay;

/**
 * A subscribe fake that hands the test the stream's control levers (onOpen /
 * onError) instead of opening anything, so the test decides when the stream
 * "opens" and when it dies.
 */
function makeSubscribeCapture() {
  const captured: { onOpen?: () => void; onError?: (err: Error) => void; calls: number } = {
    calls: 0,
  };
  const subscribeFn: SubscribeFn = (_url, _sid, _seq, _onEvent, onError, onOpen) => {
    captured.calls += 1;
    captured.onOpen = onOpen;
    captured.onError = onError;
    return { close: () => {} } as RelaySubscription;
  };
  return { captured, subscribeFn };
}

/** A sleep fake that records requested delays and parks forever after `limit` calls. */
function makeSleepCapture(limit = 50) {
  const delays: number[] = [];
  const sleepFn = (ms: number): Promise<void> => {
    delays.push(ms);
    if (delays.length >= limit) return new Promise<void>(() => {});
    return Promise.resolve();
  };
  return { delays, sleepFn };
}

function makeDb(): InstanceType<typeof Database> {
  return new Database(':memory:');
}

const failingSigner = async () => {
  throw new Error('signer must not be reached in this test');
};

describe('DaemonRelayConnection — honest status lifecycle', () => {
  it('reports disabled (never connected) when relay_url is unconfigured', () => {
    const db = makeDb();
    // PREMISE: nothing configured.
    expect(getRelayUrl(db)).toBeNull();

    const conn = new DaemonRelayConnection({ db, signer: failingSigner });
    conn.start();
    const status = conn.getStatus();
    expect(status.state).toBe('disabled');
    expect(status.connected).toBe(false);
    expect(status.session_id).toBeNull();
  });

  it('reports NO_CARD backoff — and never attempts a handshake — without a stored card', async () => {
    const db = makeDb();
    setRelayUrl(db, 'https://relay.example');
    // PREMISE: url present, card absent.
    expect(getRelayUrl(db)).toBe('https://relay.example');
    expect(getRelayCard(db)).toBeNull();

    const handshake = jest.fn<() => Promise<ServerHello>>();
    const { sleepFn } = makeSleepCapture(3);
    const conn = new DaemonRelayConnection({
      db,
      signer: failingSigner,
      handshake: handshake as never,
      managerOptions: { subscribeFn: makeSubscribeCapture().subscribeFn, sleepFn },
    });
    conn.start();
    await settle();

    const status = conn.getStatus();
    expect(status.connected).toBe(false);
    expect(status.state).toBe('backoff');
    expect(status.last_error).toBe('NO_CARD');
    expect(handshake).not.toHaveBeenCalled();
    conn.stop();
  });

  it('never claims connected on handshake success alone; flips on stream open; drops on error', async () => {
    const db = makeDb();
    setRelayUrl(db, 'https://relay.example');
    setRelayCard(db, 'card-jwt');

    const handshake = jest.fn(async (..._args: unknown[]) => HELLO);
    const { captured, subscribeFn } = makeSubscribeCapture();
    // Park the loop at its FIRST backoff sleep so the post-error state is
    // observable before the manager legitimately re-enters 'connecting'.
    const { sleepFn } = makeSleepCapture(1);
    const conn = new DaemonRelayConnection({
      db,
      signer: async () => 'sig',
      handshake: handshake as never,
      managerOptions: { subscribeFn, sleepFn },
    });

    conn.start();
    await settle();

    // PREMISE: the handshake ran (with our card) and the stream was requested.
    expect(handshake).toHaveBeenCalledTimes(1);
    expect(handshake.mock.calls[0][1]).toBe('card-jwt');
    expect(captured.calls).toBe(1);

    // THE HONESTY WINDOW: session facts are known, the stream is NOT open.
    let status = conn.getStatus();
    expect(status.session_id).toBe('sess-1');
    expect(status.last_handshake).not.toBeNull();
    expect(status.accepted_channels).toEqual(['h:ops:deploys']);
    expect(status.connected).toBe(false);

    // Stream accepted → connected, and last_error clears.
    captured.onOpen?.();
    status = conn.getStatus();
    expect(status.connected).toBe(true);
    expect(status.state).toBe('connected');
    expect(status.last_error).toBeNull();

    // Stream dies → connected false immediately, with the error code visible.
    captured.onError?.(new RelayError('SSE_CLOSED', 'closed'));
    await settle();
    status = conn.getStatus();
    expect(status.connected).toBe(false);
    expect(status.state).toBe('backoff');
    expect(status.last_error).toBe('SSE_CLOSED');

    conn.stop();
    expect(conn.getStatus().state).toBe('stopped');
    expect(conn.getStatus().connected).toBe(false);
  });

  it('records the handshake failure code and stays disconnected', async () => {
    const db = makeDb();
    setRelayUrl(db, 'https://relay.example');
    setRelayCard(db, 'card-jwt');

    const handshake = jest.fn(async () => {
      throw new RelayError('RELAY_KEY_CHANGED', 'pin mismatch');
    });
    const { sleepFn, delays } = makeSleepCapture(2);
    const conn = new DaemonRelayConnection({
      db,
      signer: async () => 'sig',
      handshake: handshake as never,
      managerOptions: { subscribeFn: makeSubscribeCapture().subscribeFn, sleepFn },
    });
    conn.start();
    await settle();

    // PREMISE: the failure really happened and the loop backed off.
    expect(handshake).toHaveBeenCalled();
    expect(delays.length).toBeGreaterThan(0);

    const status = conn.getStatus();
    expect(status.connected).toBe(false);
    expect(status.state).toBe('backoff');
    expect(status.last_error).toBe('RELAY_KEY_CHANGED');
    conn.stop();
  });

  it('publish refuses when the relay is disabled, before touching any network', async () => {
    const db = makeDb();
    // PREMISE: no relay_url.
    expect(getRelayUrl(db)).toBeNull();

    const seed = Buffer.from('11'.repeat(32), 'hex');
    const priv = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const signer: EnvelopeSigner = {
      keyIdHex: (createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer)
        .subarray(-32)
        .toString('hex'),
      signHex: async (msgHex) => cryptoSign(null, Buffer.from(msgHex, 'hex'), priv).toString('hex'),
    };
    const classified = await relayReadableEvent({
      routing: { harbor: 'h', channel: 'h:ops:deploys', sender: 'f'.repeat(64), seq: 1, iat: 1 },
      payload: {},
      reason: 'test stream: synthetic payload with no operator data',
      signer,
    });

    const conn = new DaemonRelayConnection({ db, signer: failingSigner });
    await expect(
      conn.publish(classified, { prevHash: '0'.repeat(64), thisHash: '1'.repeat(64), sig: 'aa' })
    ).rejects.toMatchObject({ code: 'RELAY_DISABLED' });
  });
});

describe('RelayConnectionManager — backoff resets on an ACCEPTED stream, not before', () => {
  it('after a failure the delay grows; after an accepted stream it starts over at the minimum', async () => {
    const sessions: Array<{ sessionId: string; fromSeq: number } | null> = [
      null, // first attempt: no session → sleep(min), delay doubles
      { sessionId: 's', fromSeq: 0 }, // second: session + stream opens, then dies
      null, // third: parks the loop via the sleep capture below
    ];
    let call = 0;
    const getSession = async () => sessions[Math.min(call++, sessions.length - 1)];

    const delays: number[] = [];
    let manager: RelayConnectionManager | undefined;
    const sleepFn = (ms: number): Promise<void> => {
      delays.push(ms);
      if (delays.length >= 3) {
        manager?.stop();
        return new Promise<void>(() => {});
      }
      return Promise.resolve();
    };
    const subscribeFn: SubscribeFn = (_u, _s, _f, _onEvent, onError, onOpen) => {
      // The stream is ACCEPTED (this is what resets the backoff)…
      onOpen?.();
      // …and then dies, sending the loop back around.
      queueMicrotask(() => onError(new RelayError('SSE_CLOSED', 'closed')));
      return { close: () => {} } as RelaySubscription;
    };

    manager = new RelayConnectionManager(
      'https://relay.example',
      getSession,
      () => {},
      undefined,
      { subscribeFn, sleepFn }
    );
    manager.start();
    await settle();
    await settle();

    // PREMISE: all three phases ran — a no-session backoff, then a stream.
    expect(delays.length).toBeGreaterThanOrEqual(2);
    // First sleep: the base delay after the no-session attempt.
    expect(delays[0]).toBe(RELAY_RECONNECT_MIN_MS);
    // Second sleep: WITHOUT the reset this would be 2 * min (the delay had
    // doubled after the first failure). The accepted stream reset it.
    expect(delays[1]).toBe(RELAY_RECONNECT_MIN_MS);
  });
});
