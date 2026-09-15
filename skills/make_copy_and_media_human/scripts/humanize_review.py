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
    "unearned-prior-reference": {"min_words": 250},
    "repo-context-leak": {"min_count": 4, "cue_per_1000w": 3.0},
    "definition-after-use": {"min_terms": 2, "max_gap_lines": 12},
    "signposting-without-structure": {"min_count": 3},
    "linkedin-broetry-one-line-runs": {"min_run": 4, "max_words_per_line": 14},
    "paragraph-length-monoculture": {"min_paragraphs": 8, "cue_cv": 0.25},
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
    "unfilled-placeholder-residue": {"min_count": 1},
    "model-markup-residue": {"min_count": 1},
    "ai-default-token-repetition": {"min_count": 3},
    "eyebrow-with-no-information": {"min_count": 2},
    "pull-quote-that-quotes-nothing": {"min_count": 1},
    "hero-with-nothing-to-look-at": {"min_count": 1},
    "undifferentiated-section-padding": {"min_sections": 4},
    "framework-look-without-responsive": {"min_idiom": 25},
    "missing-viewport-meta": {"min_count": 1},
    "div-soup-no-semantics": {"min_divs": 20, "max_semantic_share": 0.08},
    "clickable-div-not-button": {"min_count": 1},
    "dead-anchor-href": {"min_count": 3},
    "scaffold-title-residue": {"min_count": 1},
    "placeholder-copy-residue": {"min_count": 1},
    "missing-or-placeholder-alt": {"min_count": 2},
    "focus-outline-removed": {"min_count": 1},
    "no-reduced-motion-guard": {"min_animations": 6},
    "important-escalation": {"min_count": 8},
    "z-index-escalation": {"max_z": 100},
    "hundred-vw-overflow": {"min_count": 1},
    "static-vh-full-height": {"min_count": 1},
    "missing-html-lang": {"min_count": 1},
    "tailwind-play-cdn-in-production": {"min_count": 1},
    "h1-absent-or-competing": {"min_count": 1},
    "no-meta-description-or-og-image": {"min_count": 1},
    "input-without-label": {"min_count": 1},
    "form-without-destination": {"min_count": 1},
    "debug-residue-in-production": {"min_count": 3},
    "barrel-icon-import": {"min_count": 1},
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
    if base_value is not None:
        # A baseline of zero is a real baseline, not a missing one, and it means
        # different things in each direction. Upward: this author never does
        # this, so any material presence is the strongest possible delta \u2014 floor
        # the divisor so the ratio stays computable. Downward: there is nothing
        # to decrease from, so the comparison is meaningless and must not fire.
        # Getting this wrong made a text score findings against its own baseline.
        if direction == "down" and base_value < 0.05:
            return None
        ratio = observed / max(base_value, 0.05)
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

