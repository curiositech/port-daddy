#!/usr/bin/env python3
"""humanize_review.py — flag AI-isms in copy/media and emit a static HTML fix plan.

Stdlib only. Two detection layers:

  1. STRUCTURAL (this script): countable signals only — densities, variances,
     ratios, codepoints, hex values, font names, identifier overlap.
  2. LLM-JUDGE (the agent running the skill): phrase-level tropes are judged
     by the model against references/catalog.json, written to a findings JSON,
     and merged into the report via --findings.

THREE THINGS THIS SCRIPT BELIEVES, each of which cost someone a false accusation
to learn:

  (a) Residue is not style. U+202F before an em dash, `utm_source=chatgpt.com`,
      and `oaicite` are machine artifacts with essentially no human source. They
      are reported high, absolutely, with no hedging.

  (b) Rhythm is not evidence. Em-dash rate, comma rate, contraction rate and
      sentence-length variance all overlap heavily between models and humans.
      Melville runs 8.1 em dashes per 1,000 words; Llama runs zero. The gptme
      anti-slop detector measured its em-dash rule flagging ~64% of legitimate
      technical blog posts. So this family is capped at LOW severity on its own
      and only escalates when --baseline shows a jump against THIS author's own
      prior writing.

  (c) The catalog owns the numbers. Thresholds live in references/catalog.json
      under each item's "thresholds" key. DEFAULT_THRESHOLDS below is only the
      fallback for a copy of this script living outside its bundle. Previously
      the catalog said 5/1000 words and the code said 12/1000; nobody noticed
      because nothing tied them together.

Every ism id emitted here is a real key in catalog.json; --validate proves it.
That is what lets a finding be joined back to its rubric, fix, and sources.

Usage:
  python3 scripts/humanize_review.py FILE [FILE...] --out report.html
  python3 scripts/humanize_review.py FILE --baseline 'posts/*.md' --out report.html
  python3 scripts/humanize_review.py FILE --findings judge.json --out report.html
  python3 scripts/humanize_review.py FILE --fail-on high          # CI gate
  python3 scripts/humanize_review.py --selftest
  python3 scripts/humanize_review.py --validate

Suppression: wrap quoted or demonstrative material in
  <!-- humanize:ignore-start --> ... <!-- humanize:ignore-end -->
A document that exhibits AI-isms on purpose needs this, or it flags its own
evidence. This skill's own examples do.

Findings JSON (from the agent's judge pass):
  [{"file": "...", "line": 12, "excerpt": "...", "ism": "negation-contrast-frame",
    "dialect": "claude", "severity": "high", "explanation": "...",
    "rewrite": "..."}]
"""

import argparse
import glob as globmod
import html
import json
import re
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "references" / "catalog.json"

# Fallback only. The catalog overrides every one of these when present.
DEFAULT_THRESHOLDS = {
    "em-dash-density": {"min_words": 120, "cue": 1.0, "baseline_ratio": 2.5},
    "comma-inflation": {"min_words": 200, "cue": 9.0, "baseline_ratio": 1.5},
    "staccato-fragment-triplet": {"min_sentences": 8, "max_words": 4, "cue": 0.22},
    "low-burstiness-uniform-rhythm": {"min_sentences": 12, "cue_cv": 0.42, "baseline_ratio": 0.7},
    "zero-typo-zero-contraction-affect-flatness": {"min_words": 250, "baseline_ratio": 0.5},
    "deontic-softening": {"min_modals": 4, "cue_ratio": 0.8},
    "participial-tail": {"min_words": 150, "cue_per_100w": 0.7},
    "nominalization-density": {"min_words": 150, "cue_per_100w": 7.0},
    "copula-avoidance": {"min_copular": 6, "cue_share": 0.35},
    "pronoun-evacuation": {"min_words": 250, "cue_per_100w": 0.8},
    "specificity-starvation": {"min_words": 300, "cue_per_100w": 2.0},
    "linkedin-broetry-one-line-runs": {"min_run": 4, "max_words_per_line": 14},
    "heading-spam": {"min_headings": 5, "ratio": 0.5},
    "bullet-colonization-of-prose": {"min_bullets": 10, "cue_share": 0.45},
    "bold-label-colon-bullet": {"min_count": 4},
    "arrow-chain-as-explanation": {"min_arrows": 2},
    "emoji-section-headers": {"min_count": 2},
    "checkmark-bullet-grid": {"min_count": 3},
    "horizontal-rule-spam": {"min_count": 3},
    "title-case-heading-uniformity": {"min_headings": 4, "share": 0.8},
    "heading-level-skip": {"min_headings": 3},
    "challenges-and-future-directions": {"min_count": 1},
    "invisible-unicode-artifacts": {"min_count": 1},
    "curly-straight-quote-mixing": {"min_of_each": 2},
    "markdown-leak-in-unrendered-medium": {"min_count": 3},
    "tracking-param-residue": {"min_count": 1},
    "model-markup-residue": {"min_count": 1},
    "ai-default-token-repetition": {"min_count": 3},
    "comment-narrates-next-line": {"min_count": 2, "overlap": 0.6},
    "docstring-restates-signature": {"min_count": 1},
    "swallow-exception-pass": {"min_count": 1},
    "placeholder-stub-residue": {"min_count": 2},
    "decorative-section-divider": {"min_count": 2},
    "emoji-in-code": {"min_count": 1},
}


def load_catalog():
    try:
        return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"items": [], "sources": []}


CATALOG = load_catalog()
CATALOG_NAMES = {i["name"] for i in CATALOG.get("items", [])}
_CAT_TH = {i["name"]: i.get("thresholds", {}) for i in CATALOG.get("items", [])}


def th(ism, key, fallback=None):
    """Threshold lookup: catalog first, bundled fallback second."""
    v = _CAT_TH.get(ism, {}).get(key)
    if v is None:
        v = DEFAULT_THRESHOLDS.get(ism, {}).get(key, fallback)
    return v


# ---------------------------------------------------------------- constants

AI_DEFAULT_HEXES = {
    "6366f1": "indigo-500 — the v0/Lovable/artifact default accent",
    "8b5cf6": "violet-500 — the AI gradient partner",
    "7c3aed": "violet-600",
    "4f46e5": "indigo-600",
    "a855f7": "purple-500",
    "3b82f6": "blue-500 — the other default accent",
    "2563eb": "blue-600",
}

AI_DEFAULT_FONTS = {
    "inter": "Inter — the unchosen default of AI-generated UI",
    "geist": "Geist — Vercel default, marks v0 output",
    "sora": "Sora — AI-landing-page cliché",
    "manrope": "Manrope — AI-landing-page cliché",
    "space grotesk": "Space Grotesk — AI-landing-page cliché",
    "plus jakarta sans": "Plus Jakarta Sans — the newer unchosen default",
    "outfit": "Outfit — AI-landing-page cliché",
}

AI_DEFAULT_TOKENS = {
    "backdrop-blur": "glassmorphism applied rather than chosen",
    "rounded-2xl": "the generated card radius",
    "bg-gradient-to-r": "the gradient headline nobody asked for",
    "bg-clip-text": "gradient text — the generated-hero signature",
    "from-indigo": "the indigo gradient stop",
    "from-purple": "the purple gradient stop",
    "bg-grid-": "the dot/line grid hero background",
    "animate-pulse": "skeleton shimmer used as decoration",
}

# CLOSED SET of machine artifacts. Not a keyword list about topics or style —
# these strings have no human source outside quotation, and quoted regions are
# excluded before this runs. Reported high, absolutely.
LEAKAGE_SIGNATURES = (
    "as an ai language model", "as a large language model",
    "i cannot fulfill that request", "i'm sorry, but as an ai",
    "i do not have access to real-time", "as of my last update",
    "i cannot browse the internet", "i don't have personal opinions",
)

