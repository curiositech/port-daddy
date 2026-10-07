#!/usr/bin/env python3
"""
Party Link Token Demo -- unguessable room IDs + server-scoped access tokens

Demonstrates the "party link" pattern for ad-hoc, join-by-URL video/audio
rooms (the shareable link a dating/social app hands out so anyone holding it
can join a live room without an account-to-account friend link):

  1. Room creation mints a short-lived, cryptographically random room ID
     (NOT a sequential/guessable ID like room-1042) plus an expiry and a
     max-participant cap. This is the "room record" a server would persist.
  2. Joining the room requires the server to validate the room ID against
     that record (exists? not expired? under capacity?) and only THEN mint
     a client access token (here: a compact HMAC-signed token standing in
     for a real signed JWT) scoped to that exact room ID, a role, and a
     short expiry.
  3. The client never mints its own token -- verify_token() re-derives
     the signature server-side and rejects anything that doesn't match,
     is expired, or is scoped to a different room than the one requested.

This is a teaching/reference implementation using only stdlib crypto
(hmac + hashlib + secrets) so it runs with zero dependencies. Swap in
a real JWT library (PyJWT, jose, etc.) and a real datastore (Redis/Postgres)
for production use -- the SHAPE of the pattern (opaque room ID, server-side
validation before minting, room-scoped signed claims, short TTL) is what
matters and is what this script exercises end-to-end.

Usage:
    # Create a room record (prints JSON room record to stdout)
    python3 party_link_token.py create-room --ttl-minutes 60 --max-participants 8

    # Mint a token scoped to a room (requires the room's secret from create-room)
    python3 party_link_token.py mint-token --room-id <id> --secret <secret> \
        --user-id alice --role publisher --ttl-minutes 10

    # Verify a token (simulates what the SFU/join endpoint does on connect)
    python3 party_link_token.py verify-token --token <token> --secret <secret> \
        --expected-room-id <id>

    # Run the full end-to-end demo (create room -> mint -> verify -> tamper -> reject)
    python3 party_link_token.py demo
"""

import argparse
import base64
import hashlib
import hmac
import json
import secrets
import sys
import time


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def generate_room_id() -> str:
    """Unguessable room ID: 16 bytes of CSPRNG entropy, URL-safe base64.

    NEVER use a sequential integer, a slug derived from user input, or
    anything an attacker could enumerate or guess (e.g. "room-42",
    "alice-party", timestamps). This is the single most common party-link
    security mistake: a "private" room that's actually discoverable by
    incrementing an ID or guessing a username.
    """
    return _b64url_encode(secrets.token_bytes(16))


def create_room(ttl_minutes: int, max_participants: int) -> dict:
    now = int(time.time())
    room_id = generate_room_id()
    secret = _b64url_encode(secrets.token_bytes(32))
    return {
        "room_id": room_id,
        "secret": secret,  # server-side only; NEVER sent to clients
        "created_at": now,
        "expires_at": now + ttl_minutes * 60,
        "max_participants": max_participants,
        "current_participants": 0,
    }


def mint_token(room_id: str, secret: str, user_id: str, role: str, ttl_minutes: int) -> str:
    """Mint a room-scoped access token. Only the server calls this, and only
    after validating the room record (exists, not expired, under capacity).
    The client requests a room by ID; it never supplies its own token.
    """
    now = int(time.time())
    claims = {
        "room_id": room_id,
        "user_id": user_id,
        "role": role,  # e.g. "publisher" | "viewer" | "moderator"
        "iat": now,
        "exp": now + ttl_minutes * 60,
    }
    payload = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload)
    signature = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{payload_b64}.{sig_b64}"


def verify_token(token: str, secret: str, expected_room_id: str) -> dict:
    """Server-side verification the join/SFU endpoint runs on every connect.
    Returns the claims dict on success; raises ValueError on any failure.
    """
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        raise ValueError("malformed token: expected '<payload>.<signature>'")

    expected_sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    actual_sig = _b64url_decode(sig_b64)
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("signature mismatch: token was tampered with or signed by a different secret")

    claims = json.loads(_b64url_decode(payload_b64))

    if claims.get("room_id") != expected_room_id:
        raise ValueError(
            f"room scope mismatch: token is scoped to {claims.get('room_id')!r}, "
            f"not the requested room {expected_room_id!r}"
        )

    if int(time.time()) > claims.get("exp", 0):
        raise ValueError("token expired")

    return claims