def analyze_prose(path, text, suffix=".md", base=None, from_markup=False):
    """from_markup: text came from strip_markup(). Line structure is then an
    artifact of tag removal rather than an authoring choice, so the detectors
    that read line and paragraph shape are meaningless and were firing on it."""
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

    # humanize:ignore-start -- the placeholder patterns below are specimens
    PLACEHOLDER = re.compile(
        r"\{\{?\s*[a-z_][a-z_ ]{1,30}\s*\}?\}|%%\w+%%|\*\|\w+\|\*"
        r"|\b(FNAME|LNAME|FIRSTNAME)\b|\[(?:Job Title|Company Name|Your Name|"
        r"insert [^\]]{2,30}|specific [^\]]{2,30})\]", re.I)
    # humanize:ignore-end
    ph = [l for l, t in zip(lines, tags) if t == "prose" and PLACEHOLDER.search(l)]
    if ph:
        out.append(finding(
            path, where(lambda l: PLACEHOLDER.search(l)),
            f"{len(ph)} unfilled placeholder(s), e.g. {PLACEHOLDER.search(ph[0]).group(0)}",
            "unfilled-placeholder-residue", "high",
            "Template scaffolding shipped live. This is the one finding in the whole "
            "catalog that is proof rather than inference: unreviewed output reached a "
            "reader.",
            "Block publish on any placeholder pattern. Set fallbacks on every merge "
            "field and grep the artifact before it leaves.", family="residue"))

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
        # Spelled-out quantities are specifics too. Counting only digits marked
        # "forty thousand jobs a week" as vague, which is backwards.
        numbers += len(re.findall(
            r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
            r"fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|"
            r"thousand|million|billion|half|third|quarter|dozen|once|twice)\b",
            body, re.I))
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
    # paragraph-length monoculture: people break where the idea breaks, which is
    # irregular. A model paragraphs on a rhythm.
    # Join each paragraph's lines BEFORE counting sentences. Counting per line
    # measures the author's hard-wrap width, not their rhythm: a README wrapped
    # at 80 characters then reads as perfectly uniform, which is how this
    # detector first fired on this skill's own README.
    paras_sent, buf = [], []
    for l, t in zip(lines, tags):
        if t != "prose":
            continue
        if l.strip():
            if not re.match(r"\s*([-*+#>|]|\d+\.)", l):
                buf.append(l.strip())
        elif buf:
            paras_sent.append(len(split_sentences(" ".join(buf)))); buf = []
    if buf:
        paras_sent.append(len(split_sentences(" ".join(buf))))
    if len(paras_sent) >= th("paragraph-length-monoculture", "min_paragraphs", 6) \
       and not from_markup:
        mu = statistics.mean(paras_sent)
        cv = statistics.pstdev(paras_sent) / mu if mu else 1.0
        if cv < th("paragraph-length-monoculture", "cue_cv", 0.35):
            out.append(finding(
                path, 1, f"paragraph-length CV {cv:.2f} over {len(paras_sent)} paragraphs "
                         f"(mean {mu:.1f} sentences)",
                "paragraph-length-monoculture", "low",
                "Every paragraph the same length. People break where the idea breaks, "
                "which is irregular; a model breaks on a rhythm. Unlike sentence-length "
                "variation this has no published baseline behind it, so the threshold is "
                "a judgment call and the severity is capped accordingly.",
                "Put a one-sentence paragraph where the argument turns, and let another "
                "run long.", family="rhythm"))

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
    if best_run >= th("linkedin-broetry-one-line-runs", "min_run", 4) and not from_markup:
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
    if len(rules) >= th("horizontal-rule-spam", "min_count", 3) and not from_markup:
        out.append(finding(
            path, rules[0], f"{len(rules)} horizontal rules",
            "horizontal-rule-spam", "medium",
            "A rule between every section signals a boundary the model does not "
            "trust the prose to signal.",
            "Delete them. If two sections need separating, the heading does it."))

    if len(heads) >= th("title-case-heading-uniformity", "min_headings", 4) and not from_markup:
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

    if len(heads) >= th("heading-level-skip", "min_headings", 3) and not from_markup:
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

    if not from_markup:
        out += analyze_exposition(path, lines, tags, body)

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


    # ---- the eyebrow that says nothing. The slot exists in the template, so the
    # generator fills it; the test is whether deleting the string removes a fact.
    eyebrows = []
    for m in re.finditer(r"<(p|span|div)\b([^>]*)>([^<]{2,40})</\1>", text, re.I):
        attrs, txt = m.group(2), m.group(3).strip()
        looks_eyebrow = re.search(r"uppercase|tracking-[\w\[]|letter-spacing", attrs, re.I) \
            or (txt.isupper() and 2 <= len(txt) <= 40)
        if not looks_eyebrow or not txt:
            continue
        # An eyebrow earns its place by carrying a specific the headline cannot.
        # Capitalisation is NOT that signal: "For Modern Teams" is title-cased and
        # says nothing. Use morphology instead \u2014 a digit, a version, or an acronym
        # or standard name \u2014 plus the research's own discriminator: an eyebrow
        # that LINKS somewhere resolves to something a reader can verify.
        has_fact = bool(re.search(r"\d", txt)) or bool(re.search(r"\b[A-Z]{2,}\b", txt))
        links = "<a " in m.group(0).lower()
        if not has_fact and not links:
            eyebrows.append((text[:m.start()].count("\n") + 1, txt[:40]))
    if len(eyebrows) >= th("eyebrow-with-no-information", "min_count", 2):
        out.append(finding(
            path, eyebrows[0][0],
            f"{len(eyebrows)} information-free eyebrow label(s): "
            + ", ".join(f'"{t}"' for _, t in eyebrows[:4]),
            "eyebrow-with-no-information", "medium",
            "The small label above a headline, carrying no fact. An eyebrow is an "
            "editorial device that presumes a hierarchy \u2014 a publication, a section, an "
            "issue. A page with one section has nothing for it to be above, so the slot "
            "gets filled because it exists rather than because there is something to put "
            "in it.",
            "Delete it and raise the headline; if the page reads identically you have "
            "proved it was decoration. If you keep one, make it carry the specific the "
            "headline cannot: a date, a version, a licence, a standard. The rule of thumb "
            "is that an eyebrow must contain a proper noun, a number, a date or a "
            "licence. Then delete the eyebrow slot from the component, or the next "
            "generated section will fill it again.",
            family="form"))

    # ---- the pull quote that quotes nothing. A pull quote is BY DEFINITION an
    # excerpt of the document it sits in, so this is a provenance check, not taste.
    body_text = re.sub(r"\s+", " ", strip_markup(text)).lower()
    orphan_quotes = []
    for m in re.finditer(r"<(blockquote|aside|figure)\b([^>]*)>(.*?)</\1>", text, re.S | re.I):
        attrs, inner = m.group(2), m.group(3)
        if re.search(r"<cite\b|<figcaption\b", inner, re.I):
            continue
        qt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", inner)).strip(' "\u201c\u201d')
        words = qt.split()
        if len(words) < 6:
            continue
        # Does a six-word window of it occur anywhere else on the page?
        window = " ".join(words[:6]).lower()
        if body_text.count(window) <= 1 and not re.search(
                r"[\u2014\u2013-]\s*[A-Z][\w.\s,'-]{2,40}\s*$", qt):
            orphan_quotes.append((text[:m.start()].count("\n") + 1, qt[:70]))
    if orphan_quotes:
        out.append(finding(
            path, orphan_quotes[0][0],
            f"{len(orphan_quotes)} pull quote(s) quoting nothing on the page, "
            f'e.g. "{orphan_quotes[0][1]}"',
            "pull-quote-that-quotes-nothing", "high",
            "A pull quote is defined by a provenance relation: it is text PULLED from the "
            "document it decorates. This one appears nowhere else and names no source, so "
            "the form makes a promise the content cannot keep. A reader who goes looking "
            "for the speaker and finds none has learned something true about the page.",
            "In an article, replace it with the sharpest eight to fifteen words already in "
            "your body copy, and leave them in the body too \u2014 the pull quote is a trailer, "
            "not a scene. On a landing page there is no document to pull from, so it is a "
            "testimonial with a full name, role and company, or it is deleted. Make the "
            "component require a source and fail the build without one.",
            family="form"))

    # ---- the hero with nothing to look at
    hero_m = re.search(r"<(?:section|header|main|div)\b[^>]*>(.{0,4000}?)</(?:section|header|main|div)>",
                       text, re.S | re.I)
    if hero_m and re.search(r"<h1\b", hero_m.group(1), re.I):
        hero = hero_m.group(1)
        visuals = len(re.findall(r"<(?:img|picture|video|canvas|iframe)\b", hero, re.I))
        # A logo or an icon is not a look at the product; require a real <svg>.
        visuals += len([g for g in re.findall(r"<svg\b[^>]*>.*?</svg>", hero, re.S | re.I)
                        if g.count("<path") > 2 or len(g) > 600])
        if visuals == 0:
            out.append(finding(
                path, text[:hero_m.start()].count("\n") + 1,
                "hero contains an h1 and no screenshot, photograph, diagram or video",
                "hero-with-nothing-to-look-at", "high",
                "An image-less hero is a claim that there is nothing worth showing, and "
                "for a working product that claim is always false. A generator cannot "
                "screenshot software it has never run, so the visual slot resolves to the "
                "one thing it can synthesise from CSS: a gradient. The reader correctly "
                "infers the product does not exist, is ugly, or has not been used by "
                "anyone involved.",
                "Show the product. In descending order of what it proves: a real "
                "screenshot of a real screen with real data in it, cropped to the one "
                "view that makes the value legible; a five-to-fifteen second silent loop "
                "of it doing its one thing; or a diagram of the mechanism, which is the "
                "honest answer for infrastructure with no UI. If there genuinely is no "
                "product yet, say so and make the hero the argument for the waitlist \u2014 "
                "that is not a tell. Hiding pre-product status behind a gradient is.",
                family="form"))

    # ---- every section padded identically
    pads = re.findall(r"\bp[yt]-(\d{1,2})\b", scan) + \
        re.findall(r"padding(?:-block|-top)?\s*:\s*(\d{2,3})px", scan)
    if len(pads) >= th("undifferentiated-section-padding", "min_sections", 4) \
       and len(set(pads)) == 1:
        out.append(finding(
            path, next((i + 1 for i, l in enumerate(lines)
                        if re.search(r"\bp[yt]-\d|padding", l, re.I)), 1),
            f"{len(pads)} sections all padded {pads[0]}",
            "undifferentiated-section-padding", "medium",
            "Spacing used as a constant rather than as a relationship. Nothing is grouped "
            "with anything and nothing is separated from anything, so the page is a stack "
            "of equally weighted slabs and the reader gets no signal about what belongs "
            "together.",
            "Vary it by role. Give the hero more room than it needs and the rest less, "
            "tighten the gap between a heading and the thing it introduces, and widen the "
            "gap between unrelated sections. A three-step scale used deliberately reads as "
            "designed; one value used everywhere reads as a default.",
            family="form"))

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




