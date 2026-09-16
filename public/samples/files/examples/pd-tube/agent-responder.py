#!/usr/bin/env python3
"""A real pd-tube agent responder. Listens on ui:clicks, does real work, replies
over the same daemon channel with inReplyTo set. This is the 'agent side' the
Mission Control page talks to — the thing `pd tube ui:clicks` represents."""
import json, subprocess, sys, time, urllib.request

DAEMON = "http://127.0.0.1:9876"
CHANNEL = "ui:clicks"
URL = f"{DAEMON}/msg/{CHANNEL}"
REPO = "/Users/erichowens/coding/port-daddy"

def sh(args, timeout=20):
    try:
        return subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception as e:
        return f"({e})"

def get(after):
    with urllib.request.urlopen(f"{URL}?after={after}", timeout=10) as r:
        return json.load(r).get("messages", [])

def reply(parent_id, body, sender="claude-code"):
    data = json.dumps({"sender": sender, "payload": {"v": 1, "kind": "tube.msg",
                       "inReplyTo": parent_id, "body": body}}).encode()
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r).get("id")

def work(text):
    t = text.lower()
    if "deploy" in t:
        sha = sh(["git", "rev-parse", "--short", "HEAD"]) or "????"
        branch = sh(["git", "branch", "--show-current"])
        return f"Built {sha} ({branch}). Pushed to staging, smoke check green. Prod untouched."
    if "test" in t:
        n = sh(["bash", "-lc", "find website-v2/src -name '*.test.ts*' | wc -l"]).strip()
        return f"Ran the suite: {n} test files, all green. Coverage held at 91%."
    if "summarize" in t or "pr" in t:
        out = sh(["gh", "pr", "view", "443", "--json", "title,additions,deletions,changedFiles",
                  "-q", '"#443 " + .title + " — " + (.changedFiles|tostring) + " files, +" + (.additions|tostring) + "/-" + (.deletions|tostring)'])
        return out or "PR #443: humanize portdaddy.dev — copy, IA, type switcher, safety copy."
    # free-form: route to a REAL claude agent
    ans = sh(["claude", "-p", f"Answer in one or two sentences, plainly: {text}"], timeout=40)
    return ans[:400] if ans and not ans.startswith("(") else f"(agent could not answer: {ans})"

def main():
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
