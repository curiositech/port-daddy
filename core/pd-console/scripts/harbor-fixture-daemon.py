#!/usr/bin/env python3
"""Fixture daemon for the Harbor pane (binder ch18 work order C3).

Serves the frozen F0 agent-harbor v0 shapes (ADR-0095) over the three routes
the HarborPane consumes, so the pane's roster/detail/gating/transcript states
can be exercised and captured BEFORE the real daemon ledger (work order C1)
ships. This is a **fixture** source — every evidence artifact captured against
it must be labeled `sourceLabel: fixture` in its proof manifest, never "live"
(agent-visual-evidence-manifest: the undeclared mock is the cardinal sin).

Usage:
    python3 harbor-fixture-daemon.py <port>
    PORT_DADDY_URL=http://127.0.0.1:<port> pd-console-repl
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

NODES = {
    "nodes": [
        {
            "schema": "pd.agent-harbor.agent-node.v0",
            "agentNodeId": "an-cartographer-01",
            "identity": "port-daddy:cartographer:symbol-index",
            "displayName": "Cartographer",
            "class": "voyager",
            "authority": "local",
            "complianceLevel": "C4",
            "complianceProbeId": "probe-cart-7",
            "witnessedLevel": "C4",
            "transcriptFidelity": "T4",
            "officialMode": "official",
            "status": "active",
            "currentSessionId": "sess-cart-1",
            "currentBodyId": "body-cart-1",
            "currentRunId": "run-cart-1",
            "workspace": {
                "repo": "port-daddy",
                "worktree": "/Users/op/coding/port-daddy/.claude/worktrees/symbol-index",
                "branch": "wave2/symbol-index",
            },
            "provider": "claude-code",
            "modelTier": "mid",
            "modelName": "claude-sonnet-4-5",
            "createdAt": "2026-07-05T21:40:00Z",
            "lastHeartbeatAt": "2026-07-05T21:48:10Z",
            "lastEventAt": "2m",
        },
        {
            "schema": "pd.agent-harbor.agent-node.v0",
            "agentNodeId": "an-spark-02",
            "identity": "port-daddy:spark:workers-ai",
            "displayName": "Spark",
            "class": "voyager",
            "authority": "observed",
            "complianceLevel": "C0",
            "complianceProbeId": None,
            "transcriptFidelity": "T0",
            "officialMode": "observed",
            "status": "active",
            "currentSessionId": None,
            "currentBodyId": None,
            "provider": "workers-ai",
            "modelTier": "fast",
            "createdAt": "2026-07-05T20:00:00Z",
            "lastEventAt": "23s",
        },
        {
            "schema": "pd.agent-harbor.agent-node.v0",
            "agentNodeId": "an-docs-03",
            "identity": "port-daddy:documentarian:main",
            "displayName": "Documentarian",
            "class": "longshoreman",
            "authority": "local",
            # The witnessing-invariant demo: C4 claimed, NO probe backs it —
            # the pane must gate this as C0 and say exactly why.
            "complianceLevel": "C4",
            "complianceProbeId": None,
            "transcriptFidelity": "T1",
            "officialMode": "run-log",
            "status": "complete",
            "currentSessionId": "sess-docs-9",
            "currentBodyId": None,
            "provider": "codex",
            "modelTier": "fast",
            "createdAt": "2026-07-05T19:00:00Z",
            "lastEventAt": "28m",
        },
        {
            "schema": "pd.agent-harbor.agent-node.v0",
            "agentNodeId": "an-approver-04",
            "identity": "port-daddy:approver:pr-91",
            "displayName": "Approver",
            "class": "voyager",
            "authority": "local",
            "complianceLevel": "C3",
            "complianceProbeId": "probe-appr-2",
            "witnessedLevel": "C3",
            "transcriptFidelity": "T4",
            "officialMode": "official",
            "status": "blocked",
            "currentSessionId": "sess-appr-1",
            "currentBodyId": "body-appr-1",
            "provider": "claude-code",
            "modelTier": "strong",
            "createdAt": "2026-07-05T21:00:00Z",
            "lastEventAt": "4m",
        },
        {
            "schema": "pd.agent-harbor.agent-node.v0",
            "agentNodeId": "an-qa-05",
            "identity": "port-daddy:qa:adversarial",
            "displayName": "QA",
            "class": "voyager",
            "authority": "local",
            "complianceLevel": "C4",
            "complianceProbeId": "probe-qa-3",
            "witnessedLevel": "C4",
            "transcriptFidelity": "T4",
            "officialMode": "official",
            "status": "stale",
            "currentSessionId": "sess-qa-1",
            "currentBodyId": "body-qa-1",
            "provider": "codex",
            "modelTier": "fast",
            "createdAt": "2026-07-05T18:00:00Z",
            "lastHeartbeatAt": "2026-07-05T19:02:00Z",
            "lastEventAt": "2h",
        },
    ]
}

EVENTS = {
    "events": [
        {
            "eventId": "ev-1", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 1, "occurredAt": "21:46:02", "schemaVersion": 1,
            "kind": "operator_message", "visibility": "operator",
            "payloadJson": {"text": "Index the src tree and build the import graph."},
            "redactionState": "none", "retentionPolicyId": "default",
        },
        {
            "eventId": "ev-2", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 2, "occurredAt": "21:46:04", "schemaVersion": 1,
            "kind": "assistant_message",
            "payloadJson": {"text": "Plan: walk src/, parse imports, write graph nodes. Starting with routes."},
        },
        {
            "eventId": "ev-3", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 3, "occurredAt": "21:46:05", "schemaVersion": 1,
            "kind": "tool_call",
            "payloadJson": {"summary": "read_file src/routes/feedback.ts → 284 lines"},
        },
        {
            "eventId": "ev-4", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 4, "occurredAt": "21:47:31", "schemaVersion": 1,
            "kind": "tool_denied",
            "payloadJson": {"detail": "shell git checkout -- src/ — blocked before side effects (destructive restore); offered: git stash push"},
        },
        {
            "eventId": "ev-5", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 5, "occurredAt": "21:48:00", "schemaVersion": 1,
            "kind": "file_write",
            "payloadJson": {"path": "lib/symbol-index.ts", "additions": 118, "deletions": 6},
            "payloadBlobRefs": [{"ref": "/blob/sha-abc", "mediaType": "text/x-diff", "byteCount": 4212}],
        },
        {
            "eventId": "ev-6", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 6, "occurredAt": "21:48:05", "schemaVersion": 1,
            "kind": "cost_accrued",
            "payloadJson": {
                "schema": "pd.agent-harbor.cost-accrual-event.v0",
                "costEventId": "cost-1", "agentNodeId": "an-cartographer-01",
                "meter": "tokens", "phase": "stream", "quantity": 24100,
                "unit": "output-tokens", "estimatedCostUsd": 0.04,
                "actualCostUsd": None, "occurredAt": "21:48:05",
            },
        },
        {
            "eventId": "ev-7", "sessionId": "sess-cart-1",
            "agentNodeId": "an-cartographer-01", "bodyId": "body-cart-1",
            "sequence": 7, "occurredAt": "21:48:12", "schemaVersion": 1,
            "kind": "assistant_message",
            "payloadJson": {"text": "412 of 1,840 files indexed. Hot spot: lib/db.ts imported by 19 modules."},
        },
    ]
}

CONTROLS = {
    "commands": [
        {
            "schema": "pd.agent-harbor.control-command.v0",
            "commandId": "cmd-1", "agentNodeId": "an-cartographer-01",
            "kind": "checkpoint", "requestedBy": "pd-console:operator",
            "status": "acknowledged", "createdAt": "21:45:00",
        }
    ]
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/agent-nodes") and self.path.endswith("/control"):
            self._send(200, CONTROLS)
        elif self.path.startswith("/agent-nodes"):
            self._send(200, NODES)
        elif self.path.startswith("/sessions/sess-cart-1/events"):
            self._send(200, EVENTS)
        elif self.path.startswith("/sessions/"):
            self._send(404, {"error": "unknown session"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/agent-nodes") and self.path.endswith("/control"):
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length) or b"{}")
            self._send(200, {
                "schema": "pd.agent-harbor.control-command.v0",
                "commandId": "cmd-fixture-2",
                "agentNodeId": "an-cartographer-01",
                "kind": req.get("kind", "unknown"),
                "requestedBy": req.get("requestedBy", "unknown"),
                "idempotencyKey": req.get("idempotencyKey", ""),
                "status": "queued",
                "createdAt": "now",
            })
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9967
    print(f"harbor fixture daemon on :{port} (F0 v0 shapes; label evidence 'fixture')")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