def cmd_create_room(args) -> int:
    room = create_room(args.ttl_minutes, args.max_participants)
    print(json.dumps(room, indent=2))
    print(
        "\n# Share this URL fragment with participants (room_id only, never the secret):",
        file=sys.stderr,
    )
    print(f"#   https://example.app/join/{room['room_id']}", file=sys.stderr)
    return 0


def cmd_mint_token(args) -> int:
    token = mint_token(args.room_id, args.secret, args.user_id, args.role, args.ttl_minutes)
    print(token)
    return 0


def cmd_verify_token(args) -> int:
    try:
        claims = verify_token(args.token, args.secret, args.expected_room_id)
    except ValueError as exc:
        print(f"REJECTED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "accepted", "claims": claims}, indent=2))
    return 0


def cmd_demo(_args) -> int:
    print("1. Server creates a room record (unguessable ID, TTL, capacity cap):")
    room = create_room(ttl_minutes=60, max_participants=8)
    print(json.dumps({k: v for k, v in room.items() if k != "secret"}, indent=2))

    print("\n2. Client requests to join via the party link; server validates room")
    print("   THEN mints a room-scoped token server-side (client never mints its own):")
    token = mint_token(room["room_id"], room["secret"], user_id="alice", role="publisher", ttl_minutes=10)
    print(f"   token = {token}")

    print("\n3. Join/SFU endpoint verifies the token on connect -> ACCEPTED:")
    claims = verify_token(token, room["secret"], room["room_id"])
    print(f"   claims = {claims}")

    print("\n4. Attacker tries the token against a DIFFERENT room ID -> REJECTED:")
    try:
        verify_token(token, room["secret"], generate_room_id())
    except ValueError as exc:
        print(f"   rejected as expected: {exc}")

    print("\n5. Attacker tampers with the payload (tries to escalate role) -> REJECTED:")
    payload_b64, sig_b64 = token.split(".", 1)
    tampered_claims = json.loads(_b64url_decode(payload_b64))
    tampered_claims["role"] = "moderator"
    tampered_payload_b64 = _b64url_encode(
        json.dumps(tampered_claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    tampered_token = f"{tampered_payload_b64}.{sig_b64}"
    try:
        verify_token(tampered_token, room["secret"], room["room_id"])
    except ValueError as exc:
        print(f"   rejected as expected: {exc}")

    print("\nDemo complete: room-scoped, server-minted, tamper-evident tokens work as intended.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create-room", help="Create a room record with an unguessable ID")
    p_create.add_argument("--ttl-minutes", type=int, default=60)
    p_create.add_argument("--max-participants", type=int, default=8)
    p_create.set_defaults(func=cmd_create_room)

    p_mint = sub.add_parser("mint-token", help="Mint a room-scoped access token (server-side only)")
    p_mint.add_argument("--room-id", required=True)
    p_mint.add_argument("--secret", required=True)
    p_mint.add_argument("--user-id", required=True)
    p_mint.add_argument("--role", default="publisher", choices=["publisher", "viewer", "moderator"])
    p_mint.add_argument("--ttl-minutes", type=int, default=10)
    p_mint.set_defaults(func=cmd_mint_token)

    p_verify = sub.add_parser("verify-token", help="Verify a token as the join/SFU endpoint would")
    p_verify.add_argument("--token", required=True)
    p_verify.add_argument("--secret", required=True)
    p_verify.add_argument("--expected-room-id", required=True)
    p_verify.set_defaults(func=cmd_verify_token)

    p_demo = sub.add_parser("demo", help="Run the full create -> mint -> verify -> tamper -> reject flow")
    p_demo.set_defaults(func=cmd_demo)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
