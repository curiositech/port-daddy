/**
 * useApprovalStream — live view of the trust gate's pending approvals over
 * the daemon's /fleet/approvals/stream WebSocket.
 *
 * Realtime idioms (websocket-streaming + websocket-realtime-expert skills):
 *   - snapshot on (re)connect rebuilds local state; deltas afterwards.
 *   - exponential-backoff reconnection WITH JITTER (1s → 30s cap; jitter
 *     prevents synchronized reconnect stampedes after a daemon restart).
 *   - typed unions end-to-end; decisions ride the same socket.
 *   - graceful degradation: after 3 consecutive failed WebSocket attempts
 *     (e.g. a webview that blocks upgrades), fall back to the SSE feed at
 *     /fleet/approvals/events; decisions then go through REST.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDaemonUrl } from '../api';

export interface PendingApproval {
  id: string;
  project: string;
  agent: string;
  trigger: string;
  tier: string;
  reason: string;
  safeTools: string[];
  timestamp: number;
}

type ServerEvent =
  | { type: 'snapshot'; proposals: PendingApproval[] }
  | { type: 'human_gate_waiting'; proposal: PendingApproval }
  | { type: 'human_gate_resolved'; id: string; decision: 'approve' | 'reject'; resolvedBy: string; detail?: string }
  | { type: 'error'; id?: string; message: string };

export interface ApprovalStreamState {
  proposals: PendingApproval[];
  connected: boolean;
  /** Active transport: ws normally, sse when upgrades are blocked. */
  transport: 'ws' | 'sse';
  lastError: string | null;
  decide: (id: string, decision: 'approve' | 'reject', feedback?: string) => void;
}

function wsUrl(): string {
  const base = getDaemonUrl().replace(/\/$/, '');
  return `${base.replace(/^http/, 'ws')}/fleet/approvals/stream`;
}

/** Failed WS attempts before degrading to SSE. */
const WS_ATTEMPTS_BEFORE_SSE = 3;

export function useApprovalStream(enabled: boolean): ApprovalStreamState {
  const [proposals, setProposals] = useState<PendingApproval[]>([]);
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<'ws' | 'sse'>('ws');
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const attemptRef = useRef(0);
  const openedOnceRef = useRef(false);
  const closedRef = useRef(false);

  const applyEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'snapshot':
        setProposals(event.proposals);
        break;
      case 'human_gate_waiting':
        setProposals((prev) =>
          prev.some((p) => p.id === event.proposal.id) ? prev : [...prev, event.proposal],
        );
        break;
      case 'human_gate_resolved':
        setProposals((prev) => prev.filter((p) => p.id !== event.id));
        setLastError(null);
        break;
      case 'error':
        setLastError(event.message);
        break;
    }
  }, []);

  const connectSse = useCallback(() => {
    if (closedRef.current) return;
    setTransport('sse');
    const source = new EventSource(`${getDaemonUrl().replace(/\/$/, '')}/fleet/approvals/events`);
    sseRef.current = source;
    source.onopen = () => setConnected(true);
    source.onmessage = (raw) => {
      try {
        applyEvent(JSON.parse(raw.data as string) as ServerEvent);
      } catch {
        // skip malformed frame
      }
    };
    // EventSource reconnects itself; just reflect the state.
    source.onerror = () => setConnected(false);
  }, [applyEvent]);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      connectSse();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      openedOnceRef.current = true;
      setConnected(true);
    };

    ws.onmessage = (raw) => {
      try {
        applyEvent(JSON.parse(raw.data as string) as ServerEvent);
      } catch {
        // skip malformed frame
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (closedRef.current) return;
      attemptRef.current += 1;
      // A WS that has NEVER opened after several tries is likely blocked
      // (webview/proxy) — degrade to SSE rather than retrying forever.
      if (!openedOnceRef.current && attemptRef.current >= WS_ATTEMPTS_BEFORE_SSE) {
        connectSse();
        return;
      }
      // Exponential backoff with jitter (0.5×–1× the window) so a fleet of
      // dashboards doesn't stampede a restarting daemon in lockstep.
      const window = Math.min(1000 * 2 ** (attemptRef.current - 1), 30_000);
      const delay = window * (0.5 + Math.random() * 0.5);
      setTimeout(connect, delay);
    };
  }, [applyEvent, connectSse]);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
      sseRef.current?.close();
    };
  }, [enabled, connect]);

  const decide = useCallback((id: string, decision: 'approve' | 'reject', feedback?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'human_decision', id, decision, feedback }));
      return;
    }
    // Socket down: fall back to the REST decision endpoint.
    void fetch(`${getDaemonUrl().replace(/\/$/, '')}/fleet/approvals/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, feedback }),
    }).then(async (res) => {
      if (res.ok) setProposals((prev) => prev.filter((p) => p.id !== id));
      else setLastError((await res.json().catch(() => ({ error: `HTTP ${res.status}` }))).error);
    }).catch((err: Error) => setLastError(err.message));
  }, []);

  return { proposals, connected, transport, lastError, decide };
}