# Vendor scaffolding that leaks into pasted output. Sourced from Wikipedia's
# WikiProject AI Cleanup, which catalogs these per vendor.
MARKUP_RESIDUE = {
    "oaicite": "ChatGPT citation token",
    "contentreference": "ChatGPT citation token",
    "turn0search": "ChatGPT search-result token",
    "attributableindex": "ChatGPT attribution token",
    "grok_render_citation_card_json": "Grok citation card",
    "ppl-ai-file-upload": "Perplexity upload artifact",
    ":::writing": "unclassified model wrapper",
    "[cite_start]": "Gemini citation token",
    "(start_span)": "Gemini span token",
}

TRACKING_PARAMS = re.compile(
    r"utm_source=(chatgpt|openai|perplexity|copilot|claude)[.\w]*", re.I)

# humanize:ignore-start -- the lines below ARE the specimens this script
# detects, so reviewing this file with this file flags its own patterns.
EMOJI_RANGES = (
    (0x1F300, 0x1FAFF), (0x2600, 0x27BF), (0x2B00, 0x2BFF), (0xFE0F, 0xFE0F),
)

# Structure-marking dingbats, kept separate from decorative emoji: "✓ done" in a
# checklist is a milder tell than "🚀 Features" as an H2, and conflating the two
# made a single ✓ fire at high severity.
CHECK_GLYPHS = "✅✔✓☑❌✗✖⚠🔴🟢🟡➡▶🎯💡🔥⭐"

# Invisible codepoints that survive a copy-paste out of a chat UI. U+202F is the
# strongest single countable tell available: no mainstream keyboard produces it,
# and no word processor inserts it around a dash. This is residue, not taste.
INVISIBLE_CODEPOINTS = {
    " ": "U+202F narrow no-break space — chat-UI residue, usually around em dashes",
    "​": "U+200B zero-width space",
    "‌": "U+200C zero-width non-joiner",
    "﻿": "U+FEFF byte-order mark mid-document",
    "⁠": "U+2060 word joiner",
    "­": "U+00AD soft hyphen",
}

# Closed set of GRAMMATICAL FORMS, measured as a rate. Not a topic list: these
# are the participles Reinhart et al. (PNAS 2025) measured GPT-4o emitting at
# 5.3x the human rate, the top-ranked feature across a 66-feature Biber tagset.
PARTICIPLE_TAILS = (
    "highlighting", "underscoring", "emphasizing", "reflecting", "showcasing",
    "demonstrating", "symbolizing", "positioning", "signaling", "cementing",
    "solidifying", "fostering", "cultivating", "encompassing", "enhancing",
    "contributing", "ensuring", "marking", "illustrating", "reinforcing",
)

# Copula substitutes. Wikipedia's AI Cleanup project lists avoidance of basic
# copulas as a top-level sign; it survives synonym-swapping because it is
# grammatical rather than lexical.
COPULA_SUBSTITUTES = (
    "serves as", "stands as", "functions as", "operates as", "acts as",
    "represents a", "represents the", "boasts", "features a", "features the",
    "maintains a", "offers a", "refers to a",
)

POSITIVE_DEONTIC = ("should", "have to", "has to", "had to", "ought to")
FORMAL_DEONTIC = ("must", "need to", "needs to", "cannot", "is required to")

# humanize:ignore-end

FIRST_SECOND_PRONOUN = re.compile(
    r"\b(i|me|my|mine|myself|we|us|our|ours|you|your|yours)\b", re.I)

NOMINALIZATION = re.compile(
    r"\b\w{4,}(tion|sion|ment|ance|ence|ization|isation)s?\b", re.I)

CHALLENGES_HEADING = re.compile(
    r"^\s*#{1,6}\s*(challenges and (future directions|legacy|opportunities)"
    r"|future (directions|outlook|prospects)|looking ahead)\s*$", re.I | re.M)

RENDERS_MARKDOWN = {".md", ".markdown", ".mdx", ".rst"}
MARKUP_EXT = {".html", ".htm", ".css", ".jsx", ".tsx", ".vue", ".svelte"}
CODE_EXT = {".py", ".rs", ".go", ".js", ".ts", ".jsx", ".tsx", ".java", ".rb",
            ".c", ".h", ".cpp", ".swift", ".kt", ".sh"}

COMMENT_PREFIX = re.compile(r"^\s*(?://|#|--)\s?(.*)$")
SEV_ORDER = {"high": 0, "medium": 1, "low": 2}
VALID_SEV = ("high", "medium", "low")

STOPWORDS = {
    "the", "a", "an", "this", "that", "these", "those", "and", "or", "but",
    "for", "to", "of", "in", "on", "at", "by", "with", "from", "into", "then",
    "here", "there", "it", "its", "is", "are", "was", "were", "be", "been",
    "we", "you", "our", "your", "if", "as", "so", "not", "no", "all", "each",
    "new", "now", "use", "using", "used", "will", "can", "may", "should",
}


# ------------------------------------------------------------- segmentation

def classify_lines(text, suffix=".md"):
    """Tag every line: prose | code | quote | meta | ignored.

    Density detectors read `prose` only. Counting an em dash inside a code
    fence, a YAML description, or a deliberately-quoted Before sample against
    the author was the single largest false-positive source in the previous
    version: this skill's own examples flagged the AI-isms they exist to show.
    """
    lines = text.splitlines()
    tags = ["prose"] * len(lines)
    in_fence = in_front = in_ignore = False
    fence_mark = ""

    for i, raw in enumerate(lines):
        s = raw.strip()
        if "humanize:ignore-start" in s:
            in_ignore = True
        if in_ignore:
            tags[i] = "ignored"
            if "humanize:ignore-end" in s:
                in_ignore = False
            continue
        if i == 0 and s == "---" and suffix in RENDERS_MARKDOWN:
            in_front = True
            tags[i] = "meta"
            continue
        if in_front:
            tags[i] = "meta"
            if s == "---":
                in_front = False
            continue
        m = re.match(r"^(`{3,}|~{3,})", s)
        if m:
            if not in_fence:
                in_fence, fence_mark = True, m.group(1)[0]
            elif m.group(1)[0] == fence_mark:
                in_fence = False
            tags[i] = "code"
            continue
        if in_fence:
            tags[i] = "code"
            continue
        if re.match(r"^\s*>", raw):
            tags[i] = "quote"
        elif re.match(r"^\s*(\||<!--)", s) or s.startswith("[//]:"):
            tags[i] = "meta"
    return lines, tags


def strip_markup(text):
    """HTML to plain text. Removes style/script BODIES, not just their tags:
    leaving CSS in the 'prose' inflated every density denominator."""
    text = re.sub(r"<(style|script)\b[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    return re.sub(r"<[^>]+>", " ", text)


def strip_code_comments(text):
    """Drop comment bodies before scanning structured values, so a hex named in
    a comment, a changelog, or a doc about this very tell is not a finding."""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"(?m)^\s*(//|#).*$", " ", text)
    return re.sub(r"<!--.*?-->", " ", text, flags=re.S)


def mask_ignored(lines):
    """Blank out humanize:ignore regions while preserving line numbering.

    The markers used to work only in the prose path, so a source file that
    defines the very patterns this script detects flagged itself. Any analyzer
    that reads raw lines has to go through here.
    """
    out, in_ignore = [], False
    for raw in lines:
        if "humanize:ignore-start" in raw:
            in_ignore = True
        if in_ignore:
            out.append("")
            if "humanize:ignore-end" in raw:
                in_ignore = False
        else:
            out.append(raw)
    return out


def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def word_count(text):
    return len(re.findall(r"[A-Za-z0-9'’-]+", text))


def is_emoji(ch):
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in EMOJI_RANGES)


def ident_words(s):
    """camelCase, snake_case, kebab-case and PascalCase to comparable tokens."""
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", s)
    return {w.lower() for w in re.findall(r"[A-Za-z]{3,}", s)}


def finding(file, line, excerpt, ism, severity, explanation, rewrite="",
            dialect="generic-llm", family="form"):
    if severity not in VALID_SEV:
        severity = "low"
    return {
        "file": str(file), "line": line, "excerpt": str(excerpt)[:300], "ism": ism,
        "dialect": dialect, "severity": severity, "explanation": explanation,
        "rewrite": rewrite, "layer": "structural", "family": family,
    }


