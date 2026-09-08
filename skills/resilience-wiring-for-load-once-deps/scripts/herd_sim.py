#!/usr/bin/env python3
"""
herd_sim.py — Make the failure modes measurable, not hand-wavy.

Three self-contained, stdlib-only simulations you can RUN to see the numbers
this skill is about. No network, no deps. Deterministic (seeded RNG).

    python3 herd_sim.py            # run all three
    python3 herd_sim.py herd       # plain-exponential vs full-jitter retry spread
    python3 herd_sim.py storm      # memoized-rejected-promise storm vs gated loader
    python3 herd_sim.py breaker    # circuit-breaker state machine trace

Exit code is 0 on success, non-zero if an invariant the skill teaches is
violated (used as a smoke test in CI).
"""
from __future__ import annotations

import random
import sys


# ── Full-jitter backoff (the primitive) ──────────────────────────────────────

def full_jitter_delay(attempt: int, base_ms: float, cap_ms: float, rng: random.Random) -> float:
    """random(0, min(cap, base * 2^attempt)). attempt is 0-indexed."""
    exponential = min(cap_ms, base_ms * (2 ** attempt))
    return rng.random() * exponential


def plain_exponential_delay(attempt: int, base_ms: float, cap_ms: float) -> float:
    """No jitter — every caller lands on the SAME instant. This is the bug."""
    return min(cap_ms, base_ms * (2 ** attempt))


# ── Sim 1: thundering herd ────────────────────────────────────────────────────