# ------------------------------------------------------- exposition signals

# Deictic frames that point at shared history. A closed set of GRAMMATICAL
# forms, not a topic list, so this sits inside the Law 1 carve-out. The tell is
# not the phrase; it is the phrase pointing at nothing the reader has seen.
PRIOR_REFERENCE = (
    "our previous", "our earlier", "our original", "our old", "the previous version",
    "the earlier version", "as we discussed", "as discussed", "as we saw",
    "as mentioned above", "as noted above", "as we mentioned", "you'll recall",
    "you will recall", "as you know", "recall that", "last time", "previously we",
    "building on our", "unlike our", "compared to our", "improves on our",
    "in the last post", "in our last", "as covered",
)
VERSION_REFERENCE = re.compile(
    r"\b(?:our|the)\s+(?:v\d+(?:\.\d+)?|version\s+\d+)(?![\w/-])"
    r"\s+(?:approach|design|system|pipeline|implementation|release|version|"
    r"architecture|model|api|schema|format|engine|stack)\b", re.I)

# Meta-navigation: the shape of structure, announced instead of enacted.
SIGNPOST = re.compile(
    r"\b(?:first|next|then|finally|lastly|now)\b[^.!?\n]{0,40}\b"
    r"(?:we(?:'ll| will| are going to)?|let's|I'll|this (?:post|article|section))\b"
    r"[^.!?\n]{0,40}\b(?:explore|examine|look at|dive into|discuss|cover|"
    r"walk through|review|consider|see|understand)\b", re.I)

# Artifacts of the repo the writer had open, in prose meant for someone who
# does not have it open.
REPO_TOKEN = re.compile(
    r"(?:(?<![\w/])[\w.-]+/[\w.-]+/[\w.-]+\.\w{1,5}\b)"          # a/b/c.ext
    r"|(?:\b[a-z_][a-z0-9_]{3,}\(\))"                                 # snake_case()
    r"|(?:\b[A-Z]{2,6}-\d{1,6}\b)"                                    # ABC-123
    r"|(?:\b(?:feat|fix|chore|refactor)/[\w.-]+\b)")                   # branch names

DEF_HINT = r"(?:\s*\(|,\s*(?:which|a|an|the)\b|\s*:\s|\s+is\s+(?:a|an|the|our|" \
           r"what|how|when)\b|\s+are\s+(?:a|an|the|our)\b|\s+refers?\s+to\b|" \
           r"\s+means\b|\s+stands\s+for\b|\s+covers?\b|\s+denotes?\b|" \
           r"\s+describes?\b)"