# --------------------------------------------------------------- baselining

def prose_metrics(text, suffix=".md"):
    """The countable rhythm signals, as rates. Used both for the target file and
    for a --baseline corpus of the author's own known-human writing."""
    lines, tags = classify_lines(text, suffix)
    body = "\n".join(l for l, t in zip(lines, tags) if t == "prose")
    words = word_count(body)
    if words < 50:
        return None
    sents = split_sentences(body)
    lens = [word_count(s) for s in sents] or [1]
    mean = statistics.mean(lens)
    dashes = sum(l.count("—") for l in body.splitlines()) \
        + len(re.findall(r"(?<=\w)--(?=\w)", body))
    return {
        "words": words,
        "em_dash_per_100w": dashes / words * 100,
        "comma_per_100w": body.count(",") / words * 100,
        "contraction_per_100w":
            len(re.findall(r"\b\w+[’'](?:t|s|re|ve|ll|d|m)\b", body)) / words * 100,
        "sentence_cv": (statistics.pstdev(lens) / mean) if mean else 1.0,
        "pronoun_per_100w": len(FIRST_SECOND_PRONOUN.findall(body)) / words * 100,
    }


def build_baseline(paths):
    """Pool the author's own writing into one metric set. A writer's baseline is
    their own: this is what makes the rhythm family fair to a non-native
    speaker, an autistic writer, or anyone who simply loves dashes."""
    mets = []
    for p in paths:
        try:
            m = prose_metrics(Path(p).read_text(encoding="utf-8", errors="replace"),
                              Path(p).suffix.lower())
        except Exception:
            continue
        if m:
            mets.append(m)
    if not mets:
        return None
    keys = [k for k in mets[0] if k != "words"]
    total = sum(m["words"] for m in mets)
    return {"files": len(mets), "words": total,
            **{k: sum(m[k] * m["words"] for m in mets) / total for k in keys}}


def rhythm_finding(path, line, excerpt, ism, explanation, rewrite, dialect,
                   observed, base_value, direction, ratio_key):
    """Rhythm signals are LOW on their own and escalate only against the
    author's own baseline. Absolute punctuation thresholds tuned on model text
    flag most careful human text too: the gptme anti-slop detector measured its
    em-dash rule warning on ~64% of legitimate technical blog posts."""
    sev, note = "low", " (cue only — no baseline supplied, so this is not evidence of anything)"
    if base_value is not None and base_value > 0:
        ratio = observed / base_value
        want = th(ism, ratio_key, 2.0)
        crossed = ratio >= want if direction == "up" else ratio <= want
        if crossed:
            sev = "high"
            note = (f" — {ratio:.1f}x this author's own baseline of "
                    f"{base_value:.2f}, which is the signal that matters")
        else:
            return None
    return finding(path, line, excerpt + note, ism, sev, explanation, rewrite,
                   dialect, family="rhythm")


# ------------------------------------------------------------ prose signals

