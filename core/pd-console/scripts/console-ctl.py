#!/usr/bin/env python3
"""Drive a running pd-console over its control socket (stdlib only).

The console must be launched with a control socket:

    PD_CONSOLE_CONTROL_SOCK=~/.port-daddy/console-ctl.sock open -n -a pd-console_dev-<name>.app
    # or: pd-console --control-sock ~/.port-daddy/console-ctl.sock

Usage:
    console-ctl.py [--sock PATH] ping
    console-ctl.py [--sock PATH] describe
    console-ctl.py [--sock PATH] context
    console-ctl.py [--sock PATH] type mission.composer 'draft without sending'
    console-ctl.py [--sock PATH] click mission.send
    console-ctl.py [--sock PATH] drag workspace.primary-companion.divider 120
    console-ctl.py [--sock PATH] scroll mission.transcript 240
    console-ctl.py [--sock PATH] assert mission.composer.empty true
    console-ctl.py [--sock PATH] wait mission.awaitingReply false --timeout-ms 30000
    console-ctl.py [--sock PATH] scenario --file repro.json
    console-ctl.py [--sock PATH] sextant [--window-hours N] [--min-tokens N] [--cluster | --no-cluster]
    console-ctl.py [--sock PATH] galaxy ...  # retired; use sextant
    console-ctl.py [--sock PATH] rebind <url>
    console-ctl.py [--sock PATH] alerts
    console-ctl.py [--sock PATH] raw '<json>'

Default socket: $PD_CONSOLE_CONTROL_SOCK, else ~/.port-daddy/console-ctl.sock.
Each command prints the console's JSON reply to stdout and exits non-zero when
the reply carries ok=false.
"""

import argparse
import hashlib
import json
import os
import pathlib
import socket
import sys
import time
from datetime import datetime, timezone

SCENARIO_SCHEMA = "pd-console.scenario.v1"
PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_STEPS = 64
MAX_TIMEOUT_MS = 30_000


def default_sock() -> str:
    env = os.environ.get("PD_CONSOLE_CONTROL_SOCK", "").strip()
    if env:
        return os.path.expanduser(env)
    return os.path.expanduser("~/.port-daddy/console-ctl.sock")


def send(sock_path: str, payload: dict) -> dict:
    payload = dict(payload)
    payload["protocolVersion"] = PROTOCOL_VERSION
    wire = (json.dumps(payload, separators=(",", ":")) + "\n").encode()
    if len(wire) > MAX_REQUEST_BYTES:
        raise ValueError(f"request exceeds {MAX_REQUEST_BYTES} bytes")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(10)
        s.connect(sock_path)
        s.sendall(wire)
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            if len(buf) > MAX_RESPONSE_BYTES:
                raise ValueError(f"response exceeds {MAX_RESPONSE_BYTES} bytes")
    return json.loads(buf.decode())


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def wait_for(sock_path: str, request: dict, *, monotonic=time.monotonic, sleep=time.sleep) -> dict:
    allowed_fields = {"cmd", "protocolVersion", "path", "op", "value", "timeoutMs", "intervalMs"}
    unknown_fields = sorted(set(request) - allowed_fields)
    if unknown_fields:
        raise ValueError(f"unknown wait fields: {', '.join(unknown_fields)}")
    if not isinstance(request.get("path"), str) or not request["path"].strip():
        raise ValueError("wait needs a non-empty path")
    timeout_ms = int(request.get("timeoutMs", 5000))
    interval_ms = int(request.get("intervalMs", 100))
    if not 0 <= timeout_ms <= MAX_TIMEOUT_MS:
        raise ValueError(f"timeoutMs must be between 0 and {MAX_TIMEOUT_MS}")
    if not 10 <= interval_ms <= 1000:
        raise ValueError("intervalMs must be between 10 and 1000")
    assertion = {key: request[key] for key in ("path", "op", "value") if key in request}
    assertion["cmd"] = "assert"
    deadline = monotonic() + timeout_ms / 1000
    attempts = 0
    while True:
        attempts += 1
        reply = send(sock_path, assertion)
        if reply.get("ok"):
            return {"ok": True, "attempts": attempts, "assertion": reply}
        now = monotonic()
        if now >= deadline:
            return {
                "ok": False,
                "attempts": attempts,
                "error": {"code": "wait_timeout", "message": f"condition did not match within {timeout_ms}ms"},
                "assertion": reply,
            }
        sleep(min(interval_ms / 1000, max(0, deadline - now)))