def candidate_terms(body):
    """Terms of art a reader would need defined: backticked identifiers and
    Capitalised Multi-Word Phrases. Ordinary nouns are excluded by requiring
    either the backticks or the capitalisation pattern."""
    terms = {}
    for m in re.finditer(r"`([A-Za-z][\w .-]{2,30})`", body):
        t = m.group(1).strip()
        if re.search(r"[(){}=;/]", t):
            continue
        # An ordinary lowercase word in backticks is a label, not a term of art.
        # Require an identifier shape: a separator, an internal capital, or more
        # than one word.
        if not (re.search(r"[_.\-]", t) or re.search(r"[a-z][A-Z]", t)
                or " " in t or t[0].isupper()):
            continue
        terms.setdefault(t, 0)
    for m in re.finditer(r"(?<![.!?]\s)(?<!^)\b((?:[A-Z][a-z]{2,}\s){1,3}[A-Z][a-z]{2,})\b",
                         body, flags=re.M):
        terms.setdefault(m.group(1).strip(), 0)
    for t in list(terms):
        terms[t] = len(re.findall(r"\b" + re.escape(t) + r"\b", body))
        if terms[t] < 3:
            del terms[t]
    return terms


def analyze_exposition(path, lines, tags, body):
    """Does the piece model what its reader knows?

    These findings are about the gap between the writer's context and the
    reader's. A model writes from its context window, which holds the repo, the
    prior conversation and the internal docs, and nothing in that loop marks
    which parts the reader was present for.
    """
    out = []
    words = word_count(body)
    if words < th("unearned-prior-reference", "min_words", 250):
        return out

    prose_idx = [i for i, t in enumerate(tags) if t == "prose" and lines[i].strip()]
    if not prose_idx:
        return out
    early_cut = prose_idx[max(0, int(len(prose_idx) * 0.3)) - 1] if prose_idx else 0

    # ---- prior reference with nothing prior. Scoped to the opening third,
    # where by construction the document has not yet established anything.
    hits = []
    for i in prose_idx:
        if i > early_cut:
            break
        low_l = lines[i].lower()
        if any(f in low_l for f in PRIOR_REFERENCE) or VERSION_REFERENCE.search(lines[i]):
            hits.append((i + 1, lines[i].strip()[:90]))
    if hits:
        out.append(finding(
            path, hits[0][0], f"{len(hits)} back-reference(s) in the opening third, "
                              f"e.g. \"{hits[0][1]}\"",
            "unearned-prior-reference", "high",
            "The piece points at a history the reader was not present for. A model "
            "writes from its context window, which holds the previous versions, the "
            "internal thread and the repo, and nothing in that loop marks which of it "
            "the reader has seen.",
            "Either establish the prior thing in one sentence before you improve on it, "
            "or cut the comparison and state what the current thing does. \"Faster than "
            "our v2 pipeline\" means nothing to someone who never saw v2; \"processes "
            "40k invoices an hour\" means something to everyone.",
            family="form"))

    # ---- repo artifacts in outward prose
    toks = REPO_TOKEN.findall(body)
    rate = len(toks) / words * 1000
    if len(toks) >= th("repo-context-leak", "min_count", 4) \
       and rate > th("repo-context-leak", "cue_per_1000w", 3.0):
        ex = ", ".join(sorted(set(toks))[:4])
        out.append(finding(
            path, next((i + 1 for i in prose_idx if REPO_TOKEN.search(lines[i])), 1),
            f"{len(toks)} repo artifacts in prose ({rate:.1f}/1000w): {ex}",
            "repo-context-leak", "medium",
            "File paths, function names, ticket ids and branch names outside a code "
            "block, addressed to someone who does not have the repo open. The writer "
            "had it open; the reader does not.",
            "Name the thing by what it does, and put the identifier in a code block or "
            "a link if it is genuinely needed. \"The scheduler\" beats "
            "\"lib/fleet/conductor.ts\" in a sentence someone reads on a phone.",
            family="form"))

    # ---- terms used long before they are defined, or never defined
    undefined = []
    for term, n in sorted(candidate_terms(body).items(), key=lambda kv: -kv[1])[:12]:
        uses = [m.start() for m in re.finditer(r"\b" + re.escape(term) + r"\b", body)]
        if not uses:
            continue
        # Match across singular and plural: "Soft Leases" used, then "A Soft
        # Lease is a lease that..." defining it, is a definition and not a miss.
        stem = (re.escape(term[:-1]) + "s?") if term.endswith("s") \
            else (re.escape(term) + "e?s?")
        dm = re.search(r"\b" + stem + r"\b" + DEF_HINT, body, re.I) \
            or re.search(r"\b(?:call(?:ed)?|known as|term|what we mean by)\b[^.]{0,24}"
                         + stem, body, re.I)
        first_use = body[:uses[0]].count("\n")
        if dm is None:
            undefined.append((term, n, first_use, None))
        else:
            first_def = body[:dm.start()].count("\n")
            gap = first_def - first_use
            if gap > th("definition-after-use", "max_gap_lines", 12):
                undefined.append((term, n, first_use, gap))
    never = [u for u in undefined if u[3] is None]
    late = [u for u in undefined if u[3] is not None]
    if len(undefined) >= th("definition-after-use", "min_terms", 2):
        detail = "; ".join(
            f"{t} ({n}x, never defined)" if g is None else f"{t} ({n}x, defined {g} lines late)"
            for t, n, _, g in undefined[:4])
        out.append(finding(
            path, 1, f"{len(never)} term(s) never defined, {len(late)} defined after "
                     f"first use: {detail}",
            "definition-after-use", "high" if never else "medium",
            "Terms of art arriving before the reader has anything to attach them to. "
            "The writer already holds the concept, so the sentence reads fine to them "
            "and reads as noise to everyone else. This is the curse of knowledge with a "
            "context window behind it.",
            "Define a term at or before its first substantive use, in the sentence that "
            "uses it: an appositive is usually enough. Introduce one new idea at a time "
            "and let each one earn the next. If a term appears three times and you never "
            "define it, either define it or stop using it.",
            family="form"))

    # ---- announced structure
    sign = [(i + 1, lines[i].strip()[:80]) for i in prose_idx if SIGNPOST.search(lines[i])]
    if len(sign) >= th("signposting-without-structure", "min_count", 3):
        out.append(finding(
            path, sign[0][0], f"{len(sign)} meta-navigation sentences, e.g. "
                              f"\"{sign[0][1]}\"",
            "signposting-without-structure", "medium",
            "The shape of an argument announced rather than enacted. \"First we'll "
            "explore, then we'll examine, finally we'll conclude\" is an outline read "
            "aloud, and it costs the reader a paragraph before anything is said.",
            "Delete the announcements and let the headings and the prose do the work. If "
            "a transition is genuinely needed, make it carry information: say what "
            "changed, not that a section is beginning.",
            family="shape"))
    return out

