/**
 * Daemon relay connection — the lifecycle that replaces the honest-
 * disconnected stub in server.ts (ADR-0049; WS-A cluster R, C1).
 *
 * WHAT THIS OWNS. One outbound connection from the local daemon to the
 * configured relay: handshake (ClientHello → ServerHello with TOFU key
 * pinning, via lib/relay-client.ts), the SSE subscribe stream, exponential
 * backoff on every failure, and — the part the stub existed to protect — an
 * HONEST status surface. `pd relay status` reads {@link getStatus}, and the
 * design rule is that `connected: true` is asserted only while the relay has
 * an ACCEPTED SSE stream open to this daemon: it flips true on the stream's
 * open signal (HTTP 200 on the subscribe fetch, surfaced by subscribeRelay's
 * onOpen) and false the instant the stream errors, closes, or the manager
 * stops. Handshake success alone never reports connected; intent never
 * reports as evidence.
 *
 * WHY A CLASS AROUND RelayConnectionManager instead of using it bare: the
 * manager owns retry mechanics; it deliberately knows nothing about where the
 * relay URL, harbor card, or signing identity live, and nothing about status.
 * This module binds those to the daemon's config table and identity, and
 * turns the manager's callbacks into a truthful state machine
 * (disabled | connecting | connected | backoff | stopped).
 *
 * SEND BOUNDARY (S1). {@link publish} is the daemon's ONLY public entry to
 * the relay publish wire, and it takes a {@link ClassifiedRelayEvent} — the
 * branded product of the lib/relay-seal.ts classification chokepoint. The
 * transit slot is filled from the classified value inside this method and
 * re-validated at runtime, so an unclassified event cannot reach the wire by
 * construction: there is no parameter through which one could be passed.
 */

import type { Database } from 'better-sqlite3';

import {
  getRelayCard,
  getRelayUrl,
  performHandshake,
  publishToRelay,
  RelayConnectionManager,
  RelayError,
  type EventHandler,
  type RelayConnectionManagerOptions,
  type ServerHello,
} from './relay-client.js';
import { assertClassifiedTransit, type ClassifiedRelayEvent } from './relay-seal.js';

/**
 * The live status snapshot served to `pd relay status` and GET /relay/status.
 * Supersets the shape routes/relay.ts already returns (`state` and
 * `last_error` are additive), so the route's spread keeps working unchanged.
 */
export interface DaemonRelayStatus {
  /** True ONLY while an accepted SSE stream is open. Never true on intent. */
  connected: boolean;
  session_id: string | null;
  last_handshake: number | null;
  accepted_channels: string[];
  relay_version: string | null;
  /** Where the lifecycle actually is — disabled (no relay_url), connecting, connected, backoff, stopped. */
  state: 'disabled' | 'connecting' | 'connected' | 'backoff' | 'stopped';
  /** Code of the most recent failure (NO_CARD, HANDSHAKE_FAILED, SSE_CLOSED, …), cleared on connect. */
  last_error: string | null;
}

/** Minimal logger shape (matches the daemon logger's info/warn/error). */
interface RelayConnectionLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Collaborators for {@link DaemonRelayConnection}.
 *
 * Design: everything with an ambient default (config reads, the real
 * handshake, real timers) is injectable so the honest-status contract is
 * testable as a state machine, not as a network integration.
 */
export interface DaemonRelayConnectionDeps {
  db: Database;
  /**
   * Signs the hex-encoded handshake digest with the daemon's Ed25519
   * identity. An interface rather than a key on purpose: the private key
   * stays in the harbor-token module / keychain ("use without see").
   */
  signer: (msgHex: string) => Promise<string>;
  logger?: RelayConnectionLogger;
  /** Channels to subscribe to. Default: all channels the card grants (relay-side wildcard). */
  subscriptions?: string[];
  /** Receives inbound relay events. Default: heartbeats and events are counted but unrouted (routing is a later slice). */
  onEvent?: EventHandler;
  /** Card source; defaults to the stored relay_card config value. */
  getCard?: () => string | null;
  /** Handshake implementation; defaults to {@link performHandshake}. Injectable for tests. */
  handshake?: typeof performHandshake;
  /** Passed through to the manager — subscribeFn/sleepFn for tests. */
  managerOptions?: Pick<RelayConnectionManagerOptions, 'subscribeFn' | 'sleepFn'>;
  /** Clock; defaults to Date.now. */
  now?: () => number;
}

