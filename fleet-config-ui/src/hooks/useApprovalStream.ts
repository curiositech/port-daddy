/**
 * useApprovalStream — live view of the trust gate's pending approvals over
 * the daemon's /fleet/approvals/stream WebSocket.
 *
 * websocket-streaming skill idioms:
 *   - snapshot on (re)connect rebuilds local state; deltas afterwards.
 *   - exponential-backoff reconnection (1s → 30s cap).
 *   - typed unions end-to-end; decisions ride the same socket.
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
  lastError: string | null;
  decide: (id: string, decision: 'approve' | 'reject', feedback?: string) => void;
}

function wsUrl(): string {
  const base = getDaemonUrl().replace(/\/$/, '');
  return `${base.replace(/^http/, 'ws')}/fleet/approvals/stream`;
}

export function useApprovalStream(enabled: boolean): ApprovalStreamState {
  const [proposals, setProposals] = useState<PendingApproval[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);
    };

    ws.onmessage = (raw) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(raw.data as string) as ServerEvent;
      } catch {
        return;
      }
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
    };

    ws.onclose = () => {
      setConnected(false);
      if (closedRef.current) return;
      const delay = Math.min(1000 * 2 ** attemptRef.current, 30_000);
      attemptRef.current += 1;
      setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      wsRef.current?.close();
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

  return { proposals, connected, lastError, decide };
}
