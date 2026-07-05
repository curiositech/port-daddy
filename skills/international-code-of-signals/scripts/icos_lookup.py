#!/usr/bin/env python3
"""ICOS lookup — query the International Code of Signals corpus (Pub. 102).

Stdlib-only. Data: ../data/signals.json (parsed from the 1969/2003 US edition).

Usage:
  icos_lookup.py code <GROUP> [GROUP...]     Exact signal lookup (e.g. NC, AE 2, MAA, W)
  icos_lookup.py search <free text query>    HYBRID ranked search over all signal meanings
                                             (BM25 + `pd embed` semantic cosine, RRF-fused;
                                             degrades to BM25-only with a warning when the
                                             shared embedding model is unavailable)
  icos_lookup.py spell <TEXT>                Phonetic spelling (Alfa Bravo ...) + Morse
  icos_lookup.py hoist <GROUP>               Flag-hoist rendering notes incl. substitutes
  icos_lookup.py table <1|2|3>               Complements tables (means/assistance/direction)

Semantic search uses Port Daddy's ONE shared local embedding model via
`pd embed` (ADR-0061; AGENTS.md "Search & Matching Policy"). Corpus vectors
are computed once and cached under ~/.port-daddy/cache/. If `pd` is absent or
the model is not downloaded (`pd doctor` repairs that), search stays lexical.

Exit codes: 0 found, 1 not found / bad usage.
"""

import hashlib
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "signals.json"
EMBED_CACHE_DIR = Path(os.environ.get("PD_HOME", Path.home() / ".port-daddy")) / "cache"


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def all_entries(c):
    """Flatten every code-bearing entry into (code, meaning, origin) rows."""
    rows = []
    for letter, e in c["single_letter"].items():
        rows.append({"code": letter, "meaning": e["meaning"], "origin": "single-letter",
                     "colregs_note": e.get("colregs_note", False)})
    for e in c["single_letter_complements"]:
        rows.append({"code": f"{e['code']} <{e['complement']}>", "meaning": e["meaning"],
                     "origin": "single-letter-complement"})
    for code, meaning in c["procedure_signals"].items():
        rows.append({"code": code, "meaning": meaning, "origin": "procedure"})
    for e in c["general_code"]:
        rows.append({"code": e["code"], "meaning": e["meaning"], "origin": f"general/{e.get('section')}",
                     "topic": e.get("topic"), "see_also": e.get("see_also")})
    for e in c["medical_code"]:
        rows.append({"code": e["code"], "meaning": e["meaning"], "origin": f"medical/{e.get('section')}",
                     "topic": e.get("topic")})
    for e in c["icebreaker_signals"]:
        meaning = e.get("meaning") or f"Icebreaker: {e['icebreaker']} / Assisted: {e['assisted']}"
        rows.append({"code": e["code"], "meaning": meaning, "origin": "icebreaker"})
    return rows


def cmd_code(c, groups):
    rows = all_entries(c)
    query = " ".join(groups).upper().strip()
    hits = [r for r in rows if r["code"].upper() == query]
    # complement form "AE 2" stored with space; also accept "AE2"
    if not hits and re.fullmatch(r"[A-Z]{1,3}\d{1,2}", query):
        spaced = re.sub(r"(\d+)$", r" \1", query)
        hits = [r for r in rows if r["code"].upper() == spaced]
    if not hits:
        print(f"no signal '{query}' in the corpus", file=sys.stderr)
        return 1
    for r in hits:
        print(f"{r['code']}  [{r['origin']}]")
        print(f"  {r['meaning']}")
        if r.get("topic"):
            print(f"  topic: {r['topic']}")
        if r.get("see_also"):
            print(f"  equivalent single-letter signal: {r['see_also']}")
        if r.get("colregs_note"):
            print("  * by sound, only in compliance with COLREGS (Rule 34/35 contexts)")
    return 0


_word = re.compile(r"[a-z0-9]+")


def _tokens(text):
    return _word.findall(text.lower())


def _bm25_ranks(rows, terms):
    """BM25 over meanings → list of (score, index), best first."""
    docs = [_tokens(r["meaning"] + " " + (r.get("topic") or "")) for r in rows]
    n = len(docs)
    avgdl = sum(len(d) for d in docs) / n
    df = Counter()
    for d in docs:
        df.update(set(d))
    k1, b = 1.5, 0.75
    q = _tokens(" ".join(terms))
    scores = []
    for i, d in enumerate(docs):
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / avgdl))
        if s > 0:
            scores.append((s, i))
    scores.sort(reverse=True)
    return scores


def _pd_embed(texts):
    """Embed texts via `pd embed stdin --offline` (the shared local model).

    Returns list-of-vectors aligned with texts, or None when the surface is
    unavailable (no pd on PATH, model not downloaded, any failure). Texts must
    be non-empty single lines — `pd embed stdin` drops empty lines.
    """
    payload = "\n".join(t.replace("\n", " ").strip() or "-" for t in texts)
    try:
        proc = subprocess.run(
            ["pd", "embed", "stdin", "--offline"],
            input=payload.encode("utf-8"),
            capture_output=True,
            timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        out = json.loads(proc.stdout.decode("utf-8"))
        vectors = out["vectors"]
        return vectors if len(vectors) == len(texts) else None
    except (ValueError, KeyError):
        return None


def _corpus_vectors(rows):
    """Corpus embeddings via the shared model, cached one-time under PD_HOME."""
    meanings = [r["meaning"] for r in rows]
    digest = hashlib.sha256("\n".join(meanings).encode("utf-8")).hexdigest()[:16]
    cache_file = EMBED_CACHE_DIR / f"icos-signals-embeddings-{digest}.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except ValueError:
            pass
    print(
        f"embedding {len(meanings)} signal meanings via `pd embed` (one-time, cached)...",
        file=sys.stderr,
    )
    vectors = _pd_embed(meanings)
    if vectors is None:
        return None
    EMBED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(vectors), encoding="utf-8")
    return vectors


