"""Helpers for one test directory of players-20261111.

An identical copy of this file sits in each test directory this builder
made, so every directory stands alone. Standard library only. Nothing here
reads the clock or an unseeded random source.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import re
from pathlib import Path

EXPERIMENT = "players-20261111"
_SCRATCH = Path("/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad")
RUNS_ROOT = _SCRATCH / "exp-runs-1111"
DRYRUN_ROOT = _SCRATCH / "exp-runs-1111-dryrun"

# Left behind by Python or an editor. Never counted as a subject's file.
IGNORED_NAMES = {"__pycache__", ".pytest_cache", ".DS_Store"}


# ------------------------------------------------------------------ seeds, hashes, JSON

def master_seed(test: str) -> str:
    return f"{EXPERIMENT}/{test}/v1"


def derive_seed(*parts: str) -> int:
    """A 64-bit seed from string parts: the master seed, then the context."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def rng_for(*parts: str) -> random.Random:
    return random.Random(derive_seed(*parts))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def dump_json(obj, path: Path | None = None) -> str:
    text = json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if path is not None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(text)
    return text


def load_json(path: Path):
    return json.loads(Path(path).read_text())


# ------------------------------------------------------------------ sealed files on disk

def write_or_check(outputs: dict[Path, str], check: bool, base: Path) -> int:
    """Write every output, or compare each with the file on disk. Returns the count that differ."""
    bad = 0
    for path in sorted(outputs):
        text = outputs[path]
        rel = path.relative_to(base)
        if check:
            same = path.exists() and path.read_text() == text
            print(("reproduces " if same else "DIFFERS    ") + str(rel))
            bad += not same
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            print("wrote", rel)
    return bad


def stray_files(root: Path, expected: set[Path]) -> list[str]:
    """Files under root that a fresh build would not have written."""
    if not root.exists():
        return []
    out = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p not in expected and not (set(p.parts) & IGNORED_NAMES):
            out.append(str(p.relative_to(root)))
    return out


def other_files(session_dir: Path, known: set[str]) -> list[str]:
    """What a subject left in its directory besides the files it was given and its answers."""
    out = []
    for p in sorted(Path(session_dir).rglob("*")):
        rel = p.relative_to(session_dir).as_posix()
        if p.is_file() and rel not in known and not (set(p.parts) & IGNORED_NAMES):
            out.append(rel)
    return out


# ------------------------------------------------------------------ a subject's answers file

_ID_FIELDS = ("job", "engagement", "question", "item", "id", "number", "n")
_VALUE_FIELDS = ("decision", "move", "answer", "probability", "estimate", "value", "choice", "p")


def _item_number(key) -> int | None:
    if isinstance(key, bool):
        return None
    if isinstance(key, int):
        return key
    found = re.findall(r"\d+", str(key))
    return int(found[0]) if len(found) == 1 else None


def read_answer_map(path: Path) -> tuple[dict[int, object], list[str]]:
    """Read an answers file into {item number: raw value}, with a list of problems.

    The stated format is one JSON object keyed by item number. A list of
    objects that each carry a number and a value is read as well, and so is
    either form wrapped in an object with a single key.
    """
    problems: list[str] = []
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {}, ["answers file missing"]
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return {}, [f"answers file is not JSON: {exc}"]
    if isinstance(raw, dict) and len(raw) == 1 and isinstance(next(iter(raw.values())), (dict, list)):
        raw = next(iter(raw.values()))
        problems.append("answers were wrapped in an outer object; the inner one is read")
    pairs: list[tuple[object, object]] = []
    if isinstance(raw, dict):
        pairs = list(raw.items())
    elif isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                problems.append(f"list entry is not an object: {row!r}")
                continue
            key = next((row[f] for f in _ID_FIELDS if f in row), None)
            value = next((row[f] for f in _VALUE_FIELDS if f in row), None)
            pairs.append((key, value))
    else:
        return {}, ["answers JSON is neither an object nor a list"]
    out: dict[int, object] = {}
    for key, value in pairs:
        n = _item_number(key)
        if n is None:
            problems.append(f"entry without a usable item number: {key!r}")
        elif n in out:
            problems.append(f"item {n} answered twice; the first answer is kept")
        else:
            out[n] = value
    return out, problems


# ------------------------------------------------------------------ exact statistics

def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> list[float]:
    """Exact two-sided interval for a rate k/n."""
    if n == 0:
        return [0.0, 1.0]

    def cdf(x: int, p: float) -> float:
        return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(0, x + 1))

    def solve(f, target: float, increasing: bool) -> float:
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if (f(mid) < target) == increasing:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    lower = 0.0 if k == 0 else solve(lambda p: 1 - cdf(k - 1, p), alpha / 2, True)
    upper = 1.0 if k == n else solve(lambda p: cdf(k, p), alpha / 2, False)
    return [round(lower, 4), round(upper, 4)]


def fisher_one_sided(a: int, b: int, c: int, d: int) -> float:
    """Fisher's exact test on [[a, b], [c, d]]: P(top-left cell >= a) with the margins fixed."""
    row1, col1, total = a + b, a + c, a + b + c + d
    if total == 0:
        return 1.0
    denom = math.comb(total, col1)
    hi = min(row1, col1)
    return sum(math.comb(row1, i) * math.comb(total - row1, col1 - i) for i in range(a, hi + 1)) / denom


