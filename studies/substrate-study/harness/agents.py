"""The scripted worker and the two temperaments (PROTOCOL.md S2.1)."""
from __future__ import annotations

import random

COOPERATIVE = "cooperative"
IMPATIENT = "impatient"
TEMPERAMENTS = (COOPERATIVE, IMPATIENT)

PER_LINE_SECONDS = 3.0
JITTER_LOW, JITTER_HIGH = 0.7, 1.3

# Cost, in simulated seconds, of one retry ("rebase") after a refusal/conflict.
CLAIM_RETRY_BACKOFF = 15.0
D_RETRY_BACKOFF = 10.0
D_MAX_RETRIES = 3          # PROTOCOL.md S2.2: "abandon after k" for D's queue rule.
COOPERATIVE_RETRY_CAP = 200  # termination safety valve, not a modeled parameter.


def work_duration(lines_changed: int, rng: random.Random) -> float:
    """Duration drawn from task size: lines changed times a per-line time,
    jittered by the run's seeded RNG."""
    jitter = rng.uniform(JITTER_LOW, JITTER_HIGH)
    return max(1, lines_changed) * PER_LINE_SECONDS * jitter


def rolls_bypass(rng: random.Random, p: float) -> bool:
    if p <= 0.0:
        return False
    return rng.random() < p
