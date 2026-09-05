#!/usr/bin/env python3
"""Stdlib-only local driver for Porthole's picker-gated control socket."""

from __future__ import annotations

import argparse
import json
import os
import socket
import uuid
from pathlib import Path
from typing import Any

MAX_REQUEST_BYTES = 32 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_SCENARIO_BYTES = 64 * 1024
MAX_BATCH_STEPS = 64


def default_socket() -> str:
    return str(Path.home() / "Library" / "Application Support" / "Porthole" / "control.sock")


def request_id() -> str:
    return str(uuid.uuid4())


def send_request(socket_path: str, request: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
    payload = json.dumps(request, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"
    if len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("request exceeds the 32768-byte protocol bound")
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(timeout_seconds)
    try:
        client.connect(socket_path)
        client.sendall(payload)
        response = bytearray()
        while len(response) <= MAX_RESPONSE_BYTES:
            chunk = client.recv(4096)
            if not chunk:
                break
            response.extend(chunk)
            if b"\n" in chunk:
                break
    finally:
        client.close()
    if len(response) > MAX_RESPONSE_BYTES:
        raise ValueError("response exceeds the 65536-byte protocol bound")
    line = bytes(response).split(b"\n", 1)[0]
    if not line:
        raise RuntimeError("Porthole closed the socket without a receipt")
    decoded = json.loads(line)
    if not isinstance(decoded, dict) or decoded.get("schema") != "pd.porthole.local-control-response.v1":
        raise RuntimeError("Porthole returned an invalid receipt envelope")
    return decoded


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Control one already-running Porthole process without enumerating any source catalog."
    )
    parser.add_argument("--socket", default=default_socket(), help="absolute Porthole control socket path")
    parser.add_argument("--timeout", type=float, default=45.0, help="driver transport deadline, 1-45 seconds")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("ping", "status", "pending-review", "cancel-review", "list-approved",
                 "start", "pause", "resume", "stop"):
        sub.add_parser(name)

    picker = sub.add_parser("open-picker")
    picker.add_argument("kind", choices=("window", "application"))

    approve = sub.add_parser("approve")
    approve.add_argument("review_id")
    approve.add_argument("--scope", required=True,
                         choices=("exact-window", "running-instance", "signed-program"))
    approve.add_argument("--preview", action="store_true")
    approve.add_argument("--live-share", action="store_true")
    approve.add_argument("--persist-recording", action="store_true")

    for name in ("select", "revoke"):
        command = sub.add_parser(name)
        command.add_argument("approval_id")

    still = sub.add_parser("still")
    still.add_argument("output_directory")

    record = sub.add_parser("record")
    record.add_argument("output_directory")
    record.add_argument("--duration", required=True, type=float)

    for name in ("wait", "assert"):
        command = sub.add_parser(name)
        command.add_argument("--lifecycle",
                             choices=("idle", "ready", "live", "paused", "stopped", "permission-denied", "failed"))
        command.add_argument("--minimum-frame-count", type=int)
        command.add_argument("--wait-timeout-ms", type=int)

    batch = sub.add_parser("batch")
    batch.add_argument("scenario", help="JSON file containing a list of 1-64 request objects")
    return parser


def build_request(args: argparse.Namespace) -> dict[str, Any]:
    request: dict[str, Any] = {"id": request_id(), "command": args.command}
    if args.command == "open-picker":
        request["sourceKind"] = args.kind
    elif args.command == "approve":
        capabilities = {
            "preview": args.preview,
            "liveShare": args.live_share,
            "persistRecording": args.persist_recording,
        }
        if not any(capabilities.values()):
            raise ValueError("approve requires at least one explicit capability flag")
        request.update(reviewID=args.review_id, scope=args.scope, capabilities=capabilities)
    elif args.command in ("select", "revoke"):
        request["approvalID"] = args.approval_id
    elif args.command == "still":
        request["outputDirectory"] = absolute_new_leaf(args.output_directory)
    elif args.command == "record":
        request["outputDirectory"] = absolute_new_leaf(args.output_directory)
        request["durationSeconds"] = args.duration
    elif args.command in ("wait", "assert"):
        if args.lifecycle is None and args.minimum_frame_count is None:
            raise ValueError("wait/assert requires --lifecycle or --minimum-frame-count")
        if args.lifecycle is not None:
            request["lifecycle"] = args.lifecycle
        if args.minimum_frame_count is not None:
            request["minimumFrameCount"] = args.minimum_frame_count
        if args.wait_timeout_ms is not None:
            request["timeoutMilliseconds"] = args.wait_timeout_ms
    elif args.command == "batch":
        request["steps"] = load_scenario(args.scenario)
    return request


def absolute_new_leaf(raw: str) -> str:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return str(path.resolve(strict=False))


def load_scenario(raw_path: str) -> list[dict[str, Any]]:
    path = Path(raw_path).expanduser().resolve(strict=True)
    data = path.read_bytes()
    if len(data) > MAX_SCENARIO_BYTES:
        raise ValueError("scenario exceeds the 65536-byte driver bound")
    decoded = json.loads(data)
    steps = decoded.get("steps") if isinstance(decoded, dict) else decoded
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_BATCH_STEPS:
        raise ValueError("scenario must contain a list of 1-64 request objects")
    normalized: list[dict[str, Any]] = []
    for index, step in enumerate(steps, 1):
        if not isinstance(step, dict) or step.get("command") == "batch":
            raise ValueError(f"scenario step {index} must be a non-batch request object")
        item = dict(step)
        item.setdefault("id", f"step-{index}-{request_id()}")
        normalized.append(item)
    return normalized


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not os.path.isabs(args.socket):
        parser.error("--socket must be absolute")
    if not 1 <= args.timeout <= 45:
        parser.error("--timeout must be between 1 and 45 seconds")
    try:
        receipt = send_request(args.socket, build_request(args), args.timeout)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": {"code": "driver-error", "message": str(error)}},
                         separators=(",", ":"), sort_keys=True))
        return 2
    print(json.dumps(receipt, separators=(",", ":"), sort_keys=True))
    return 0 if receipt.get("ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
