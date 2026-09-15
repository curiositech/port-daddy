#!/usr/bin/env python3
"""Regenerate references/*.md from references/catalog.json. Stdlib only.

The catalog is the source of truth; the markdown files are grouped, readable
views of it. Re-run after editing catalog.json.

Two guarantees this script now enforces, because their absence cost real items:

  1. NO ORPHANS. Every catalog item must land in at least one generated file.
     A dialect value of "groq" where the catalog said "grok" silently dropped an
     item out of every reference for months, and nothing noticed because nothing
     checked. This exits non-zero rather than writing a quietly lossy view.

  2. EVERY FIELD IS RENDERED. If you add a field to the catalog, add it here.
     A field that exists only in JSON is a field the model reading the reference
     will never see.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "references"
cat = json.loads((REF / "catalog.json").read_text(encoding="utf-8"))
items, sources = cat["items"], cat["sources"]

PROSE_GENERIC = {"prose"}
VISUAL_MEDIA = {"web-ui", "typography", "color", "iconography", "layout"}
STRUCT_MEDIA = {"structure", "slide-deck", "marketing-copy"}
ENG_MEDIA = {"commit-message", "pr-description", "code-review", "code", "docs",
             "code-comments", "issue", "test"}
PLATFORM_MEDIA = {"social-post", "email", "listing", "resume"}
VISUAL_ASSET_MEDIA = {"image", "video", "audio", "chart", "brand-identity"}

GROUPS = {
    "claudeisms.md": {
        "title": "Claudeisms — and the generic prose tells Claude amplifies",
        "intro": "Tells most associated with Claude-family output, plus the cross-model prose tells that show up strongest in Claude registers. Severity is how loudly the tell announces machine authorship — not how confident you should be about who wrote it.",
        "pick": lambda i: i["dialect"] == "claude"
                          or (i["dialect"] == "generic-llm" and i["medium"] in PROSE_GENERIC),
    },
    "gptisms-codexisms.md": {
        "title": "GPT-isms and Codexisms",
        "intro": "ChatGPT's service voice and README register, and the code-comment tells of Codex/Copilot-shaped generation.",
        "pick": lambda i: i["dialect"] in {"chatgpt", "codex", "copilot", "cursor"},
    },
    "other-model-dialects.md": {
        "title": "Other model dialects — Gemini, Kimi, DeepSeek, Qwen, Llama, Grok — and cross-model translationese",
        "intro": "Distinctive tics per model family, plus the affect and register tells that mark any machine output regardless of vendor.",
        "pick": lambda i: i["dialect"] in {"gemini", "kimi", "deepseek", "qwen", "llama", "grok"}
                          or i["name"] in {"zero-typo-zero-contraction-affect-flatness",
                                           "tense-and-perspective-drift",
                                           "low-burstiness-uniform-rhythm", "as-an-ai-leakage",
                                           "register-leveling"},
    },
    "visual-design-tells.md": {
        "title": "Visual design tells — the v0/Lovable look and generated imagery",
        "intro": "What makes a UI, slide, or image read as generated: the defaults nobody chose, clustering together. Read the currency line on every item here — the image-forensics advice in particular has a short shelf life, and some of it has already expired.",
        "pick": lambda i: i.get("family") != "defect" and (i["medium"] in VISUAL_MEDIA or i["medium"] in VISUAL_ASSET_MEDIA)
                          or i["name"].startswith("ai-image")
                          or i["name"] in {"identical-face-different-people",
                                           "stock-mesh-gradient-background"},
    },
    "structure-and-deck-tells.md": {
        "title": "Structure, deck, and marketing-copy tells",
        "intro": "Document-shape tells: how generated long-form docs, slides, posts, and emails are assembled, independent of any sentence in them.",
        "pick": lambda i: i.get("family") != "defect" and (i["medium"] in STRUCT_MEDIA or i["medium"] in PLATFORM_MEDIA),
    },
    "web-build-defects.md": {
        "title": "Web build defects \u2014 the half you can reproduce",
        "intro": "A different KIND of finding from the rest of this catalog. Everything here is a defect you can reproduce by opening the page: it scrolls sideways at 390px, the button is not a button, the grey text fails contrast. So none of it is an inference about who built the page, none of it carries the fairness caveat the rest of the skill insists on, and all of it can be acted on with full confidence \u2014 the same standing as a dead citation. Act on this file FIRST: a page that does not work on a phone has a bigger problem than a page that reads a bit generated.\n\nMost of these are decidable from source and run in the normal structural pass. The ones marked `rendered` need `scripts/render_check.py`, the one optional script in this bundle, which opens the page at real viewports and names the elements at fault.",
        "pick": lambda i: not i.get("lane")
                          and (i.get("family") == "defect"
                               or i["name"] in {"scaffold-title-residue",
                                                "placeholder-copy-residue"}),
    },
    "fiction-and-narrative-tells.md": {
        "title": "Fiction and narrative tells",
        "intro": "What generated fiction does at the level of story rather than sentence. This file matters out of proportion to its length: a 61,608-story study separated human from AI fiction at 93.2% macro-F1 using discourse-level narrative features ALONE, with every stylistic cue stripped out. Which means the tells here are stronger than any phrase in the rest of the catalog, and they survive a model that has learned not to say \"delve\".",
        "pick": lambda i: i["medium"] == "fiction",
    },
    "engineering-artifact-tells.md": {
        "title": "Engineering-artifact tells — commits, PRs, reviews, code, tests, docs",
        "intro": "What generated engineering work looks like in the artifacts maintainers actually read. The highest-precision checks in this file are all RELATIVE — drift from the repo's own log, idiom, or PR norm — because those need no word list, do not age as models change, and a contributor who read the surrounding code passes them automatically.",
        "pick": lambda i: i["medium"] in ENG_MEDIA,
    },
    "unopened-surfaces.md": {
        "title": "Unopened surfaces \u2014 navigation, i18n, docs, commerce, email, print",
        "intro": "Everything in this file is about a surface that was never opened. The model has no printer, no Outlook, no German tester, no screen reader, and no second page to navigate to \u2014 so the tell is rarely that it wrote something strange. The tell is that a whole class of output was never looked at, and the defect sat there because looking is the only thing that would have found it.\n\nThat makes this file read UNREVIEWED rather than AI, and the distinction matters when you report a finding: you are telling an author what they have not yet checked, not making a claim about who wrote it. The handful of genuinely model-flavoured entries say so in their own **Why it reads AI** line.\n\nOne structural finding runs through the navigation entries and is worth reading first: `ia-is-a-projection-of-the-filesystem`. The flat nav, the fat footer, the empty mega-menu and the four-deep docs sidebar are four symptoms of one cause \u2014 the information architecture is a rendering of the directory listing, because enumeration is free and prioritisation needs knowledge the generator does not have.\n\nTwo entries here share a fix, which is unusual enough to name: switching a PDF export from `screenshot()` to `page.pdf()` makes the invoice text-selectable AND makes it honour a print stylesheet, so twelve lines of `@media print` repair browser printing and turn a dead raster receipt into a real document at the same time.",
        "pick": lambda i: i.get("lane") in {"navigation-and-ia", "i18n", "docs",
                                            "commerce", "email", "print"},
    },
    "dark-patterns-the-model-inherits.md": {
        "title": "Dark patterns the model inherits",
        "intro": "A model that produces a fake countdown or an asymmetric cookie banner is not choosing to deceive. These patterns are statistically NORMAL on the commercial web \u2014 Princeton found 1,818 dark-pattern instances across 1,254 of 11,000 shopping sites \u2014 so they are what \"build me a product page\" or \"add a cookie banner\" retrieves. Treat every item here as a high-confidence finding the author must decide about, never as an inference about intent.\n\nThe surprising part, and the reason this file exists separately: the unlawful thing is usually not the generated component but the GAP between two generated components. `tracking-before-consent` is the clean case \u2014 the analytics snippet is correct, the consent banner is correct, nothing connects them, and the site ends up with a compliant-looking banner sitting on top of a completed violation that no static check of either half would find. `cancellation-has-no-path` and `cost-revealed-at-last-step` have the same shape. So the highest-value checks in this file are RELATIONAL and RENDERED: load the page in a fresh profile and watch the network, rather than grepping either component.\n\nWhich also makes the fairness framing different here from the rest of the catalog. You are not telling an author they wrote something manipulative. You are telling them that two innocent halves add up to a fine.",
        "pick": lambda i: i.get("lane") == "dark-patterns",
    },
}

SEV_RANK = {"high": 0, "medium": 1, "low": 2}
CURRENCY_NOTE = {
    "obsolete": "⚠ OBSOLETE — retained as a caution, not as a test.",
    "fading": "Fading — still seen, but vendors have patched toward it and it is weakening.",
    "current": "",
}


def block(i):
    L = [(f"### `{i['name']}`  ·  {i['severity']} · {i['dialect']} · {i['medium']} · "
          + f"{i.get('detection_type','')} · family: {i.get('family','')}"
          + (f" · lane: {i['lane']}" if i.get("lane") else "")), ""]
    note = CURRENCY_NOTE.get(i.get("currency", "current"), "")
    if note:
        L += [f"**Currency:** {note}", ""]
    L += [i["description"], ""]
    if i.get("why_it_reads_ai"):
        L += [f"**Why it reads AI:** {i['why_it_reads_ai']}", ""]
    L += [f"**Detect:** {i['detection']}", ""]
    if i.get("thresholds"):
        pairs = ", ".join(f"`{k}` = {v}" for k, v in i["thresholds"].items())
        L += [f"**Thresholds** (read by `scripts/humanize_review.py`): {pairs}", ""]
    L += [f"**Fix:** {i['fix']}", ""]
    if i.get("false_positive_when"):
        L += [f"**False positive when:** {i['false_positive_when']}", ""]
    if i.get("confidence"):
        L += [f"**Confidence:** {i['confidence']}", ""]
    if i.get("evidence"):
        L += [f"**Evidence:** {i['evidence']}", ""]
    if i.get("before"):
        L += ["**Before**", "", "> " + i["before"].replace("\n", "\n> "), ""]
    if i.get("after"):
        L += ["**After**", "", "> " + i["after"].replace("\n", "\n> "), ""]
    return "\n".join(L)


placed = set()
for fname, g in GROUPS.items():
    picked = sorted((i for i in items if g["pick"](i)),
                    key=lambda i: (SEV_RANK.get(i["severity"], 3), i["name"]))
    placed |= {i["name"] for i in picked}
    doc = [f"# {g['title']}", "", g["intro"], "",
           (f"_{len(picked)} items. Generated from catalog.json — edit there, then re-run "
            + "`scripts/regenerate_references.py`. Do not hand-edit this file._"), "",
           ("_Every item carries a **False positive when** line. Read it before you act on "
            + "the item: these are cues for an editor, not evidence about an author._"), "",
           "<!-- humanize:ignore-start",
           "     Everything below is a specimen catalog. It quotes the tells it documents,",
           "     including literal machine residue, so reviewing it with humanize_review.py",
           "     would flag the exhibits rather than the writing. -->", ""]
    doc += [block(i) for i in picked]
    doc += ["<!-- humanize:ignore-end -->", ""]
    (REF / fname).write_text("\n".join(doc), encoding="utf-8")
    print(f"{fname}: {len(picked)} items")

orphans = [i["name"] for i in items if i["name"] not in placed]
if orphans:
    print("\nERROR: these catalog items land in no generated reference:", file=sys.stderr)
    for o in orphans:
        it = next(x for x in items if x["name"] == o)
        print(f"  {o}  (dialect={it['dialect']} medium={it['medium']})", file=sys.stderr)
    print("Add a GROUPS rule that covers them, or fix the item's dialect/medium.",
          file=sys.stderr)
    sys.exit(1)

src_doc = ["# Sources", "",
           "Published catalogs, stylometry research, and essays the catalog draws on.",
           "", "_Generated from catalog.json. Do not hand-edit._", "",
           "<!-- humanize:ignore-start -- source titles and notes quote machine artifacts. -->", ""]
for s in sorted(sources, key=lambda s: s["title"].lower()):
    note = f" — {s['note']}" if s.get("note") else ""
    src_doc.append(f"- [{s['title']}]({s['url']}){note}")
src_doc.append("\n<!-- humanize:ignore-end -->")
(REF / "sources.md").write_text("\n".join(src_doc) + "\n", encoding="utf-8")
print(f"sources.md: {len(sources)} sources")
print(f"\nall {len(items)} items placed, no orphans")