def _semantic_ranks(rows, terms):
    """Cosine ranks via the shared embedder, or None if it is unavailable."""
    corpus = _corpus_vectors(rows)
    if corpus is None:
        return None
    query = _pd_embed([" ".join(terms)])
    if query is None:
        return None
    qv = query[0]
    scored = []
    for i, v in enumerate(corpus):
        sim = sum(a * b for a, b in zip(qv, v))  # vectors are L2-normalized
        scored.append((sim, i))
    scored.sort(reverse=True)
    return scored


def cmd_search(c, terms, k=12):
    """Hybrid search: BM25 + shared-embedder cosine, fused with RRF.

    Policy (AGENTS.md "Search & Matching Policy"): never lexical-only unless
    the embedding surface is unavailable — and then degrade LOUDLY.
    """
    rows = all_entries(c)
    bm25 = _bm25_ranks(rows, terms)
    semantic = _semantic_ranks(rows, terms)
    if semantic is None:
        print(
            "warning: shared embedding model unavailable — lexical-only results. "
            "Repair: pd doctor  (or: pd embed prefetch)",
            file=sys.stderr,
        )
        fused = bm25
    else:
        # Weighted RRF over symmetric top-50 lists. Semantic gets the heavier
        # weight: exact-token queries are already served by `code`, and the
        # probe suite (paraphrase / towing / sick-crew) ranks best at 0.7/1.3.
        trunc = max(50, k * 4)
        rrf = Counter()
        for rank, (_, i) in enumerate(bm25[:trunc]):
            rrf[i] += 0.7 / (60 + rank)
        for rank, (_, i) in enumerate(semantic[:trunc]):
            rrf[i] += 1.3 / (60 + rank)
        fused = sorted(((s, i) for i, s in rrf.items()), reverse=True)
    if not fused:
        print("no matches", file=sys.stderr)
        return 1
    for s, i in fused[:k]:
        r = rows[i]
        print(f"{s:6.4f}  {r['code']:<10} {r['meaning'][:110]}  [{r['origin']}]")
    return 0


def cmd_spell(c, words):
    text = " ".join(words).upper()
    phon, morse = [], []
    for ch in text:
        if ch in c["phonetic_letters"]:
            phon.append(c["phonetic_letters"][ch])
            morse.append(c["morse"][ch])
        elif ch.isdigit():
            phon.append(c["phonetic_figures"][ch])
            morse.append(c["morse"][ch])
        elif ch == " ":
            phon.append("/")
            morse.append("/")
        elif ch == ".":
            phon.append("DECIMAL")
            morse.append("AAA(.-.-.-)")
    print("phonetic:", " ".join(phon))
    print("morse:   ", " ".join(morse))
    return 0


def cmd_hoist(c, groups):
    group = "".join(groups).upper().replace(" ", "")
    # Substitute rule (Ch.1 Sec.5 para.6): the Nth substitute repeats the Nth
    # flag counting from the top of the same class, substitutes included as
    # positions; no substitute may be used twice in one group.
    positions = {}  # class -> list of effective chars at each hoisted position
    used_subs = {}  # class -> set of substitute numbers already used
    out = []
    for ch in group:
        klass = "numeral" if ch.isdigit() else "alpha"
        seq = positions.setdefault(klass, [])
        used = used_subs.setdefault(klass, set())
        if ch in seq:
            n = next((i + 1 for i, eff in enumerate(seq) if eff == ch and (i + 1) not in used), None)
            if n is None or n > 3:
                out.append(f"UNSIGNALABLE repeat of {ch} (only three substitutes exist)")
                seq.append(ch)
                continue
            used.add(n)
            ordinal = {1: "first", 2: "second", 3: "third"}[n]
            out.append(f"{ordinal} substitute (repeats {ch})")
            seq.append(ch)
        else:
            seq.append(ch)
            flag = c["phonetic_letters"].get(ch, f"numeral pennant {ch}")
            out.append(flag)
    print(f"hoist for '{group}' (single halyard, read top-down):")
    for i, f in enumerate(out, 1):
        print(f"  {i}. {f}")
    print("close with: answering pennant hoisted singly = signal completed")
    return 0


def cmd_table(c, n):
    t = c["complements_tables"].get(n)
    if not t:
        print("tables are 1, 2, 3", file=sys.stderr)
        return 1
    print(t["title"])
    for k in sorted(t["values"]):
        print(f"  {k}: {t['values'][k]}")
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    c = load()
    cmd, args = argv[1], argv[2:]
    if cmd == "code" and args:
        return cmd_code(c, args)
    if cmd == "search" and args:
        return cmd_search(c, args)
    if cmd == "spell" and args:
        return cmd_spell(c, args)
    if cmd == "hoist" and args:
        return cmd_hoist(c, args)
    if cmd == "table" and args:
        return cmd_table(c, args[0])
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
