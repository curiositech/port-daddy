"""Stand-in listening agent on dev:test-failed against the REAL pd daemon.

Polls the channel and replies (as 'fixer') with a diagnosis + unified diff to
any fresh 'test-runner' message, mirroring what `pd tube dev:test-failed` would
do interactively. Used only to drive headless verification of the Red-to-Green
demo's reply path; not part of the shipped app.
"""
import json
import time
import urllib.request

BASE = "http://127.0.0.1:9876/msg/dev:test-failed"
REPLY_BODY = (
    "applyDiscount subtracts the rate as a flat amount instead of scaling by it. "
    "For a 10% discount on 99.00 you want price * (1 - 0.10) = 89.10.\n"
    "--- a/src/cart/totals.ts\n"
    "+++ b/src/cart/totals.ts\n"
    "@@ applyDiscount @@\n"
    "-  return price - rate\n"
    "+  return price * (1 - rate)"
)


def get(after):
    with urllib.request.urlopen(f"{BASE}?after={after}") as r:
        return json.load(r)


def post(body, in_reply_to):
    data = json.dumps(
        {"sender": "fixer", "payload": {"v": 1, "kind": "tube.msg", "body": body, "inReplyTo": in_reply_to}}
    ).encode()
    req = urllib.request.Request(BASE, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main():
    # Start from the current tail so we only answer new posts.
    seed = get(0)
    cursor = max((m["id"] for m in seed.get("messages", [])), default=0)
    print(f"autoresponder live, cursor={cursor}", flush=True)
    answered = set()
    while True:
        try:
            res = get(cursor)
            for m in res.get("messages", []):
                cursor = max(cursor, m["id"])
                p = m.get("payload", {})
                if (
                    p.get("kind") == "tube.msg"
                    and p.get("inReplyTo") is None
                    and m.get("sender") != "fixer"
                    and m["id"] not in answered
                ):
                    answered.add(m["id"])
                    out = post(REPLY_BODY, m["id"])
                    print(f"replied to {m['id']} -> {out.get('id')}", flush=True)
        except Exception as e:  # keep the loop alive
            print("err:", e, flush=True)
        time.sleep(0.4)


if __name__ == "__main__":
    main()