def subset_sum_counts(scores: list[int], m: int) -> dict[int, int]:
    """For each total, the number of ways to pick m of the scores that add up to it."""
    if any(s < 0 for s in scores):
        raise ValueError("scores must not be negative")
    # table[k] packs, for picks of k scores, the count for each total into one integer,
    # `bits` bits per total. No count exceeds C(n, m), so no field can carry into the next.
    bits = math.comb(len(scores), m).bit_length() + 1
    table = [0] * (m + 1)
    table[0] = 1
    for s in scores:
        for k in range(m, 0, -1):
            if table[k - 1]:
                table[k] += table[k - 1] << (bits * s)
    out: dict[int, int] = {}
    packed, total, mask = table[m], 0, (1 << bits) - 1
    while packed:
        if packed & mask:
            out[total] = packed & mask
        packed >>= bits
        total += 1
    return out


def permutation_trend(strata: list[tuple[list[int], list[int]]]) -> dict:
    """Exact one-sided trend test, permuting outcomes inside each stratum.

    Each stratum is (integer scores, 0/1 outcomes). The statistic is the sum
    of the scores of the items with outcome 1. The p-value is the share of
    arrangements, with each stratum's count of ones fixed, whose statistic is
    at most the observed one. A small p says the ones sit at low scores.
    """
    observed = 0
    total = 1
    per_stratum = []
    for scores, outcomes in strata:
        if len(scores) != len(outcomes):
            raise ValueError("scores and outcomes differ in length")
        if any(s < 0 for s in scores):
            raise ValueError("scores must not be negative")
        observed += sum(s for s, y in zip(scores, outcomes) if y)
        counts = subset_sum_counts(list(scores), sum(outcomes))
        per_stratum.append(counts)
        total *= sum(counts.values())
    # Multiply the strata's count polynomials exactly. Each polynomial is packed into one
    # integer with a fixed number of bytes per coefficient, wide enough that none can carry.
    width = total.bit_length() // 8 + 2
    packed = 1
    for counts in per_stratum:
        packed *= sum(ways << (8 * width * t) for t, ways in counts.items())
    raw = packed.to_bytes(packed.bit_length() // 8 + 1, "little")
    at_most = weighted = 0
    for t in range(len(raw) // width + 1):
        ways = int.from_bytes(raw[t * width:(t + 1) * width], "little")
        weighted += t * ways
        if t <= observed:
            at_most += ways
    return {"statistic": observed, "null_mean": round(weighted / total, 4), "p_one_sided": at_most / total,
            "arrangements": total}


def logistic_fit(xs: list[float], ys: list[int]) -> dict:
    """Maximum-likelihood fit of P(y = 1) = 1 / (1 + exp(-(a + b x))). Description only.

    When a cut on x splits the outcomes perfectly the likelihood has no
    maximum, so no slope is returned and the status says why.
    """
    n, k = len(xs), sum(ys)
    if n == 0 or k == 0 or k == n:
        return {"status": "no variation in the outcome", "slope": None, "intercept": None, "midpoint": None}
    ones = [x for x, y in zip(xs, ys) if y]
    zeros = [x for x, y in zip(xs, ys) if not y]
    if max(ones) <= min(zeros):
        return {"status": "separated: every 1 lies at or below every 0", "slope": None, "intercept": None,
                "midpoint": None, "gap": [max(ones), min(zeros)]}
    if max(zeros) <= min(ones):
        return {"status": "separated: every 0 lies at or below every 1", "slope": None, "intercept": None,
                "midpoint": None, "gap": [max(zeros), min(ones)]}
    mean = sum(xs) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in xs) / n) or 1.0
    zs = [(x - mean) / sd for x in xs]

    def loglik(a: float, b: float) -> float:
        total = 0.0
        for z, y in zip(zs, ys):
            t = a + b * z
            total += (t if y else 0.0) - (t + math.log1p(math.exp(-t)) if t > 0 else math.log1p(math.exp(t)))
        return total

    a = b = 0.0
    best = loglik(a, b)
    status = "not converged"
    for _ in range(200):
        g0 = g1 = h00 = h01 = h11 = 0.0
        for z, y in zip(zs, ys):
            t = a + b * z
            p = 1 / (1 + math.exp(-t)) if t >= 0 else math.exp(t) / (1 + math.exp(t))
            w = p * (1 - p)
            g0 += y - p
            g1 += (y - p) * z
            h00 += w
            h01 += w * z
            h11 += w * z * z
        det = h00 * h11 - h01 * h01
        if det <= 1e-12:
            break
        da = (h11 * g0 - h01 * g1) / det
        db = (h00 * g1 - h01 * g0) / det
        step = 1.0
        cand = loglik(a + da, b + db)
        while cand < best - 1e-12 and step > 1e-6:
            step /= 2
            cand = loglik(a + step * da, b + step * db)
        if cand < best - 1e-12:
            status = "converged"
            break
        a, b, gain = a + step * da, b + step * db, cand - best
        best = cand
        if abs(step * da) + abs(step * db) < 1e-9 or abs(gain) < 1e-12:
            status = "converged"
            break
    slope = b / sd
    intercept = a - b * mean / sd
    return {"status": status, "slope": round(slope, 6), "intercept": round(intercept, 6),
            "midpoint": round(-intercept / slope, 6) if slope else None}


def percentile(values: list[float], q: float) -> float:
    xs = sorted(values)
    if not xs:
        raise ValueError("no values")
    pos = q * (len(xs) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def bootstrap_interval(n_units: int, statistic, seed: int, reps: int = 2000, alpha: float = 0.05) -> dict:
    """Percentile bootstrap over units. `statistic` takes a list of unit indexes, or returns None."""
    rng = random.Random(seed)
    draws = []
    for _ in range(reps):
        value = statistic([rng.randrange(n_units) for _ in range(n_units)])
        if value is not None:
            draws.append(value)
    if not draws:
        return {"low": None, "high": None, "reps_used": 0}
    return {"low": round(percentile(draws, alpha / 2), 4), "high": round(percentile(draws, 1 - alpha / 2), 4),
            "reps_used": len(draws)}


def median(values: list[float]) -> float | None:
    xs = sorted(values)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2