def _without_timestamps(value):
    if isinstance(value, dict):
        return {
            key: _without_timestamps(item)
            for key, item in sorted(value.items())
            if key not in {"timestamp", "startedAt", "endedAt", "durationMs"}
        }
    if isinstance(value, list):
        return [_without_timestamps(item) for item in value]
    return value


def replay_receipt(steps: list[dict]) -> str:
    body = {"schema": SCENARIO_SCHEMA, "protocolVersion": PROTOCOL_VERSION, "steps": _without_timestamps(steps)}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def run_scenario(sock_path: str, scenario: dict) -> dict:
    allowed_fields = {"schema", "protocolVersion", "onError", "steps"}
    unknown_fields = sorted(set(scenario) - allowed_fields)
    if unknown_fields:
        raise ValueError(f"unknown scenario fields: {', '.join(unknown_fields)}")
    if scenario.get("schema") != SCENARIO_SCHEMA:
        raise ValueError(f"scenario schema must be {SCENARIO_SCHEMA}")
    if scenario.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError(f"scenario protocolVersion must be {PROTOCOL_VERSION}")
    steps = scenario.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        raise ValueError(f"scenario needs 1..{MAX_STEPS} steps")
    on_error = scenario.get("onError", "abort")
    if on_error not in {"abort", "continue"}:
        raise ValueError('onError must be "abort" or "continue"')

    started_at = timestamp()
    results = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"scenario step {index} must be an object")
        request = dict(step)
        request["protocolVersion"] = PROTOCOL_VERSION
        command = request.get("cmd")
        if command == "scenario":
            raise ValueError("nested scenarios are not allowed")
        step_started = timestamp()
        before = time.monotonic()
        reply = wait_for(sock_path, request) if command == "wait" else send(sock_path, request)
        entry = {
            "index": index,
            "timestamp": step_started,
            "durationMs": round((time.monotonic() - before) * 1000),
            "request": request,
            "result": reply,
        }
        results.append(entry)
        if not reply.get("ok") and on_error == "abort":
            break
    output = {
        "schema": SCENARIO_SCHEMA,
        "protocolVersion": PROTOCOL_VERSION,
        "ok": len(results) == len(steps) and all(step["result"].get("ok") for step in results),
        "startedAt": started_at,
        "endedAt": timestamp(),
        "onError": on_error,
        "steps": results,
        "aborted": len(results) != len(steps),
    }
    output["receipt"] = replay_receipt(results)
    return output


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sock", default=default_sock(), help="control socket path")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("describe")
    sub.add_parser("context")
    sub.add_parser("ping")
    p_galaxy = sub.add_parser("galaxy")
    p_galaxy.add_argument("--window-hours", type=int)
    p_galaxy.add_argument("--min-tokens", type=int)
    p_galaxy.add_argument("--cluster", dest="cluster", action="store_true", default=None)
    p_galaxy.add_argument("--no-cluster", dest="cluster", action="store_false")
    p_sextant = sub.add_parser("sextant")
    p_sextant.add_argument("--window-hours", type=int)
    p_sextant.add_argument("--min-tokens", type=int)
    p_sextant.add_argument("--cluster", dest="cluster", action="store_true", default=None)
    p_sextant.add_argument("--no-cluster", dest="cluster", action="store_false")
    p_rebind = sub.add_parser("rebind")
    p_rebind.add_argument("url")
    sub.add_parser("alerts")
    p_type = sub.add_parser("type")
    p_type.add_argument("target")
    p_type.add_argument("text")
    p_type.add_argument("--append", action="store_true")
    p_click = sub.add_parser("click")
    p_click.add_argument("target")
    for action in ("drag", "scroll"):
        parser = sub.add_parser(action)
        parser.add_argument("target")
        parser.add_argument("delta", type=int)
    p_assert = sub.add_parser("assert")
    p_assert.add_argument("path")
    p_assert.add_argument("value", nargs="?")
    p_assert.add_argument("--op", choices=("eq", "ne", "contains", "exists", "gte", "lte"), default="eq")
    p_wait = sub.add_parser("wait")
    p_wait.add_argument("path")
    p_wait.add_argument("value", nargs="?")
    p_wait.add_argument("--op", choices=("eq", "ne", "contains", "exists", "gte", "lte"), default="eq")
    p_wait.add_argument("--timeout-ms", type=int, default=5000)
    p_wait.add_argument("--interval-ms", type=int, default=100)
    p_scenario = sub.add_parser("scenario")
    scenario_source = p_scenario.add_mutually_exclusive_group(required=True)
    scenario_source.add_argument("json", nargs="?", help="scenario JSON object; use '-' to read stdin")
    scenario_source.add_argument("--file", help="read one explicitly named scenario JSON file")
    p_raw = sub.add_parser("raw")
    p_raw.add_argument("json")
    args = ap.parse_args()

    if args.cmd == "galaxy":
        print("Galaxy was renamed to Sextant; use `console-ctl.py sextant`.", file=sys.stderr)
        return 2

    if args.cmd == "type":
        payload = {"cmd": "type", "target": args.target, "text": args.text, "mode": "append" if args.append else "replace"}
    elif args.cmd == "click":
        payload = {"cmd": "click", "target": args.target}
    elif args.cmd in {"drag", "scroll"}:
        payload = {"cmd": args.cmd, "target": args.target, "delta": args.delta}
    elif args.cmd in {"assert", "wait"}:
        payload = {"cmd": args.cmd, "path": args.path, "op": args.op}
        if args.op != "exists":
            if args.value is None:
                ap.error(f"{args.cmd} needs VALUE unless --op exists")
            try:
                payload["value"] = json.loads(args.value)
            except json.JSONDecodeError:
                payload["value"] = args.value
        if args.cmd == "wait":
            payload.update(timeoutMs=args.timeout_ms, intervalMs=args.interval_ms)
    elif args.cmd == "scenario":
        raw = pathlib.Path(args.file).read_text(encoding="utf-8") if args.file else (
            sys.stdin.read() if args.json == "-" else args.json
        )
        try:
            scenario = json.loads(raw)
            if "protocolVersion" not in scenario:
                scenario["protocolVersion"] = PROTOCOL_VERSION
            reply = run_scenario(args.sock, scenario)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(json.dumps({"ok": False, "error": {"code": "scenario_invalid", "message": str(error)}}))
            return 2
        print(json.dumps(reply, indent=2))
        return 0 if reply.get("ok") else 1
    elif args.cmd == "sextant":
        payload = {"cmd": "sextant"}
        if args.window_hours is not None:
            payload["windowHours"] = args.window_hours
        if args.min_tokens is not None:
            payload["minTokens"] = args.min_tokens
        if args.cluster is not None:
            payload["cluster"] = args.cluster
    elif args.cmd == "rebind":
        payload = {"cmd": "rebind", "url": args.url}
    elif args.cmd == "raw":
        payload = json.loads(args.json)
    else:
        payload = {"cmd": args.cmd}

    try:
        reply = wait_for(args.sock, payload) if args.cmd == "wait" else send(args.sock, payload)
    except (ConnectionRefusedError, FileNotFoundError, socket.timeout, OSError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({
            "ok": False,
            "error": {
                "code": "transport_error",
                "message": f"console request failed for {args.sock}: {error}",
            },
        }))
        return 2
    print(json.dumps(reply, indent=2))
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