def sim_herd() -> bool:
    """
    1000 callers all fail at t=0 against a just-recovering dependency and retry.
    Plain exponential: all retries land in a handful of instants (a wall of load
    that re-knocks-over the dependency). Full jitter: retries spread across the
    whole window. We measure the worst 10ms-bucket concentration.
    """
    n, base, cap = 1000, 100.0, 30_000.0
    rng = random.Random(42)

    def peak_bucket(delays: list[float]) -> int:
        buckets: dict[int, int] = {}
        for d in delays:
            b = int(d // 10)
            buckets[b] = buckets.get(b, 0) + 1
        return max(buckets.values())

    plain = [plain_exponential_delay(1, base, cap) for _ in range(n)]
    jitter = [full_jitter_delay(1, base, cap, rng) for _ in range(n)]

    plain_peak, jitter_peak = peak_bucket(plain), peak_bucket(jitter)
    print("── Sim 1: thundering herd (1000 callers, attempt #2) ──")
    print(f"  plain exponential : {plain_peak:>5} callers land in the busiest 10ms window")
    print(f"  full jitter       : {jitter_peak:>5} callers land in the busiest 10ms window")
    print(f"  → full jitter cut peak concurrent retry load {plain_peak / max(1, jitter_peak):.0f}x\n")
    # Invariant the skill claims: jitter must dramatically flatten the peak.
    return jitter_peak * 10 < plain_peak


# ── Sim 2: the memoized-rejected-promise storm ────────────────────────────────

class NaiveMemoizedLoader:
    """The anti-pattern: cache the load result — including a FAILURE — forever."""
    def __init__(self, load):
        self._load = load
        self._cached = None      # once set, never reset (even on failure)
        self._resolved = False

    def get(self):
        if not self._resolved:
            self._resolved = True
            try:
                self._cached = ("ok", self._load())
            except Exception as e:  # noqa: BLE001
                self._cached = ("err", e)  # <-- poison pill, never re-attempted OR reset
        kind, val = self._cached
        if kind == "err":
            raise val  # every caller re-raises + re-logs the SAME dead error
        return val


class GatedLoader:
    """The fix: breaker gates re-loads; failures are not cached as poison pills."""
    def __init__(self, load, failure_threshold=3, open_ms=60_000, now=None):
        self._load = load
        self._value = None
        self._loaded = False
        self._failures = 0
        self._state = "CLOSED"
        self._opened_at = 0
        self._ft = failure_threshold
        self._open_ms = open_ms
        self._now = now or (lambda: 0)

    def try_get(self, logs: list[str]):
        if self._loaded:
            return self._value
        if self._state == "OPEN":
            if self._now() - self._opened_at < self._open_ms:
                return None  # skip SILENTLY — no re-load, no re-log
            self._state = "HALF_OPEN"  # one probe allowed
        try:
            self._value = self._load()
            self._loaded = True
            self._state = "CLOSED"
            self._failures = 0
            return self._value
        except Exception:  # noqa: BLE001
            self._failures += 1
            if self._state == "HALF_OPEN" or self._failures >= self._ft:
                if self._state != "OPEN":
                    logs.append("dependency_load_failed (governed, 1x)")  # ONE line per outage
                self._state = "OPEN"
                self._opened_at = self._now()
            else:
                logs.append("dependency_load_failed (governed, 1x)")
            return None


def sim_storm() -> bool:
    """
    A permanently-broken dependency (missing dylib) is awaited every tick by a
    fleet loop for 7182 ticks — the real incident's tick count.
    """
    TICKS = 7182
    ROW_BYTES = 45_000_000  # ~45MB error object + DB row + stdout per naive log (storm avg)

    def broken_load():
        raise RuntimeError("Failed to load ONNX runtime: missing libonnxruntime.dylib")

    # Naive: each tick constructs a fresh memoized loader per call site OR re-awaits
    # the poison pill; either way every tick logs the full error once.
    naive_logs = 0
    for _ in range(TICKS):
        loader = NaiveMemoizedLoader(broken_load)
        try:
            loader.get()
        except Exception:  # noqa: BLE001
            naive_logs += 1

    # Gated: one shared loader; breaker OPENs after 3 and stays quiet.
    clock = {"t": 0}
    gated = GatedLoader(broken_load, failure_threshold=3, open_ms=60_000,
                        now=lambda: clock["t"])
    gated_logs: list[str] = []
    for _ in range(TICKS):
        clock["t"] += 1000  # 1s/tick; never advances past the 60s cool-down window enough to re-probe much
        gated.try_get(gated_logs)

    print("── Sim 2: load-once-dep-failed-permanently storm (7182 ticks) ──")
    print(f"  naive memoized/poison  : {naive_logs:>5} error logs  ~= {naive_logs * ROW_BYTES / 1e9:6.1f} GB written")
    print(f"  gated loader           : {len(gated_logs):>5} error logs  (rest skipped silently)")
    print(f"  → {naive_logs / max(1, len(gated_logs)):.0f}x fewer log events; storm averted")
    print(f"    (gated still logs once per cool-down re-probe — bound it further with a LogGovernor window)\n")
    return len(gated_logs) < naive_logs / 20 and naive_logs > 5000


# ── Sim 3: breaker state machine trace ────────────────────────────────────────

def sim_breaker() -> bool:
    """Walk CLOSED -> OPEN -> HALF_OPEN -> (CLOSED|OPEN) and assert transitions."""
    clock = {"t": 0}
    loader = GatedLoader(lambda: (_ for _ in ()).throw(RuntimeError("429")),
                         failure_threshold=3, open_ms=1000, now=lambda: clock["t"])
    logs: list[str] = []
    trace = []
    # 3 failures -> OPEN
    for _ in range(3):
        loader.try_get(logs)
        trace.append(loader._state)
    assert trace[-1] == "OPEN", trace
    # while cooling, calls are skipped, state stays OPEN
    clock["t"] = 500
    loader.try_get(logs)
    assert loader._state == "OPEN"
    # after cool-down, a probe is allowed (HALF_OPEN); it fails -> back to OPEN
    clock["t"] = 2000
    loader.try_get(logs)
    reopened = loader._state == "OPEN"
    print("── Sim 3: breaker state machine ──")
    print(f"  after 3 retryable failures : {trace}  (OPEN ✓)")
    print(f"  probe during cool-down     : skipped, state OPEN ✓")
    print(f"  probe after cool-down fails: re-OPEN ✓  ({reopened})")
    print(f"  governed logs for the whole outage: {len(logs)}  (not thousands)\n")
    return trace[-1] == "OPEN" and reopened


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    ok = True
    if which in ("all", "herd"):
        ok &= sim_herd()
    if which in ("all", "storm"):
        ok &= sim_storm()
    if which in ("all", "breaker"):
        ok &= sim_breaker()
    print("RESULT:", "PASS ✓" if ok else "FAIL ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