# --------------------------------------------------------- web build signals

# Utility-class prefixes that mark the modern-framework idiom. Their PRESENCE is
# not a tell; their presence WITHOUT any responsive variant is, because it means
# the page wears the look of a framework without using the part that does work.
UTILITY_IDIOM = re.compile(
    r"\b(?:flex|grid|items-center|justify-between|rounded-\w+|px-\d|py-\d|"
    r"gap-\d|text-(?:xs|sm|base|lg|xl|\dxl)|bg-\w+-\d{2,3}|shadow-\w+)\b")
RESPONSIVE_VARIANT = re.compile(r"\b(?:sm|md|lg|xl|2xl):[a-z]", re.I)
SEMANTIC_TAGS = ("main", "nav", "header", "footer", "section", "article",
                 "aside", "figure", "figcaption")
SCAFFOLD_TITLES = ("create next app", "vite + react", "vite app", "react app",
                   "untitled", "document", "my app", "next.js app", "svelte app")
PLACEHOLDER_COPY = ("lorem ipsum", "your company", "acme inc", "acme corp",
                    "company name here", "your logo here", "product name")


def analyze_web_build(path, text):
    """Static build-quality checks over HTML/JSX/CSS.

    These are a different KIND of finding from the rest of this skill. They are
    not inferences about who wrote the page; they are defects you can reproduce
    by opening it. A page that horizontally scrolls at 390px scrolls for
    everyone, whoever built it. So they carry no fairness caveat and no dialect,
    and they are reported at the severity the defect deserves rather than the
    severity the suspicion deserves.
    """
    out = []
    lines = text.splitlines()
    low = text.lower()
    ext = path.suffix.lower()

    def first(pat, default=1):
        return next((i + 1 for i, l in enumerate(lines)
                     if re.search(pat, l, re.I)), default)

    # ---- the headline defect: framework look, no responsive implementation
    idiom = len(UTILITY_IDIOM.findall(text))
    variants = len(RESPONSIVE_VARIANT.findall(text))
    media = len(re.findall(r"@media[^{]*\((?:min|max)-width", low))
    if idiom >= th("framework-look-without-responsive", "min_idiom", 25) \
       and variants + media == 0:
        out.append(finding(
            path, first(r"class(?:Name)?="),
            f"{idiom} utility-class tokens, 0 responsive variants, 0 width media queries",
            "framework-look-without-responsive", "high",
            "The page wears the idiom of a modern framework and uses none of the part "
            "that does the work. Utility classes were copied for their look; the "
            "breakpoint prefixes that make the layout survive a phone were not.",
            "Pick the three widths that matter (about 390, 768, 1200) and make the page "
            "correct at each. Every multi-column grid needs a single-column form; every "
            "fixed width needs a max-width; horizontal padding belongs on a container, "
            "not on each child.", family="defect"))

    if ext in {".html", ".htm"} and "<head" in low and "name=\"viewport\"" not in low.replace("'", '"'):
        out.append(finding(
            path, first(r"<head"), "no viewport meta tag", "missing-viewport-meta", "high",
            "Without a viewport meta, a phone renders the page at desktop width and "
            "scales it down, so every text size and tap target is wrong. This is one "
            "line, and its absence means nobody opened the page on a phone.",
            'Add <meta name="viewport" content="width=device-width, initial-scale=1"> '
            "to <head>, then actually look at the result on a phone.", family="defect"))

    # ---- div soup
    divs = len(re.findall(r"<div\b", low))
    sem = sum(len(re.findall(r"<" + t + r"\b", low)) for t in SEMANTIC_TAGS)
    if divs >= th("div-soup-no-semantics", "min_divs", 20) \
       and sem <= divs * th("div-soup-no-semantics", "max_semantic_share", 0.08):
        out.append(finding(
            path, first(r"<div"), f"{divs} <div> vs {sem} semantic elements",
            "div-soup-no-semantics", "medium",
            "Everything is a div. Screen readers navigate by landmark and heading, so a "
            "page with no main, nav, header or footer has no structure to navigate by, "
            "however clear it looks on screen.",
            "Name the regions: one <main>, a <nav> for the nav, <header>/<footer>, and "
            "<section> where a heading introduces a region. It is a rename, not a "
            "rewrite, and it is usually twenty minutes.", family="defect"))

    clickable = [i + 1 for i, l in enumerate(lines)
                 if re.search(r"<(?:div|span)\b[^>]*\bon[Cc]lick", l)
                 and not re.search(r'role=["\']button|tabIndex|tabindex', l)]
    if clickable:
        out.append(finding(
            path, clickable[0], f"{len(clickable)} clickable <div>/<span> with no button role",
            "clickable-div-not-button", "high",
            "A div with a click handler is not reachable by keyboard, not announced as "
            "a control, and does not fire on Enter or Space. It looks identical and "
            "works for a subset of people.",
            "Use <button type=\"button\">. If it must stay a div, it needs role=\"button\", "
            "tabIndex={0}, and key handlers for Enter and Space — which is why you "
            "should use a button.", family="defect"))

    dead = len(re.findall(r'href=["\']#["\']', low)) + len(re.findall(r'href=["\']["\']', low))
    if dead >= th("dead-anchor-href", "min_count", 3):
        out.append(finding(
            path, first(r'href=["\']#?["\']'), f"{dead} anchors with href=\"#\" or empty",
            "dead-anchor-href", "medium",
            "Navigation that goes nowhere. On a real site these are the links a visitor "
            "tries first, and the generator emitted the shape of a nav without any "
            "destinations behind it.",
            "Point each link at a real destination, or remove it. A nav with three real "
            "links beats one with eight dead ones.", family="defect"))

    # ---- scaffold residue
    tm = re.search(r"<title[^>]*>([^<]{0,80})</title>", low)
    if tm and any(t in tm.group(1).strip() for t in SCAFFOLD_TITLES):
        out.append(finding(
            path, first(r"<title"), f"<title>{tm.group(1).strip()}</title>",
            "scaffold-title-residue", "high",
            "The framework's default title shipped. It is what a browser tab, a search "
            "result, and every shared link will say.",
            "Write the title: the product name, then what it is, under about 60 "
            "characters.", family="defect"))

    ph = [w for w in PLACEHOLDER_COPY if w in low]
    if ph:
        out.append(finding(
            path, first(re.escape(ph[0])), f"placeholder copy: {', '.join(ph)}",
            "placeholder-copy-residue", "high",
            "Template filler that reached a reader. Like an unfilled merge tag, this is "
            "proof rather than inference.",
            "Replace with real copy, or delete the section until you have some.",
            family="defect"))

    # ---- accessibility
    imgs = re.findall(r"<img\b[^>]*>", text, re.I)
    bad_alt = [g for g in imgs
               if not re.search(r"\balt=", g, re.I)
               or re.search(r'alt=["\'](?:image|photo|picture|screenshot)[^"\']*["\']', g, re.I)
               or re.search(r'alt=["\'][^"\']*\.(?:png|jpe?g|svg|webp)["\']', g, re.I)]
    if imgs and len(bad_alt) >= th("missing-or-placeholder-alt", "min_count", 2):
        out.append(finding(
            path, first(r"<img"), f"{len(bad_alt)} of {len(imgs)} <img> with missing or "
                                  f"placeholder alt text",
            "missing-or-placeholder-alt", "medium",
            "Alt text that says 'image of a person using a laptop' describes the file "
            "rather than its job on the page. Decorative images want alt=\"\"; "
            "informative ones want the information.",
            "For each image ask what a reader loses if it does not load. Write that. If "
            "nothing is lost, use alt=\"\" so it is skipped.", family="defect"))

    if re.search(r"outline\s*:\s*(?:none|0)", low) and ":focus-visible" not in low:
        out.append(finding(
            path, first(r"outline\s*:\s*(?:none|0)"),
            "outline removed with no :focus-visible replacement",
            "focus-outline-removed", "high",
            "Keyboard users navigate by the focus ring. Removing it without a "
            "replacement makes the page unusable without a mouse while looking tidier "
            "in a screenshot.",
            "Replace it rather than remove it: :focus-visible { outline: 2px solid "
            "<accent>; outline-offset: 2px }. Tab through the page and confirm you can "
            "always see where you are.", family="defect"))

    anim = len(re.findall(r"@keyframes|animation\s*:|transition\s*:|framer-motion|"
                          r"animate-\w+", low))
    if anim >= th("no-reduced-motion-guard", "min_animations", 6) \
       and "prefers-reduced-motion" not in low:
        out.append(finding(
            path, first(r"@keyframes|animation\s*:|animate-"),
            f"{anim} animation/transition declarations, no prefers-reduced-motion guard",
            "no-reduced-motion-guard", "medium",
            "Motion that cannot be turned off. For people with vestibular disorders "
            "this is not a preference, and the guard is four lines.",
            "@media (prefers-reduced-motion: reduce) { *, *::before, *::after { "
            "animation-duration: .01ms !important; transition-duration: .01ms "
            "!important } }", family="defect"))

    # ---- CSS hygiene
    bangs = low.count("!important")
    if bangs >= th("important-escalation", "min_count", 8):
        out.append(finding(
            path, first(r"!important"), f"{bangs} uses of !important",
            "important-escalation", "low",
            "Specificity fought rather than designed. It is what happens when styles are "
            "added without reading the ones already there.",
            "Find the rule being overridden and change it. Keep !important for utility "
            "overrides and print styles.", family="defect"))


    # ---- 100vw and the full-bleed hack: the most common single cause of the
    # sideways scroll, because 100vw includes the scrollbar and 100% does not.
    vw = len(re.findall(r"\b(?:width|min-width|max-width)\s*:\s*100vw\b", low)) \
        + len(re.findall(r"\bw-screen\b|\bw-\[100vw\]", low))
    bleed = len(re.findall(r"margin-(?:left|inline-start)\s*:\s*calc\(\s*-?50vw", low)) \
        + len(re.findall(r"margin-left\s*:\s*-50vw", low))
    if vw or bleed:
        out.append(finding(
            path, first(r"100vw|w-screen"),
            f"{vw} use(s) of 100vw/w-screen" + (f" plus {bleed} -50vw full-bleed hack(s)" if bleed else ""),
            "hundred-vw-overflow", "high" if bleed else "medium",
            "100vw is the viewport including its scrollbar, so on any desktop browser "
            "that reserves scrollbar space it is wider than the space available. Paired "
            "with the -50vw full-bleed trick it overflows twice.",
            "Use width:100% and let the element fill its container, or `100dvw` where you "
            "genuinely mean the dynamic viewport. For a full-bleed section inside a padded "
            "container, the modern form is `margin-inline: calc(50% - 50vw)` with "
            "`overflow-x: clip` on a wrapper \u2014 and verify it at 390px either way.",
            family="defect"))

    if re.search(r"\b(?:height|min-height)\s*:\s*100vh\b", low) or "h-screen" in low:
        out.append(finding(
            path, first(r"100vh|h-screen"), "100vh used for full-height layout",
            "static-vh-full-height", "low",
            "On mobile browsers 100vh is the viewport with the URL bar hidden, so a "
            "100vh hero is taller than the screen until you scroll, and the bottom of it "
            "is cut off on first paint.",
            "Use 100dvh (dynamic viewport height) with a 100vh fallback: "
            "`min-height: 100vh; min-height: 100dvh`. Or stop pinning the hero to the "
            "viewport at all, which is usually the better answer.",
            family="defect"))

    if ext in {".html", ".htm"} and re.search(r"<html\b", low) \
       and not re.search(r"<html\b[^>]*\blang\s*=\s*[\"']\s*[a-z]", low):
        out.append(finding(
            path, first(r"<html"), "<html> has no lang attribute",
            "missing-html-lang", "medium",
            "Without a language, screen readers pick a voice by guess and often read the "
            "page in the wrong accent or phonology. It is one attribute.",
            'Set it on the root element: <html lang="en">. Use the real language, and a '
            "region subtag only where it changes pronunciation or formatting.",
            family="defect"))

    if re.search(r"<script[^>]+src=[\"'][^\"']*(?:cdn\.tailwindcss\.com|@tailwindcss/browser)", low) \
       or re.search(r"<script[^>]+src=[\"'][^\"']*(?:babel-standalone|@babel/standalone)", low):
        out.append(finding(
            path, first(r"cdn\.tailwindcss\.com|babel-standalone|@babel/standalone"),
            "runtime-compiled CSS/JS CDN on a shipped page",
            "tailwind-play-cdn-in-production", "medium",
            "The Play CDN compiles your stylesheet in the visitor's browser on every "
            "page load. It exists for prototypes and says so in its own documentation. "
            "Shipping it means the build step was never set up.",
            "Install the framework as a build dependency and ship a compiled stylesheet. "
            "For Tailwind that is the CLI or the Vite/PostCSS plugin; the output is "
            "usually a few kilobytes against the CDN's several hundred, and it stops the "
            "flash of unstyled content.",
            family="defect"))

    h1s = len(re.findall(r"<h1\b", low))
    if ext in {".html", ".htm"} and "<body" in low and h1s != 1:
        out.append(finding(
            path, first(r"<h1|<body"), f"{h1s} <h1> elements",
            "h1-absent-or-competing", "medium",
            "Either nothing states what the page is, or several things claim to. The h1 "
            "is what a screen reader announces first and what search results lean on.",
            "Exactly one h1 per page, naming the page rather than the brand. Everything "
            "below it steps down by one level without skipping.",
            family="defect"))

    if ext in {".html", ".htm"} and "<head" in low:
        miss = []
        if not re.search(r'<meta[^>]+name=[\"\']description[\"\']', low):
            miss.append("meta description")
        if not re.search(r'<meta[^>]+(?:property|name)=[\"\']og:image', low):
            miss.append("og:image")
        if miss:
            out.append(finding(
                path, first(r"<head"), "missing: " + ", ".join(miss),
                "no-meta-description-or-og-image", "low",
                "What the page looks like when someone shares it or finds it. Without an "
                "og:image a link unfurls as a grey box, which reads as abandoned.",
                "Write a meta description that says what the page offers in about 150 "
                "characters, and set an og:image at 1200x630 showing the actual product "
                "rather than the logo on a gradient.",
                family="defect"))

    inputs = re.findall(r"<input\b[^>]*>", text, re.I)
    real = [i for i in inputs
            if not re.search(r'type=[\"\'](?:hidden|submit|button|image|reset)', i, re.I)]
    labelled = len(re.findall(r"<label\b", low)) + \
        len([i for i in real if re.search(r"aria-label|aria-labelledby", i, re.I)])
    if len(real) >= 2 and labelled < len(real):
        out.append(finding(
            path, first(r"<input"), f"{len(real)} real inputs, {labelled} with a label",
            "input-without-label", "medium",
            "A placeholder is not a label: it disappears the moment someone types, and "
            "screen readers do not reliably announce it. Unlabelled fields are the most "
            "common reason a form cannot be completed without sight.",
            "Give every input a <label for> pointing at its id, or an aria-label where a "
            "visible label genuinely does not fit. Keep the placeholder for an example of "
            "the format, not for the field name.",
            family="defect"))

    forms = re.findall(r"<form\b[^>]*>", text, re.I)
    orphan = [f for f in forms
              if not re.search(r"\baction\s*=", f, re.I)
              and not re.search(r"onSubmit|on-submit|@submit", f, re.I)]
    if orphan:
        out.append(finding(
            path, first(r"<form"), f"{len(orphan)} form(s) with no action and no submit handler",
            "form-without-destination", "high",
            "A form that goes nowhere. This one IS model-flavoured: a generator produces "
            "a complete, convincing front end for a back end that was never asked for, "
            "and the failure is invisible until a real person types into it and presses "
            "send.",
            "Wire it to something and then submit it yourself and confirm the message "
            "arrives. If there is no destination yet, replace the form with a mailto link "
            "so the page makes an honest promise.",
            family="defect"))

    dbg = len(re.findall(r"\bconsole\.(?:log|debug|warn)\s*\(", text)) \
        + len(re.findall(r"\bdebugger\s*;", text))
    if dbg >= th("debug-residue-in-production", "min_count", 3):
        out.append(finding(
            path, first(r"console\.(log|debug|warn)|debugger"),
            f"{dbg} console/debugger statements",
            "debug-residue-in-production", "low",
            "Working notes shipped to visitors. Harmless on its own, and a reliable sign "
            "nothing was reviewed on the way out.",
            "Strip them, or route them through a logger that compiles out in production. "
            "Check for logged request or user objects while you are there.",
            family="defect"))

    if re.search(r"import\s+\*\s+as\s+\w+\s+from\s+[\"\'](?:lucide-react|react-icons"
                 r"|@heroicons/react|@mui/icons-material)", text):
        out.append(finding(
            path, first(r"import\s+\*\s+as"), "whole icon library imported as a namespace",
            "barrel-icon-import", "medium",
            "Pulling the entire icon set for the handful actually used. Tree-shaking "
            "usually cannot help a namespace import, so the bundle carries thousands of "
            "components.",
            "Import the icons by name: `import { Check, X } from 'lucide-react'`. Then "
            "check the bundle actually shrank, because some of these packages need a "
            "per-icon path import to shake at all.",
            family="defect"))

    zs = [int(m) for m in re.findall(r"z-index\s*:\s*(\d{3,})", low)]
    zs += [int(m) for m in re.findall(r"\bz-\[(\d{3,})\]", low)]
    if zs and max(zs) >= th("z-index-escalation", "max_z", 100):
        out.append(finding(
            path, first(r"z-index|z-\["), f"z-index up to {max(zs)}",
            "z-index-escalation", "low",
            "Stacking resolved by bidding. A z-index of 9999 means nobody knows what it "
            "is competing with.",
            "Define a small scale (base 0, sticky 10, overlay 20, modal 30, toast 40) as "
            "tokens and use only those.", family="defect"))

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
        res = analyze_markup(path, text) + analyze_web_build(path, text)
        if suffix in {".html", ".htm"}:
            res += analyze_prose(path, strip_markup(text), suffix, base,
                                 from_markup=True)
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

    # --baseline is the load-carrying claim of this script, so it gets asserted
    # rather than demonstrated. Three properties have to hold together:
    #   1. a rhythm signal stays LOW with no baseline, whatever its absolute rate
    #   2. the same signal escalates to HIGH against a baseline it far exceeds
    #   3. an author scored against their OWN writing produces nothing
    # Property 3 is the one that matters: it is what stops this skill flagging
    # someone for writing the way they always write.
    dashy = ("We shipped it on a Tuesday \u2014 a bad Tuesday \u2014 and the replicas lagged "
             "\u2014 badly \u2014 behind the primary. Nobody lost money \u2014 we caught it early "
             "\u2014 but the alerting never fired \u2014 not once \u2014 which is the part that "
             "worries me. The fix was small \u2014 three lines \u2014 and finding it took "
             "hours \u2014 most of an afternoon \u2014 because we were looking at the wrong "
             "graph \u2014 the queue depth \u2014 the entire time. I still do not know "
             "\u2014 genuinely \u2014 why the lag spiked when it did.\n") * 3
    calm = ("We shipped the migration on a Tuesday and it went badly for about forty "
            "minutes. The read replicas lagged behind the primary, so a handful of "
            "customers saw stale invoice totals. Nobody lost money. We caught it "
            "because Tomasz happened to be looking at the wrong dashboard, which is "
            "not a control I want to rely on again. The fix was three lines in the "
            "connection pool config. Finding it took most of the afternoon, and I am "
            "still not sure we understand why the lag spiked when it did.\n") * 3

    def sev_of(text, base, ism="em-dash-density"):
        return next((f["severity"] for f in analyze_prose(Path("x.md"), text, ".md", base)
                     if f["ism"] == ism), None)

    calm_base = prose_metrics(calm, ".md")
    base = {"files": 1, "words": calm_base["words"],
            **{k: v for k, v in calm_base.items() if k != "words"}}

    no_base = sev_of(dashy, None)
    if no_base != "low":
        print(f"BASELINE TEST: dash-heavy text with no baseline should be 'low', got {no_base!r}")
        return 1
    with_base = sev_of(dashy, base)
    if with_base != "high":
        print(f"BASELINE TEST: dash-heavy text against a calm baseline should be "
              f"'high', got {with_base!r}")
        return 1
    own = [f["ism"] for f in analyze_prose(Path("x.md"), calm, ".md", base)
           if f.get("family") == "rhythm"]
    if own:
        print("BASELINE TEST: an author scored against their own writing produced "
              "rhythm findings:", " ".join(own))
        return 1

    print("selftest OK (all tells caught; zero false positives on the clean sample; "
          "--baseline escalates low->high on a real delta and stays silent on self)")
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
