#!/usr/bin/env python3
"""egress-meter (prototype) — a local metering proxy for pd-cutter.

All of a confined agent's outbound API traffic is pointed here via HTTPS_PROXY.
We meter per-host request count + tunneled bytes, and HARD-REFUSE once a cap is
hit — so a runaway or looping agent cannot burn unbounded spend.

Honest limits (cooperative case):
  - HTTPS is tunneled via CONNECT; we count requests + bytes but cannot see
    tokens/cost inside TLS without MITM (a local CA + usage-field parsing is the
    dollar-accurate upgrade). Request/byte caps are a real, enforceable floor.
  - A truly-malicious same-UID agent can `unset HTTPS_PROXY` and egress directly;
    sealing that needs a separate UID/netns + pf/nftables forced egress.
Usage: egress-meter.py <port> <max_requests> <meter_file>
"""
import sys, socket, threading, json, time

PORT = int(sys.argv[1]); MAX_REQ = int(sys.argv[2]); METER = sys.argv[3]
state = {"requests": 0, "bytes": 0, "by_host": {}, "blocked": 0, "cap": MAX_REQ}
lock = threading.Lock()

def flush():
    with lock:
        json.dump(state, open(METER, "w"))

def pump(src, dst, host):
    total = 0
    try:
        while True:
            data = src.recv(65536)
            if not data: break
            dst.sendall(data); total += len(data)
    except OSError:
        pass
    finally:
        with lock:
            state["bytes"] += total
            state["by_host"][host] = state["by_host"].get(host, 0) + total
        flush()

def handle(client):
    try:
        req = client.recv(65536)
        if not req: client.close(); return
        line = req.split(b"\r\n", 1)[0].decode("latin1")
        parts = line.split()
        if len(parts) < 2: client.close(); return
        method, target = parts[0], parts[1]
        host = target.split(":")[0] if method == "CONNECT" else target
        with lock:
            state["requests"] += 1
            over = state["requests"] > MAX_REQ
            if over: state["blocked"] += 1
        flush()
        if over:
            client.sendall(b"HTTP/1.1 503 Spend Cap Exceeded\r\nContent-Length: 0\r\n\r\n")
            client.close(); return
        if method == "CONNECT":
            h, _, p = target.partition(":")
            up = socket.create_connection((h, int(p or 443)), timeout=15)
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            threading.Thread(target=pump, args=(client, up, h), daemon=True).start()
            pump(up, client, h)
        else:
            client.sendall(b"HTTP/1.1 501 Not Implemented (use HTTPS)\r\n\r\n")
            client.close()
    except Exception:
        try: client.close()
        except OSError: pass

def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT)); srv.listen(64)
    flush()
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()

if __name__ == "__main__":
    main()
