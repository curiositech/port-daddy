#!/usr/bin/env python3
"""A real pd-tube agent responder. Listens on ui:clicks, does real work, replies
over the same daemon channel with inReplyTo set. This is the 'agent side' the
Mission Control page talks to — the thing `pd tube ui:clicks` represents."""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL = os.environ.get("PD_TUBE_CHANNEL", "ui:clicks")
REPO = Path(os.environ.get("PD_TUBE_REPO", os.getcwd())).resolve()
SENDER = os.environ.get("PD_TUBE_SENDER", "sample-agent")
PR_NUMBER = os.environ.get("PD_TUBE_PR")
URL = ""

def discover_daemon_url():
    explicit = os.environ.get("PORT_DADDY_URL") or os.environ.get("PORT_DADDY_DAEMON_URL")
    if explicit:
        return explicit.rstrip("/")
    port_file = Path(os.environ.get("PORT_DADDY_PORT_FILE", Path.home() / ".port-daddy" / "daemon.port"))
    try:
        port = int(port_file.read_text().strip())
        if 1024 <= port <= 65535:
            return f"http://127.0.0.1:{port}"
    except (OSError, ValueError):
        pass
    raise RuntimeError("No Port Daddy daemon endpoint is published; select or start a daemon and retry.")

def configure():
    global CHANNEL, REPO, SENDER, PR_NUMBER, URL
    parser = argparse.ArgumentParser(description="Respond to pd tube ui:clicks messages.")
    parser.add_argument("--daemon", default=None, help="Explicit Port Daddy daemon URL; otherwise discover the selected daemon")
    parser.add_argument("--channel", default=CHANNEL, help="Tube channel to listen on")
    parser.add_argument("--repo", default=str(REPO), help="Repository path for local git/test inspection")
    parser.add_argument("--sender", default=SENDER, help="Sender name for replies")
    parser.add_argument("--pr", default=PR_NUMBER, help="Optional GitHub PR number to summarize")
    args = parser.parse_args()
    CHANNEL = args.channel
    REPO = Path(args.repo).expanduser().resolve()
    SENDER = args.sender
    PR_NUMBER = args.pr
    URL = f"{(args.daemon or discover_daemon_url()).rstrip('/')}/msg/{urllib.parse.quote(CHANNEL, safe='')}"

def sh(args, timeout=20):
    try:
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception as e:
        return f"({e})"

def get(after):
    with urllib.request.urlopen(f"{URL}?after={after}", timeout=10) as r:
        return json.load(r).get("messages", [])

def reply(parent_id, body, sender=None):
    data = json.dumps({"sender": sender or SENDER, "payload": {"v": 1, "kind": "tube.msg",
                       "inReplyTo": parent_id, "body": body}}).encode()
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r).get("id")

def work(text):
    t = text.lower()
    if "deploy" in t:
        sha = sh(["git", "rev-parse", "--short", "HEAD"]) or "????"
        branch = sh(["git", "branch", "--show-current"]) or "detached"
        return f"Inspected deploy readiness for {sha} ({branch}). This sample did not push or run smoke checks; staging/prod are unchanged."
    if "test" in t:
        n = sh(["bash", "-lc", "find . \\( -name '*.test.*' -o -name '*.spec.*' \\) | wc -l"]).strip()
        return f"Found {n} test/spec files under {REPO}. This sample did not run them; use your repo's test command for results."
    if "summarize" in t or "pr" in t:
        if PR_NUMBER:
            out = sh(["gh", "pr", "view", str(PR_NUMBER), "--json", "title,additions,deletions,changedFiles",
                      "-q", f'"#{PR_NUMBER} " + .title + " — " + (.changedFiles|tostring) + " files, +" + (.additions|tostring) + "/-" + (.deletions|tostring)'])
            return out or f"Could not read PR #{PR_NUMBER}; check gh auth or the repository remote."
        sha = sh(["git", "rev-parse", "--short", "HEAD"]) or "????"
        branch = sh(["git", "branch", "--show-current"]) or "detached"
        return f"Local repo summary: {branch} at {sha}. Set PD_TUBE_PR or pass --pr to summarize a GitHub PR."
    # free-form: route to a REAL claude agent
    ans = sh(["claude", "-p", f"Answer in one or two sentences, plainly: {text}"])
    return ans[:400] if ans and not ans.startswith("(") else f"(agent could not answer: {ans})"

def main():
    configure()
    # start from the live tip so we only react to new clicks
    try:
        msgs = get(0)
        cursor = max((m["id"] for m in msgs), default=0)
    except Exception as e:
        print(f"daemon not reachable: {e}", file=sys.stderr); sys.exit(1)
    print(f"responder live on {CHANNEL}, cursor={cursor}", flush=True)
    while True:
        try:
            for m in get(cursor):
                cursor = max(cursor, m["id"])
                p = m.get("payload") or {}
                # only react to fresh clicks (not our own replies, not threaded msgs)
                if m.get("sender") == "web-page" and p.get("kind") == "tube.msg" and not p.get("inReplyTo"):
                    body = p.get("body", "")
                    print(f"<- click #{m['id']}: {body[:60]}", flush=True)
                    rid = reply(m["id"], work(body))
                    print(f"-> replied #{rid}", flush=True)
            time.sleep(0.4)
        except Exception as e:
            print(f"loop error: {e}", file=sys.stderr); time.sleep(1)

if __name__ == "__main__":
    main()