def analyze_prose(path, text, suffix=".md", base=None):
    out = []
    lines, tags = classify_lines(text, suffix)
    prose_lines = [l for l, t in zip(lines, tags) if t == "prose"]
    body = "\n".join(prose_lines)
    words = word_count(body)

    def where(pred, default=1):
        return next((i + 1 for i, (l, t) in enumerate(zip(lines, tags))
                     if t == "prose" and pred(l)), default)

    # ---------------------------------------------- RESIDUE. High, absolutely.
    scan = "".join(l for l, t in zip(lines, tags) if t != "ignored")
    invis = {ch: (scan.count(ch), lab) for ch, lab in INVISIBLE_CODEPOINTS.items()
             if scan.count(ch)}
    if invis:
        out.append(finding(
            path, where(lambda l: any(c in l for c in invis), 1),
            "; ".join(f"{n}x {lab}" for n, lab in invis.values()),
            "invisible-unicode-artifacts",
            "high" if " " in invis else "medium",
            "Invisible codepoints no keyboard emits. U+202F around an em dash in "
            "particular is chat-UI residue: the text was pasted out of a model's "
            "output rather than typed.",
            "Normalize whitespace before judging anything else: U+202F and U+00A0 "
            "to a plain space, zero-width characters deleted.",
            "chatgpt", family="residue"))

    for tok, label in MARKUP_RESIDUE.items():
        if tok in scan.lower():
            out.append(finding(
                path, where(lambda l: tok in l.lower()), tok, "model-markup-residue",
                "high", f"{label} left in the text. This is the model's own "
                "scaffolding, not a style choice.",
                "Grep and delete. Then check whether the citation it was attached "
                "to points at anything real.", "chatgpt", family="residue"))
            break

    trk = TRACKING_PARAMS.findall(scan)
    if trk:
        out.append(finding(
            path, where(lambda l: TRACKING_PARAMS.search(l)),
            f"{len(trk)} chat-attribution tracking param(s)", "tracking-param-residue",
            "high", "A URL carrying utm_source=chatgpt.com was copied out of a chat "
            "window. It is a fingerprint, not an inference.",
            "Strip query params from every URL before shipping.",
            "chatgpt", family="residue"))

    low_body = body.lower()
    for sig in LEAKAGE_SIGNATURES:
        if sig in low_body:
            out.append(finding(
                path, where(lambda l: sig in l.lower()), sig, "as-an-ai-leakage", "high",
                "Raw model artifact in shipped copy. Not a stylistic tell — the seam "
                "showing.",
                "Delete the sentence and write what it was meant to say.",
                family="residue"))
            break

    if words == 0:
        return out

    # ------------------------------------------- RHYTHM. Low without a baseline.
    m = prose_metrics(text, suffix)
    if m and m["words"] > th("em-dash-density", "min_words", 120):
        if m["em_dash_per_100w"] > th("em-dash-density", "cue", 1.0):
            f = rhythm_finding(
                path, where(lambda l: "—" in l),
                f"{m['em_dash_per_100w']:.2f} em dashes/100w",
                "em-dash-density",
                "Em-dash rate is a cue, not evidence. Human means cluster near "
                "0.32/100w and GPT-4-class near 1.06, but Melville runs 0.81 and "
                "Llama runs zero — the distributions overlap badly.",
                "Replace most with periods, commas, or parentheses. Keep the ones "
                "doing work no other mark can do.",
                "claude", m["em_dash_per_100w"],
                base and base.get("em_dash_per_100w"), "up", "baseline_ratio")
            if f:
                out.append(f)
        if m["comma_per_100w"] > th("comma-inflation", "cue", 9.0):
            f = rhythm_finding(
                path, 1, f"{m['comma_per_100w']:.1f} commas/100w", "comma-inflation",
                "Parenthetical smoothing: every clause gets an appositive. Measured "
                "at +66% under LLM revision, but weak on its own.",
                "Break the sentence in two instead of adding a clause to it.",
                "generic-llm", m["comma_per_100w"],
                base and base.get("comma_per_100w"), "up", "baseline_ratio")
            if f:
                out.append(f)
        if m["contraction_per_100w"] < 0.4 and m["words"] > th(
                "zero-typo-zero-contraction-affect-flatness", "min_words", 250):
            f = rhythm_finding(
                path, 1, f"{m['contraction_per_100w']:.2f} contractions/100w",
                "zero-typo-zero-contraction-affect-flatness",
                "A register with no relaxed setting. Note the real finding is "
                "directional: models pull formal sources slightly MORE casual and "
                "casual sources much more formal.",
                "Use contractions where a person saying this sentence aloud would.",
                "chatgpt", m["contraction_per_100w"],
                base and base.get("contraction_per_100w"), "down", "baseline_ratio")
            if f:
                out.append(f)
        if m["pronoun_per_100w"] < th("pronoun-evacuation", "cue_per_100w", 0.8):
            f = rhythm_finding(
                path, 1, f"{m['pronoun_per_100w']:.2f} first/second-person pronouns/100w",
                "pronoun-evacuation",
                "The writer has disappeared from their own sentences. LLM editing "
                "removes 40-61% of pronouns, and voice-preserving prompts recover "
                "only 10-15% of that.",
                "Put the person back. If the sentence describes something someone "
                "did, decided, or saw, name them as the subject.",
                "generic-llm", m["pronoun_per_100w"],
                base and base.get("pronoun_per_100w"), "down", "baseline_ratio")
            if f:
                out.append(f)

    sents = split_sentences(body)
    if len(sents) >= th("staccato-fragment-triplet", "min_sentences", 8):
        lens = [word_count(s) for s in sents]
        cap = th("staccato-fragment-triplet", "max_words", 4)
        share = sum(1 for n in lens if n <= cap) / len(lens)
        if share > th("staccato-fragment-triplet", "cue", 0.22):
            out.append(finding(
                path, 1, f"{share:.0%} of {len(lens)} sentences are <={cap} words",
                "staccato-fragment-triplet", "medium",
                "Runs of clipped fragments are a signature model rhythm: emphasis "
                "applied by chopping rather than by word choice.",
                "Merge the fragments back into the sentence they were cut from. The "
                "fix is fewer sentences, not longer ones.",
                "claude", family="rhythm"))
        if m and len(lens) >= th("low-burstiness-uniform-rhythm", "min_sentences", 12) \
           and m["sentence_cv"] < th("low-burstiness-uniform-rhythm", "cue_cv", 0.42):
            f = rhythm_finding(
                path, 1, f"sentence-length CV {m['sentence_cv']:.2f} over {len(lens)} sentences",
                "low-burstiness-uniform-rhythm",
                "Near-constant sentence length. Human prose scatters more widely; "
                "models cluster in the 10-30 token band. Reported as coefficient of "
                "variation, not as a proprietary 'burstiness score'.",
                "Break one sentence in four. Then let one run long.",
                "generic-llm", m["sentence_cv"],
                base and base.get("sentence_cv"), "down", "baseline_ratio")
            if f:
                out.append(f)

    # ------------------------------------ FORM. Closed grammatical classes.
    if words > th("participial-tail", "min_words", 150):
        tails = re.findall(
            r",\s+(" + "|".join(PARTICIPLE_TAILS) + r")\b[^.!?]*[.!?]", body, re.I)
        rate = len(tails) / words * 100
        if rate > th("participial-tail", "cue_per_100w", 0.7):
            out.append(finding(
                path, where(lambda l: re.search(
                    r",\s+(" + "|".join(PARTICIPLE_TAILS) + r")\b", l, re.I)),
                f"{len(tails)} sentence-final participial clauses ({rate:.2f}/100w)",
                "participial-tail", "high",
                "The commentary clause bolted onto a finished sentence — "
                "'..., underscoring its importance'. GPT-4o emits these at 5.3x the "
                "human rate, the top-ranked discriminating feature in a 66-feature "
                "grammatical study.",
                "Delete the clause, or promote it to its own sentence with a subject "
                "and a claim someone could check. If it cannot survive that, it was "
                "filler.", family="form"))

        noms = NOMINALIZATION.findall(body)
        nrate = len(noms) / words * 100
        if nrate > th("nominalization-density", "cue_per_100w", 7.0):
            out.append(finding(
                path, 1, f"{len(noms)} nominalizations in {words} words ({nrate:.1f}/100w)",
                "nominalization-density", "medium",
                "Verbs converted to abstract nouns and propped up with a weak verb — "
                "'the implementation of', 'provides an enhancement to'. Measured at "
                "roughly 2x the human rate; instruction tuning specifically rewards "
                "this noun-heavy register.",
                "Turn the noun back into a verb and give it a subject. 'We added a "
                "caching layer. Latency dropped.'", family="form"))

    copula_subs = sum(low_body.count(c) for c in COPULA_SUBSTITUTES)
    copulas = len(re.findall(r"\b(is|are|was|were)\b", low_body))
    if copula_subs + copulas >= th("copula-avoidance", "min_copular", 6) \
       and copula_subs / max(copula_subs + copulas, 1) > th("copula-avoidance", "cue_share", 0.35):
        out.append(finding(
            path, where(lambda l: any(c in l.lower() for c in COPULA_SUBSTITUTES)),
            f"{copula_subs} copula substitutes vs {copulas} plain copulas",
            "copula-avoidance", "medium",
            "'Serves as', 'stands as', 'boasts' standing in for 'is'. Grammatical "
            "rather than lexical, so it survives synonym-swapping — which is exactly "
            "why it is a better signal than any single word.",
            "Restore the copula. If the sentence feels thin with 'is', the problem is "
            "the claim, not the verb.", family="form"))

    pos_d = sum(len(re.findall(r"\b" + re.escape(w) + r"\b", low_body)) for w in POSITIVE_DEONTIC)
    fml_d = sum(len(re.findall(r"\b" + re.escape(w) + r"\b", low_body)) for w in FORMAL_DEONTIC)
    if pos_d + fml_d >= th("deontic-softening", "min_modals", 4) \
       and pos_d / max(fml_d, 1) < th("deontic-softening", "cue_ratio", 0.8):
        out.append(finding(
            path, where(lambda l: any(w in l.lower() for w in FORMAL_DEONTIC)),
            f"{fml_d} procedural modals (must/need to/cannot) vs {pos_d} personal "
            f"(should/have to)", "deontic-softening", "medium",
            "Obligation expressed procedurally rather than personally. Across eleven "
            "models the personal deontic modals sit near the 4th percentile of "
            "underuse — more underused than 96% of common vocabulary.",
            "Use the modal a person would say out loud: 'can't' not 'cannot', "
            "'have to' not 'need to'. Say 'should' when you mean should.",
            family="form"))

    if words > th("specificity-starvation", "min_words", 300):
        mid_caps = len(re.findall(r"(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}", body, flags=re.M))
        numbers = len(re.findall(r"\b\d[\d,.]*\b", body))
        rate = (mid_caps + numbers) / words * 100
        if rate < th("specificity-starvation", "cue_per_100w", 2.0):
            out.append(finding(
                path, 1, f"{mid_caps} proper nouns + {numbers} numerals in {words} "
                         f"words ({rate:.1f}/100w)",
                "specificity-starvation", "medium",
                "Almost nothing here could be checked, dated, or attributed. People "
                "write from particulars — a name, a number, a Tuesday. A model writes "
                "from the average of everything, and the average has no particulars "
                "in it.",
                "Add the specifics you know: who, how many, when, which version. If "
                "you can't, you may not have anything to say yet.", family="form"))

    # ------------------------------------------------------- DOCUMENT SHAPE
    run = best_run = run_line = 0
    max_w = th("linkedin-broetry-one-line-runs", "max_words_per_line", 14)
    for i, (l, t) in enumerate(zip(lines, tags)):
        s = l.strip()
        if t == "prose" and s and not s.startswith(("#", "-", "*", ">", "|")) \
           and len(s.split()) <= max_w and i + 1 < len(lines) and not lines[i + 1].strip():
            run += 1
            if run > best_run:
                best_run, run_line = run, i + 1
        elif s:
            run = 0
    if best_run >= th("linkedin-broetry-one-line-runs", "min_run", 4):
        out.append(finding(
            path, run_line, f"run of {best_run} consecutive one-line paragraphs",
            "linkedin-broetry-one-line-runs", "medium",
            "Line breaks doing the work that emphasis should do.",
            "Group related lines into real paragraphs. Keep the break for the one "
            "line that earns it.", "chatgpt"))

    heads = [(i + 1, l) for i, (l, t) in enumerate(zip(lines, tags))
             if t == "prose" and re.match(r"\s{0,3}#{1,6}\s", l)]
    bullets = [(i + 1, l) for i, (l, t) in enumerate(zip(lines, tags))
               if t == "prose" and re.match(r"\s*([-*+]|\d+\.)\s", l)]
    paras = sum(1 for i, (l, t) in enumerate(zip(lines, tags))
                if t == "prose" and l.strip()
                and not re.match(r"\s*([-*+#>|]|\d+\.)", l)
                and (i == 0 or not lines[i - 1].strip()))
    nonblank = sum(1 for l, t in zip(lines, tags) if t == "prose" and l.strip())

    if len(heads) >= th("heading-spam", "min_headings", 5) and paras \
       and len(heads) / paras > th("heading-spam", "ratio", 0.5):
        out.append(finding(
            path, heads[0][0], f"{len(heads)} headings vs {paras} paragraphs",
            "heading-spam", "medium",
            "A heading every paragraph or two is the outline the model was given, "
            "left in place.",
            "Cut headings that label a single paragraph. Let prose carry transitions."))

    if nonblank and len(bullets) >= th("bullet-colonization-of-prose", "min_bullets", 10) \
       and len(bullets) / nonblank > th("bullet-colonization-of-prose", "cue_share", 0.45):
        out.append(finding(
            path, bullets[0][0],
            f"{len(bullets)} of {nonblank} content lines are bullets "
            f"({len(bullets) / nonblank:.0%})",
            "bullet-colonization-of-prose", "medium",
            "Bullets taking over a document mean nothing is being argued. A list "
            "asserts items; prose asserts relationships between them.",
            "Convert bullet runs that narrate or argue into paragraphs. Keep bullets "
            "for things that are genuinely a list."))

    bpc = [(i + 1, l.strip()) for i, (l, t) in enumerate(zip(lines, tags))
           if t == "prose" and re.match(r"\s*[-*+]?\s*\*\*[^*]{1,60}?:?\*\*\s*[:—]?\s+\S", l)
           and re.search(r":\*\*|\*\*\s*[:—]", l)]
    if len(bpc) >= th("bold-label-colon-bullet", "min_count", 4):
        out.append(finding(
            path, bpc[0][0], f"{len(bpc)} '**Label:** text' bullets, e.g. {bpc[0][1][:80]}",
            "bold-label-colon-bullet", "medium",
            "Every item forced into one grammatical mold — the generated-doc grid.",
            "Keep at most one such list per document. Rewrite the rest as prose."))

    rules = [i + 1 for i, (l, t) in enumerate(zip(lines, tags))
             if t == "prose" and re.match(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$", l)]
    if len(rules) >= th("horizontal-rule-spam", "min_count", 3):
        out.append(finding(
            path, rules[0], f"{len(rules)} horizontal rules",
            "horizontal-rule-spam", "medium",
            "A rule between every section signals a boundary the model does not "
            "trust the prose to signal.",
            "Delete them. If two sections need separating, the heading does it."))

    if len(heads) >= th("title-case-heading-uniformity", "min_headings", 4):
        def title_cased(h):
            b = re.sub(r"[^\w\s]", "", re.sub(r"^\s*#{1,6}\s*", "", h).strip())
            ws = [w for w in b.split() if len(w) > 3]
            return len(ws) >= 2 and all(w[0].isupper() for w in ws)
        tc = sum(1 for _, h in heads if title_cased(h))
        if tc / len(heads) >= th("title-case-heading-uniformity", "share", 0.8):
            out.append(finding(
                path, heads[0][0], f"{tc}/{len(heads)} headings in Title Case",
                "title-case-heading-uniformity", "low",
                "Uniform Title Case is a house style nobody chose. Writers drift "
                "between sentence and title case; generators do not.",
                "Pick sentence case and use it. It reads faster and dates less."))

    if len(heads) >= th("heading-level-skip", "min_headings", 3):
        levels = [len(re.match(r"\s*(#+)", h).group(1)) for _, h in heads]
        skips = sum(1 for a, b in zip(levels, levels[1:]) if b - a >= 2)
        if skips:
            out.append(finding(
                path, heads[0][0], f"{skips} heading-level skip(s), e.g. H{levels[0]} to "
                                   f"H{max(levels)}",
                "heading-level-skip", "low",
                "Levels jumped rather than nested — the model emitted a document "
                "template rather than a document, and nobody read the outline back.",
                "Renumber the headings contiguously."))

    ch = CHALLENGES_HEADING.findall(text)
    if ch:
        out.append(finding(
            path, where(lambda l: CHALLENGES_HEADING.match(l)),
            f"heading: {ch[0] if isinstance(ch[0], str) else ch[0][0]}",
            "challenges-and-future-directions", "high",
            "The obligatory penultimate move: 'Despite its X, it faces challenges… "
            "Despite these challenges, it continues to…'. A formula that ends in "
            "speculative optimism regardless of subject.",
            "Delete the section. If a real open problem exists, state it as a "
            "specific unresolved question with a name attached to it."))

    for i, (l, t) in enumerate(zip(lines, tags)):
        if t == "quote" and re.match(r"\s*>\s*\S", l):
            tail = "\n".join(lines[i:i + 4])
            if not (re.search(r"(?m)[—–-]\s*[A-Z][\w.\s,'-]{2,50}\s*$", tail)
                    or re.search(r"\b(said|wrote|per|via|according to)\b", tail, re.I)):
                out.append(finding(
                    path, i + 1, l.strip()[:120], "unattributed-floating-quote", "high",
                    "A quote with no source is manufactured gravitas. A real pull "
                    "quote excerpts the document; an italicized aphorism from nobody "
                    "is set dressing.",
                    "Attribute it, or delete it. If nobody said it, it is not a quote.",
                    "claude"))
                break

    q = th("curly-straight-quote-mixing", "min_of_each", 2)
    if (body.count("'") >= q and body.count("’") >= q) or \
       (body.count('"') >= q and (body.count("“") + body.count("”")) >= q):
        out.append(finding(
            path, 1, f"straight/curly mixed: '{body.count(chr(39))} "
                     f"curly-single {body.count(chr(8217))} "
                     f'straight-double {body.count(chr(34))}',
            "curly-straight-quote-mixing", "medium",
            "Both quote styles in one document means two sources were pasted "
            "together — typed text uses one, model output the other.",
            "Normalize to one style across the document, then keep it."))

    arrows = [(i + 1, l.strip()) for i, (l, t) in enumerate(zip(lines, tags))
              if t == "prose" and l.count("→") >= th("arrow-chain-as-explanation", "min_arrows", 2)
              and not re.match(r"^\s*\(.*\)\s*$", l.strip())
              and not re.match(r"^\s*[-*+|]", l.strip())]
    if arrows:
        out.append(finding(
            path, arrows[0][0], arrows[0][1][:120], "arrow-chain-as-explanation", "medium",
            "A to B to C compresses out the causation the reader came for. The arrow "
            "asserts a relationship without naming it.",
            "Write the chain as a sentence and name each link."))

    emoji_heads, check_bullets = [], []
    for i, (l, t) in enumerate(zip(lines, tags)):
        if t != "prose":
            continue
        s = l.strip()
        if not s:
            continue
        mm = re.match(r"(#{1,6}\s+|[-*+]\s+|\d+\.\s+)?(.*)", s)
        prefix, txt = mm.group(1), mm.group(2)
        if not txt:
            continue
        if txt[0] in CHECK_GLYPHS:
            check_bullets.append((i + 1, s))
        elif is_emoji(txt[0]) and (bool(prefix) or s.startswith("#")):
            emoji_heads.append((i + 1, s))
    if len(emoji_heads) >= th("emoji-section-headers", "min_count", 2):
        out.append(finding(
            path, emoji_heads[0][0],
            f"{len(emoji_heads)} emoji-led headings, e.g. {emoji_heads[0][1][:70]}",
            "emoji-section-headers", "high",
            "Decoration standing in for hierarchy — the README-generator look.",
            "Delete the emoji. If a glyph is needed, use a real icon system.",
            "chatgpt"))
    if len(check_bullets) >= th("checkmark-bullet-grid", "min_count", 3):
        out.append(finding(
            path, check_bullets[0][0], f"{len(check_bullets)} glyph-led list items",
            "checkmark-bullet-grid", "medium",
            "The checkmark grid turns every claim into a satisfied requirement. It "
            "reads as a compliance table, not as writing.",
            "Use a plain list, or a real table if the items genuinely compare.",
            "chatgpt"))

    if suffix not in RENDERS_MARKDOWN and suffix not in MARKUP_EXT and suffix not in CODE_EXT:
        leaks = len(re.findall(r"\*\*[^*\n]{2,60}\*\*", body)) \
            + len(re.findall(r"(?m)^\s*#{1,6}\s+\S", body))
        if leaks >= th("markdown-leak-in-unrendered-medium", "min_count", 3):
            out.append(finding(
                path, where(lambda l: "**" in l), f"{leaks} markdown constructs in a "
                f"{suffix or 'plain-text'} file",
                "markdown-leak-in-unrendered-medium", "high",
                "Markdown pasted where nothing renders it — LinkedIn, email, a "
                "plain-text field — shows literal asterisks to the reader. Nobody "
                "typing in that box would produce them.",
                "Strip the syntax and carry the emphasis in the words.", "chatgpt"))
    return out


# ----------------------------------------------------------- markup signals

def analyze_markup(path, text):
    out = []
    lines = text.splitlines()
    scan = strip_code_comments(text).lower()

    hits = [h for h in AI_DEFAULT_HEXES if h in scan]
    if hits:
        out.append(finding(
            path, next((i + 1 for i, l in enumerate(lines)
                        if any(h in l.lower() for h in hits)), 1),
            ", ".join("#" + h for h in hits), "tailwind-indigo-default-palette", "high",
            "The accent nobody picked: " + "; ".join(AI_DEFAULT_HEXES[h] for h in hits) +
            ". One is a coincidence; the cluster is a default. (Origin is anecdotal, "
            "not measured: Tailwind's creator has said publicly that making every "
            "Tailwind UI button indigo-500 is why every generated UI is indigo.)",
            "Choose an accent from the brand or the imagery. If you have neither, pick "
            "a color you can defend in one sentence."))

    for fam, label in AI_DEFAULT_FONTS.items():
        if re.search(r"font(?:-family)?\s*[:=][^;}\n]*\b" + re.escape(fam) + r"\b", scan) or \
           re.search(r"fonts\.googleapis[^\"']*" + re.escape(fam.replace(" ", "+")), scan):
            out.append(finding(
                path, next((i + 1 for i, l in enumerate(lines) if fam in l.lower()), 1),
                fam, "inter-geist-default-typeface", "high", label + ".",
                "Pick a typeface as a decision: name the voice, then match it."))

    reps = {t: scan.count(t) for t in AI_DEFAULT_TOKENS
            if scan.count(t) >= th("ai-default-token-repetition", "min_count", 3)}
    if reps:
        tok = max(reps, key=reps.get)
        out.append(finding(
            path, next((i + 1 for i, l in enumerate(lines) if tok in l.lower()), 1),
            ", ".join(f"{k} x{v}" for k, v in sorted(reps.items(), key=lambda kv: -kv[1])),
            "ai-default-token-repetition", "medium",
            "Utility tokens repeated across every surface are the unstyled style of "
            "generated UI: the treatment was applied, not designed.",
            "Keep each effect where it earns its place. Design one deliberate surface "
            "treatment and reuse that."))

    for i, l in enumerate(lines):
        if re.search(r"<(button|a|h[1-6]|th|label|summary)\b[^>]*>[^<]*", l):
            seg = re.findall(r">([^<]+)<", l)
            if any(is_emoji(c) or c in CHECK_GLYPHS for s in seg for c in s):
                out.append(finding(
                    path, i + 1, l.strip()[:120], "emoji-as-ui-icons", "high",
                    "Emoji inside UI chrome renders differently on every platform and "
                    "reads as a placeholder nobody replaced.",
                    "Use SF Symbols, Lucide, Heroicons, or bespoke SVG."))
                break
    return out


# ------------------------------------------------------------- code signals

def analyze_code(path, text):
    """Overlap between a comment and the line beneath it is countable. Whether a
    comment is *useful* is not, and stays a judge-pass call."""
    out = []
    lines = mask_ignored(text.splitlines())

    narrating = []
    for i, l in enumerate(lines[:-1]):
        m = COMMENT_PREFIX.match(l)
        if not m:
            continue
        comment, nxt = m.group(1).strip(), lines[i + 1].strip()
        if not comment or not nxt or COMMENT_PREFIX.match(lines[i + 1]):
            continue
        cw = ident_words(comment) - STOPWORDS
        nw = ident_words(nxt) - STOPWORDS
        if len(cw) < 2:
            continue
        overlap = len(cw & nw) / len(cw)
        # A terse comment is held to a lower bar on purpose. "# increment the
        # counter" above "counter += 1" shares only one word, because the verb
        # the comment spells out is the operator the code uses -- which is the
        # whole tell. Requiring 60% overlap would miss the canonical case.
        bar = 0.5 if len(cw) <= 3 else th("comment-narrates-next-line", "overlap", 0.6)
        if overlap >= bar:
            narrating.append((i + 1, l.strip()[:80]))
    if len(narrating) >= th("comment-narrates-next-line", "min_count", 2):
        out.append(finding(
            path, narrating[0][0],
            f"{len(narrating)} comments restate the line below, e.g. {narrating[0][1]}",
            "comment-narrates-next-line", "high",
            "The comment says what the code already says. Generated comments describe "
            "syntax; engineers annotate the constraint the code cannot express.",
            "Delete it, or replace it with the reason: the bug it avoids, the limit it "
            "respects, what breaks if you change it.", "codex"))

    swallow = [i + 1 for i, l in enumerate(lines[:-1])
               if re.match(r"\s*except\b[^:]*:\s*$", l) and lines[i + 1].strip() == "pass"]
    swallow += [i + 1 for i, l in enumerate(lines)
                if re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", l)]
    if swallow:
        out.append(finding(
            path, swallow[0], f"{len(swallow)} silently swallowed exception(s)",
            "swallow-exception-pass", "high",
            "Bare except/pass is what a generator writes to make an example run. It "
            "converts a failure you could have fixed into a silence you cannot debug.",
            "Catch the specific exception and handle it, or let it propagate.", "codex"))

    # humanize:ignore-start -- the stub regex matches its own source
    stubs = [i + 1 for i, l in enumerate(lines)
             if re.search(r"\b(TODO|FIXME|XXX)\b.*\b(implement|add|fill|replace|your)\b", l, re.I)
             or "raise NotImplementedError" in l
             or re.search(r"(?i)\b(your[-_ ]api[-_ ]key|replace[-_ ]this|insert[-_ ]here|example\.com/api)\b", l)]
    # humanize:ignore-end
    if len(stubs) >= th("placeholder-stub-residue", "min_count", 2):
        out.append(finding(
            path, stubs[0], f"{len(stubs)} placeholder/stub markers",
            "placeholder-stub-residue", "high",
            "Scaffolding the generator left for a human who never came back.",
            "Implement it or delete it. A stub that ships is a lie about what works.",
            "codex"))

    sigs = []
    for i, l in enumerate(lines[:-1]):
        m = re.match(r"\s*(?:def|fn|func|function)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)", l)
        if not m:
            continue
        dm = re.match(r'^(?:"""|\'\'\'|///|\*|//|#)\s*(.+)', lines[i + 1].strip())
        if not dm:
            continue
        first = re.split(r"[.\n]", dm.group(1))[0]
        dw = ident_words(first) - STOPWORDS
        sw = (ident_words(m.group(1)) | ident_words(m.group(2))) - STOPWORDS
        if dw and not (dw - sw):
            sigs.append((i + 2, first[:70]))
    if sigs:
        out.append(finding(
            path, sigs[0][0],
            f"{len(sigs)} docstring(s) restate the signature, e.g. \"{sigs[0][1]}\"",
            "docstring-restates-signature", "medium",
            "A docstring whose every content word already appears in the function name "
            "and parameters carries no information.",
            "Document what the caller cannot see: units, ownership, failure modes, the "
            "invariant it assumes.", "codex"))

    divs = [i + 1 for i, l in enumerate(lines)
            if re.match(r"\s*(?://|#)\s*[=*~-]{12,}\s*$", l)
            or re.match(r"\s*(?://|#)\s*[=*~-]{3,}\s+\w[\w \-]{2,40}\s+[=*~-]{3,}\s*$", l)]
    if len(divs) >= th("decorative-section-divider", "min_count", 2):
        out.append(finding(
            path, divs[0], f"{len(divs)} ASCII-art section dividers",
            "decorative-section-divider", "low",
            "Banner comments partitioning a file the way a generated outline does. "
            "Only a tell when the rest of the codebase does not use them.",
            "Check the surrounding files. If they have none, delete these; if the file "
            "needs sections this badly, it needs splitting."))

    emo = [i + 1 for i, l in enumerate(lines)
           if any(is_emoji(c) for c in l) and not l.strip().startswith(("*", '"""'))]
    if emo and len(emo) >= th("emoji-in-code", "min_count", 1):
        out.append(finding(
            path, emo[0], f"emoji on {len(emo)} line(s)", "emoji-in-code", "low",
            "Emoji in source. Only a tell when the repo does not already use them — "
            "some projects mandate them in commit and log conventions.",
            "Check the repo's own convention first. If there isn't one, remove them.",
            "codex"))
    return out


def analyze_file(path, base=None):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return [finding(path, 0, str(e), "unreadable", "low", f"Could not read {path}.")]
    suffix = path.suffix.lower()
    if suffix in MARKUP_EXT:
        res = analyze_markup(path, text)
        if suffix in {".html", ".htm"}:
            res += analyze_prose(path, strip_markup(text), suffix, base)
        if suffix in CODE_EXT:
            res += analyze_code(path, text)
        return res
    if suffix in CODE_EXT:
        return analyze_code(path, text)
    return analyze_prose(path, text, suffix or ".txt", base)


# ------------------------------------------------------------------- report

FAMILY_NOTE = {
    "residue": "machine artifact — near-zero human source",
    "form": "grammatical form — measured effect sizes, but humans do this too",
    "rhythm": "rhythm cue — weak alone; meaningful only against this author's baseline",
}


def render_report(findings, out_path, title="Humanize review", base=None):
    for f in findings:
        if f.get("severity") not in VALID_SEV:
            f["severity"] = "low"
    findings = sorted(findings, key=lambda f: (SEV_ORDER.get(f.get("severity"), 3),
                                               str(f.get("file", "")), str(f.get("line", 0))))
    counts = {s: sum(1 for f in findings if f.get("severity") == s) for s in VALID_SEV}
    rows = []
    for n, f in enumerate(findings, 1):
        rw, sev = f.get("rewrite") or "", f.get("severity", "low")
        fam = f.get("family", "")
        rows.append(f"""
      <tr class="sev-{html.escape(sev)}">
        <td class="num">{n}</td>
        <td><span class="sev">{html.escape(sev)}</span></td>
        <td class="ism">{html.escape(str(f.get('ism','')))}<div class="dialect">{html.escape(str(f.get('dialect','')))} &middot; {html.escape(str(f.get('layer','judge')))}{(' &middot; ' + html.escape(fam)) if fam else ''}</div></td>
        <td class="loc">{html.escape(Path(str(f.get('file',''))).name)}:{html.escape(str(f.get('line','')))}</td>
        <td class="body"><del>{html.escape(str(f.get('excerpt','')))}</del>
          <div class="why">{html.escape(str(f.get('explanation','')))}</div>
          {f'<ins>{html.escape(str(rw))}</ins>' if rw else ''}</td>
      </tr>""")
    bnote = (f"Rhythm signals were scored against a baseline of {base['files']} file(s), "
             f"{base['words']:,} words of this author's own writing."
             if base else
             "No baseline corpus was supplied, so every rhythm signal below is capped at "
             "low severity. Pass --baseline with the author's own prior writing to make "
             "those findings mean something.")
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  /* Deliberately not the AI default look: no Inter, no indigo, nothing under
     14px. If this report looked generated, nothing in it would land. */
  :root {{ --ink:#1a1714; --paper:#faf7f2; --rule:#d8d0c2; --accent:#8a3324;
           --high:#8a3324; --medium:#9a6a00; --low:#4a5d49; }}
  html {{ font-size: 16px; }}
  body {{ font-family: Georgia, 'Times New Roman', serif; background: var(--paper);
         color: var(--ink); margin: 0; padding: 3rem 4vw; line-height: 1.55; }}
  h1 {{ font-size: 2rem; font-weight: normal; margin: 0 0 .25rem; }}
  .kicker {{ font-family: Menlo, monospace; font-size: .875rem; font-weight: 700;
            letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }}
  .summary {{ font-size: 1rem; margin: .75rem 0 1rem; max-width: 66ch; }}
  .caveat {{ font-size: .9375rem; margin: 0 0 2rem; max-width: 66ch;
            border-left: 3px solid var(--accent); padding-left: .9rem; color: #4a443c; }}
  table {{ width: 100%; border-collapse: collapse; background: #fff;
          border: 1px solid var(--rule); font-size: .9375rem; }}
  th {{ font-family: Menlo, monospace; font-size: .875rem; text-transform: uppercase;
       letter-spacing: .08em; text-align: left; padding: .6rem .7rem;
       border-bottom: 2px solid var(--ink); }}
  td {{ padding: .65rem .7rem; border-bottom: 1px solid var(--rule); vertical-align: top; }}
  td.num {{ font-family: Menlo, monospace; color: #6b655c; }}
  .sev {{ font-family: Menlo, monospace; font-size: .875rem; font-weight: 700;
         text-transform: uppercase; }}
  tr.sev-high .sev {{ color: var(--high); }}
  tr.sev-medium .sev {{ color: var(--medium); }}
  tr.sev-low .sev {{ color: var(--low); }}
  td.ism {{ font-family: Menlo, monospace; font-size: .875rem; }}
  .dialect {{ color: #6b655c; font-size: .875rem; margin-top: .15rem; }}
  td.loc {{ font-family: Menlo, monospace; font-size: .875rem; white-space: nowrap; }}
  del {{ background: #f6e3df; text-decoration-color: var(--high); display: inline-block;
        padding: .05rem .2rem; }}
  ins {{ background: #e7eee4; text-decoration: none; display: block; margin-top: .4rem;
        padding: .3rem .45rem; border-left: 3px solid var(--low); }}
  .why {{ font-size: .9375rem; color: #4a443c; margin-top: .35rem; }}
  footer {{ margin-top: 2rem; font-family: Menlo, monospace; font-size: .875rem;
           color: #6b655c; max-width: 74ch; line-height: 1.5; }}
</style></head><body>
<div class="kicker">make_copy_and_media_human &middot; line-item fix plan</div>
<h1>{html.escape(title)}</h1>
<p class="summary"><strong>{len(findings)}</strong> findings &mdash;
  {counts['high']} high, {counts['medium']} medium, {counts['low']} low.
  Struck text is the tell as found; the inset block is the proposed fix.</p>
<p class="caveat">These are editing cues, not proof of authorship. Because AI
  detectors are biased toward &ldquo;human,&rdquo; a flag here is more likely to
  be an unusual person &mdash; a non-native speaker, an autistic writer, someone
  who simply loves dashes &mdash; than a caught machine. Every fix below is worth
  making either way, which is the only claim this report makes. {html.escape(bnote)}</p>
<table>
  <thead><tr><th>#</th><th>Sev</th><th>Ism</th><th>Where</th><th>Finding &rarr; fix</th></tr></thead>
  <tbody>{''.join(rows) if rows else '<tr><td colspan=5>No findings. Either clean, or the judge pass has not run.</td></tr>'}</tbody>
</table>
<footer>generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%MZ')} &middot; structural
layer measures countable signals only; phrase-level tropes come from the model judge
pass. Thresholds are read from references/catalog.json. Families:
residue = {FAMILY_NOTE['residue']}; form = {FAMILY_NOTE['form']}; rhythm = {FAMILY_NOTE['rhythm']}.
</footer>
</body></html>"""
    out_path.write_text(doc, encoding="utf-8")
    return out_path


# ------------------------------------------------------------ self-checking

# humanize:ignore-start -- fixtures below are deliberate specimens
SELFTEST = """# 🚀 Why Our Platform Wins

## 📈 The Opportunity

It's not just a tool. Tight. Focused. Relentless. Fast. Clean. Sharp. Ready.

> The future belongs to those who automate it.

**Speed:** blazing fast.
**Scale:** infinitely elastic.
**Security:** enterprise-grade.
**Joy:** developer-first.

Input → Pipeline → Magic → Revenue

---

Some text.

---

More text.

---

## Challenges and Future Directions

Despite its growth, the platform faces challenges.
"""

SELFTEST_CODE = """
def get_user_name(user_id):
    \"\"\"Get the user name for the user id.\"\"\"
    # increment the counter
    counter += 1
    # fetch the user from the database
    user = fetch_user_from_database(user_id)
    try:
        return user.name
    except KeyError:
        pass
"""

# Real human prose. If a detector fires on this, the detector is wrong: it will
# train people to ignore the whole report, which is worse than shipping nothing.
SELFTEST_CLEAN = (
    "We shipped the migration on a Tuesday and it went badly for about forty "
    "minutes. The read replicas in us-east-1 lagged behind the primary, so a "
    "handful of customers saw stale invoice totals for a while. Nobody lost "
    "money. We caught it because Tomasz happened to be looking at the wrong "
    "dashboard at the right moment, which is not a control I want to rely on "
    "again. The fix was three lines in the connection pool config, but finding "
    "it took most of the afternoon, and I'm still not sure we understand why "
    "the lag spiked when it did. What I do know is that our alerting never "
    "fired once. That's the part that worries me going into the bigger cutover "
    "in March, and it's why I've asked Priya to rebuild the replica-lag alert "
    "before we touch anything else.\n")


# humanize:ignore-end


def run_selftest():
    got = {f["ism"] for f in analyze_prose(Path("t.md"), SELFTEST, ".md")}
    got |= {f["ism"] for f in analyze_code(Path("t.py"), SELFTEST_CODE)}
    got |= {f["ism"] for f in analyze_prose(
        Path("l.md"), "As an AI language model, I cannot browse the internet.\n", ".md")}
    got |= {f["ism"] for f in analyze_prose(
        Path("i.md"), "A sentence — with residue. See https://x.org/a?utm_source=chatgpt.com\n", ".md")}
    need = {"emoji-section-headers", "unattributed-floating-quote", "bold-label-colon-bullet",
            "arrow-chain-as-explanation", "staccato-fragment-triplet", "horizontal-rule-spam",
            "challenges-and-future-directions", "comment-narrates-next-line",
            "swallow-exception-pass", "docstring-restates-signature", "as-an-ai-leakage",
            "invisible-unicode-artifacts", "tracking-param-residue"}
    print("selftest findings:", " ".join(sorted(got)))
    missing = need - got
    if missing:
        print("MISSING:", " ".join(sorted(missing)))
        return 1
    noise = {f["ism"] for f in analyze_prose(Path("c.md"), SELFTEST_CLEAN, ".md")}
    if noise:
        print("FALSE POSITIVES on human prose:", " ".join(sorted(noise)))
        return 1
    print("selftest OK (all tells caught, zero false positives on the clean sample)")
    return 0


def run_validate():
    if not CATALOG_NAMES:
        print("catalog not found at", CATALOG_PATH)
        return 1
    src = Path(__file__).read_text(encoding="utf-8")
    emitted = set(re.findall(r'"([a-z][a-z0-9]*(?:-[a-z0-9]+){1,6})",\s*\n?\s*"(?:high|medium|low)"', src))
    emitted |= set(re.findall(r'"([a-z][a-z0-9]*(?:-[a-z0-9]+){1,6})",\s*$', src, re.M)) & set(DEFAULT_THRESHOLDS)
    emitted |= set(DEFAULT_THRESHOLDS)
    emitted -= {"unreadable"}
    unknown = sorted(n for n in emitted if n not in CATALOG_NAMES)
    print(f"catalog: {len(CATALOG_NAMES)} items - script emits/uses {len(emitted)} ism ids")
    if unknown:
        print("NOT IN CATALOG:", " ".join(unknown))
        return 1
    no_th = sorted(n for n in DEFAULT_THRESHOLDS if not _CAT_TH.get(n))
    if no_th:
        print(f"note: {len(no_th)} ism(s) have no catalog thresholds, using bundled "
              f"fallback: {' '.join(no_th)}")
    print("validate OK")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="files to review (md, txt, html, css, tsx, py...)")
    ap.add_argument("--baseline", action="append", default=[], metavar="GLOB",
                    help="the author's own known-human writing; repeatable. Rhythm "
                         "signals are scored as a delta against this instead of against "
                         "a universal threshold. Strongly recommended.")
    ap.add_argument("--findings", help="JSON findings from the model judge pass to merge")
    ap.add_argument("--out", default="humanize-report.html")
    ap.add_argument("--title", default="Humanize review")
    ap.add_argument("--json", help="also dump merged findings JSON here")
    ap.add_argument("--fail-on", choices=["high", "medium", "low", "none"], default="none",
                    help="exit 1 if any finding at or above this severity")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--validate", action="store_true",
                    help="check that every ism id resolves to a catalog item")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(run_selftest())
    if args.validate:
        sys.exit(run_validate())
    if not args.files and not args.findings:
        ap.error("no input: pass at least one file, or --findings from the judge pass. "
                 "Refusing to write an empty report that would read as 'clean'.")

    missing = [f for f in args.files if not Path(f).exists()]
    if missing:
        print("error: no such file(s): " + ", ".join(missing), file=sys.stderr)
        sys.exit(2)

    base = None
    if args.baseline:
        paths = [p for g in args.baseline for p in sorted(globmod.glob(g, recursive=True))]
        base = build_baseline(paths)
        if base is None:
            print(f"error: --baseline matched no readable prose (tried {len(paths)} path(s))",
                  file=sys.stderr)
            sys.exit(2)
        print(f"baseline: {base['files']} file(s), {base['words']:,} words")

    findings = []
    for f in args.files:
        findings += analyze_file(Path(f), base)

    if args.findings:
        try:
            ext = json.loads(Path(args.findings).read_text(encoding="utf-8"))
        except Exception as e:
            print(f"error: could not read {args.findings}: {e}", file=sys.stderr)
            sys.exit(2)
        if not isinstance(ext, list):
            print(f"error: {args.findings} must be a JSON array of finding objects, got "
                  f"{type(ext).__name__}", file=sys.stderr)
            sys.exit(2)
        for i, f in enumerate(ext):
            if not isinstance(f, dict):
                print(f"error: {args.findings}[{i}] is not an object", file=sys.stderr)
                sys.exit(2)
            f.setdefault("layer", "judge")
            if CATALOG_NAMES and f.get("ism") and f["ism"] not in CATALOG_NAMES:
                print(f"warning: {args.findings}[{i}] ism '{f['ism']}' is not in the catalog",
                      file=sys.stderr)
        findings += ext

    if args.json:
        Path(args.json).write_text(json.dumps(findings, indent=2), encoding="utf-8")
    out = render_report(findings, Path(args.out), title=args.title, base=base)
    print(f"wrote {out} ({len(findings)} findings)")

    if args.fail_on != "none":
        bar = SEV_ORDER[args.fail_on]
        hits = [f for f in findings if SEV_ORDER.get(f.get("severity"), 3) <= bar]
        if hits:
            print(f"FAIL: {len(hits)} finding(s) at or above severity '{args.fail_on}'",
                  file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