/**
 * The daemon's one relay connection lifecycle. Construct once in server.ts,
 * `start()` after routes are up, `stop()` in shutdown, and hand
 * `() => connection.getStatus()` to the relay routes as their status source.
 */
export class DaemonRelayConnection {
  private manager: RelayConnectionManager | null = null;
  private started = false;

  private connected = false;
  private state: DaemonRelayStatus['state'] = 'disabled';
  private sessionId: string | null = null;
  private lastHandshake: number | null = null;
  private acceptedChannels: string[] = [];
  private relayVersion: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly deps: DaemonRelayConnectionDeps) {}

  /**
   * Begin the connection lifecycle.
   *
   * @returns Nothing — status observation happens through getStatus().
   *
   * The design rules encoded here: with no relay_url configured the state is
   * `disabled` and NO loop runs (a daemon with federation off must not spin a
   * reconnect loop against nothing). With a URL, the manager loop drives
   * handshake → stream → backoff, and every transition lands in the status
   * fields the instant it happens.
   */
  start(): void {
    if (this.started) return;

    const relayUrl = getRelayUrl(this.deps.db);
    if (!relayUrl) {
      this.state = 'disabled';
      this.connected = false;
      this.deps.logger?.info('relay_connection_disabled', { reason: 'relay_url not configured' });
      return;
    }

    this.started = true;
    this.state = 'connecting';

    const handshake = this.deps.handshake ?? performHandshake;
    const getCard = this.deps.getCard ?? (() => getRelayCard(this.deps.db));
    const now = this.deps.now ?? Date.now;
    const onEvent: EventHandler = this.deps.onEvent ?? (() => {});

    this.manager = new RelayConnectionManager(
      relayUrl,
      async () => {
        const card = getCard();
        if (!card) {
          // No card = cannot even attempt a handshake. Report it as the
          // precise blocker instead of a generic failure so `pd relay status`
          // tells the operator the actual next step (run the exchange).
          this.noteFailure('NO_CARD');
          return null;
        }
        this.state = 'connecting';
        try {
          const hello: ServerHello = await handshake(
            relayUrl,
            card,
            this.deps.subscriptions ?? [],
            this.deps.signer,
            this.deps.db
          );
          // Handshake success updates session facts but does NOT set
          // connected — the stream is not open yet, and saying so here would
          // be exactly the dishonesty the stub refused to commit.
          this.sessionId = hello.session_id;
          this.lastHandshake = now();
          this.acceptedChannels = hello.accepted_subs.map((s) => s.channel);
          this.deps.logger?.info('relay_handshake_ok', {
            session_id: hello.session_id,
            accepted: this.acceptedChannels.length,
            rejected: hello.rejected_subs.length,
          });
          // fromSeq 0: resume-cursor persistence is a later slice; today every
          // (re)connect replays from the relay's floor rather than lying about
          // a cursor the daemon does not durably track.
          return { sessionId: hello.session_id, fromSeq: 0 };
        } catch (err) {
          const code = err instanceof RelayError ? err.code : 'HANDSHAKE_FAILED';
          this.noteFailure(code, err);
          return null;
        }
      },
      onEvent,
      () => {
        // Stream gone — connected turns false BEFORE any retry timing runs.
        this.connected = false;
        if (this.state !== 'stopped') this.state = 'backoff';
      },
      {
        ...this.deps.managerOptions,
        onConnect: () => {
          this.connected = true;
          this.state = 'connected';
          this.lastError = null;
          this.deps.logger?.info('relay_stream_open', { session_id: this.sessionId });
        },
        onError: (err) => {
          const code = err instanceof RelayError ? err.code : 'SSE_ERROR';
          this.noteFailure(code, err);
        },
      }
    );
    this.manager.start();
  }

  /**
   * Tear the connection down. Why status flips first: a stopping daemon must
   * not advertise a live federation link, so stopped/disconnected is reported
   * the moment teardown begins.
   *
   * @returns Nothing — the manager and status fields are reset in place.
   */
  stop(): void {
    this.manager?.stop();
    this.manager = null;
    this.started = false;
    this.connected = false;
    this.state = 'stopped';
  }

  /**
   * Re-evaluate configuration and reconnect. Its purpose: relay_url or the
   * stored card can change at runtime (POST /relay/config, POST
   * /relay/exchange), and an operator's config write must take effect without
   * a daemon restart.
   *
   * @returns Nothing — the lifecycle restarts against current config.
   */
  restart(): void {
    this.stop();
    this.state = 'disabled';
    this.lastError = null;
    this.start();
  }

  /**
   * Snapshot the live status. Why a fresh object every call: the route
   * serializes it, and shared mutable state leaking through a JSON boundary
   * is how status surfaces drift from truth.
   *
   * @returns The current DaemonRelayStatus, decoupled from internal state.
   */
  getStatus(): DaemonRelayStatus {
    return {
      connected: this.connected,
      session_id: this.sessionId,
      last_handshake: this.lastHandshake,
      accepted_channels: [...this.acceptedChannels],
      relay_version: this.relayVersion,
      state: this.state,
      last_error: this.lastError,
    };
  }

  /**
   * Publish a CLASSIFIED event to the relay — the daemon's only public entry
   * to the publish wire (S1).
   *
   * Why the parameter split: the envelope inside `classified` already carries
   * the signed routing tuple (sender, channel, seq, iat), so this method
   * derives the frame's routing from it — a caller cannot publish an envelope
   * under a frame that contradicts it. Only the chain linkage (prev_hash,
   * this_hash, frame sig), which lives with the per-channel chain state
   * owner, is taken from the caller.
   *
   * @param classified The chokepoint's product; there is no raw-body overload.
   * @param chain Chain-frame linkage for this event.
   * @param auth Optional card / Authorization header for the relay.
   * @returns The relay's acknowledgment (seq, this_hash).
   */
  async publish(
    classified: ClassifiedRelayEvent,
    chain: { prevHash: string; thisHash: string; sig: string },
    auth?: { card?: string; authHeader?: string }
  ): Promise<{ seq: number; this_hash: string }> {
    const relayUrl = getRelayUrl(this.deps.db);
    if (!relayUrl) {
      throw new RelayError('RELAY_DISABLED', 'relay_url not configured; cannot publish');
    }
    // Runtime re-check of the compile-time brand: a cast past ClassifiedTransit
    // dies here, before any bytes leave the daemon.
    const envelope = assertClassifiedTransit(classified.transit);
    return publishToRelay(relayUrl, {
      event: {
        v: 1,
        sender: envelope.sender,
        channel: envelope.channel,
        seq: envelope.seq,
        prev_hash: chain.prevHash,
        this_hash: chain.thisHash,
        iat: envelope.iat,
        ciphertext: classified.transit,
        sig: chain.sig,
      },
      card: auth?.card,
      authHeader: auth?.authHeader,
    });
  }

  /**
   * Record a failure truthfully — the purpose is that no failure path can
   * leave `connected` stale: connected drops, state backs off, the code lands
   * in last_error.
   *
   * @param code Stable failure code surfaced to the status route.
   * @param err The underlying error, logged but never thrown onward.
   * @returns Nothing — status fields are the output.
   */
  private noteFailure(code: string, err?: unknown): void {
    this.connected = false;
    if (this.state !== 'stopped') this.state = 'backoff';
    this.lastError = code;
    this.deps.logger?.warn('relay_connection_error', {
      code,
      error: err instanceof Error ? err.message : err === undefined ? undefined : String(err),
    });
  }
}
