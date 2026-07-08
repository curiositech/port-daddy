#!/usr/bin/env python3
"""Drive a running pd-console over its control socket (stdlib only).

The console must be launched with a control socket:

    PD_CONSOLE_CONTROL_SOCK=~/.port-daddy/console-ctl.sock open -n -a pd-console_dev-<name>.app
    # or: pd-console --control-sock ~/.port-daddy/console-ctl.sock

Usage:
    console-ctl.py [--sock PATH] ping
    console-ctl.py [--sock PATH] panes
    console-ctl.py [--sock PATH] focus <pane>
    console-ctl.py [--sock PATH] state [pane]
    console-ctl.py [--sock PATH] galaxy [--window-hours N] [--min-tokens N] [--project NAME|--all-projects]
    console-ctl.py [--sock PATH] rebind <url>
    console-ctl.py [--sock PATH] alerts
    console-ctl.py [--sock PATH] raw '<json>'

Default socket: $PD_CONSOLE_CONTROL_SOCK, else ~/.port-daddy/console-ctl.sock.
Each command prints the console's JSON reply to stdout and exits non-zero when
the reply carries ok=false.
"""

import argparse
import json
import os
import socket
import sys


def default_sock() -> str:
    env = os.environ.get("PD_CONSOLE_CONTROL_SOCK", "").strip()
    if env:
        return os.path.expanduser(env)
    return os.path.expanduser("~/.port-daddy/console-ctl.sock")


def send(sock_path: str, payload: dict) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(10)
        s.connect(sock_path)
        s.sendall((json.dumps(payload) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf.decode())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sock", default=default_sock(), help="control socket path")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    sub.add_parser("panes")
    p_focus = sub.add_parser("focus")
    p_focus.add_argument("pane")
    p_state = sub.add_parser("state")
    p_state.add_argument("pane", nargs="?")
    p_galaxy = sub.add_parser("galaxy")
    p_galaxy.add_argument("--window-hours", type=int)
    p_galaxy.add_argument("--min-tokens", type=int)
    p_galaxy.add_argument("--cluster", dest="cluster", action="store_true", default=None)
    p_galaxy.add_argument("--no-cluster", dest="cluster", action="store_false")
    project_group = p_galaxy.add_mutually_exclusive_group()
    project_group.add_argument("--project")
    project_group.add_argument("--all-projects", action="store_true")
    p_rebind = sub.add_parser("rebind")
    p_rebind.add_argument("url")
    sub.add_parser("alerts")
    p_raw = sub.add_parser("raw")
    p_raw.add_argument("json")
    args = ap.parse_args()

    if args.cmd == "focus":
        payload = {"cmd": "focus", "pane": args.pane}
    elif args.cmd == "state":
        payload = {"cmd": "state"}
        if args.pane:
            payload["pane"] = args.pane
    elif args.cmd == "galaxy":
        payload = {"cmd": "galaxy"}
        if args.window_hours is not None:
            payload["windowHours"] = args.window_hours
        if args.min_tokens is not None:
            payload["minTokens"] = args.min_tokens
        if args.cluster is not None:
            payload["cluster"] = args.cluster
        if args.project is not None:
            payload["project"] = args.project
        if args.all_projects:
            payload["project"] = None
    elif args.cmd == "rebind":
        payload = {"cmd": "rebind", "url": args.url}
    elif args.cmd == "raw":
        payload = json.loads(args.json)
    else:
        payload = {"cmd": args.cmd}

    try:
        reply = send(args.sock, payload)
    except (ConnectionRefusedError, FileNotFoundError):
        print(json.dumps({"ok": False, "error": f"no console listening at {args.sock} — launch with PD_CONSOLE_CONTROL_SOCK or --control-sock"}))
        return 2
    print(json.dumps(reply, indent=2))
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
