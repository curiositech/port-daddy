"""T1 controls.

* Scripted chooser: reads each offer's text exactly as a subject sees it,
  recovers the budget line (p_R, p_C, m) from the stated numbers, and buys
  the Cobb-Douglas bundle with review share ALPHA (or, with --linear, the
  corner a linear utility picks). Either maximizes a fixed utility on every
  line, so its CCEI is 1 by construction in every frame and pooled.
* Uniform random chooser: draws the review budget share uniformly on [0, 1]
  for each offer independently (Bronars 1987; Choi et al. 2007).

`simulate_random` gives the random chooser's CCEI distribution over 1,000
simulated sessions; this is the power benchmark sealed in
random_benchmark.json.
"""
from __future__ import annotations

import json
import random
import re
from fractions import Fraction as F
from pathlib import Path

ALPHA = F(2, 5)  # Cobb-Douglas review share for the scripted chooser
LINEAR_WEIGHTS = (F(60), F(1))  # linear utility: value per hour, per credit

_NUM = r"([0-9][0-9,]*(?:\.[0-9]+)?)"


def _f(s: str) -> F:
    return F(s.replace(",", ""))


def parse_offer(text: str) -> dict:
    """Recover the budget line from an offer's text. Returns p_R, p_C, m as Fractions.

    Uses only the words on the page; it never sees item metadata.
    """
    t = " ".join(text.split())
    m_intercept = re.search(rf"at most {_NUM} hours of human review .*? at most {_NUM} compute credits", t)
    if m_intercept:
        A, C = _f(m_intercept.group(1)), _f(m_intercept.group(2))
        m = F(1)  # any normalization: only the line matters
        return {"p_R": m / A, "p_C": m / C, "m": m}
    mb = re.search(rf"You have \${_NUM} to spend", t)
    if not mb:
        raise ValueError(f"no budget in offer: {text!r}")
    m = _f(mb.group(1))
    # review price
    if mm := re.search(rf"Human review costs \${_NUM} per hour", t):
        p_R = _f(mm.group(1))
    elif mm := re.search(rf"Human review is sold in {_NUM}-hour blocks at \${_NUM} per block", t):
        p_R = _f(mm.group(2)) / _f(mm.group(1))
    elif mm := re.search(rf"Human review lists at \${_NUM} per hour and is {_NUM}% off", t):
        p_R = _f(mm.group(1)) * (1 - _f(mm.group(2)) / 100)
    elif mm := re.search(rf"Human review is billed by the minute at {_NUM} cents per minute", t):
        p_R = _f(mm.group(1)) * 60 / 100
    else:
        raise ValueError(f"no review price in offer: {text!r}")
    # compute price
    if mm := re.search(rf"Compute costs \${_NUM} per credit", t):
        p_C = _f(mm.group(1))
    elif mm := re.search(rf"Compute is sold in packs of {_NUM} credits at \${_NUM} per pack", t):
        p_C = _f(mm.group(2)) / _f(mm.group(1))
    elif mm := re.search(rf"Compute lists at \${_NUM} per credit and is {_NUM}% off", t):
        p_C = _f(mm.group(1)) * (1 - _f(mm.group(2)) / 100)
    elif mm := re.search(rf"Compute costs {_NUM} cents per credit", t):
        p_C = _f(mm.group(1)) / 100
    elif mm := re.search(rf"Compute costs \${_NUM} per 1,000 credits", t):
        p_C = _f(mm.group(1)) / 1000
    else:
        raise ValueError(f"no compute price in offer: {text!r}")
    return {"p_R": p_R, "p_C": p_C, "m": m}


def parse_offers_file(path: Path) -> dict[int, str]:
    text = Path(path).read_text()
    out = {}
    for mt in re.finditer(r"\*\*Offer (\d+)\.\*\* (.+)", text):
        out[int(mt.group(1))] = mt.group(2).strip()
    return out


def scripted_choice(line: dict, linear: bool = False) -> tuple[float, float]:
    p_R, p_C, m = line["p_R"], line["p_C"], line["m"]
    if linear:
        wR, wC = LINEAR_WEIGHTS
        if wR / p_R >= wC / p_C:
            return float(m / p_R), 0.0
        return 0.0, float(m / p_C)
    return float(ALPHA * m / p_R), float((1 - ALPHA) * m / p_C)


def random_choice(line: dict, rng: random.Random) -> tuple[float, float]:
    s = rng.random()
    return float(s * line["m"] / line["p_R"]), float((1 - s) * line["m"] / line["p_C"])


def write_answers(offers_path: Path, answers_path: Path, agent: str, seed: int = 0) -> None:
    """Act as a subject: read offers.md, write answers.json."""
    offers = parse_offers_file(offers_path)
    rng = random.Random(seed)
    answers = []
    for n in sorted(offers):
        line = parse_offer(offers[n])
        if agent == "scripted":
            # Intercept offers parse with m = 1 and prices 1/A, 1/C; the bundle
            # m/p_R = A hours etc. is the same as from the dollar statement.
            R, C = scripted_choice(line)
        elif agent == "scripted-linear":
            R, C = scripted_choice(line, linear=True)
        elif agent == "random":
            R, C = random_choice(line, rng)
        else:
            raise ValueError(agent)
        answers.append({"offer": n, "review_hours": round(R, 6), "compute_credits": round(C, 6)})
    Path(answers_path).write_text(json.dumps(answers, indent=1) + "\n")


def simulate_random(budgets: list[dict], n_sessions: int, seed: int) -> list[dict]:
    """Simulate uniform random sessions on the sealed lines (both frames, pooled)."""
    from t1.garp import ccei, expenditure_matrix

    rng = random.Random(seed)
    prices = [(float(F(b["review_per_hour"])), float(F(b["compute_per_credit"]))) for b in budgets]
    lines = [{"p_R": F(b["review_per_hour"]), "p_C": F(b["compute_per_credit"]), "m": F(b["budget"])}
             for b in budgets]
    out = []
    for _ in range(n_sessions):
        plain = [random_choice(ln, rng) for ln in lines]
        refr = [random_choice(ln, rng) for ln in lines]
        c_plain = ccei(expenditure_matrix(prices, plain))
        c_refr = ccei(expenditure_matrix(prices, refr))
        c_pool = ccei(expenditure_matrix(prices + prices, plain + refr))
        shares = []
        for (R1, _), (R2, _), ln in zip(plain, refr, lines):
            m = float(ln["m"])
            pr = float(ln["p_R"])
            shares.append(abs(R1 * pr / m - R2 * pr / m))
        shares.sort()
        n = len(shares)
        median_ds = (shares[n // 2 - 1] + shares[n // 2]) / 2 if n % 2 == 0 else shares[n // 2]
        out.append({"ccei_plain": c_plain, "ccei_reframed": c_refr, "ccei_pooled": c_pool,
                    "frame_gap": min(c_plain, c_refr) - c_pool, "median_abs_share_diff": median_ds})
    return out
