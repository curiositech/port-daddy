#!/usr/bin/env python3
"""Regenerate references/*.md from references/catalog.json. Stdlib only.

The catalog is the source of truth; the markdown files are grouped, readable
views of it. Re-run after editing catalog.json.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "references"
cat = json.loads((REF / "catalog.json").read_text())
items, sources = cat["items"], cat["sources"]

PROSE_GENERIC = {"prose"}
VISUAL_MEDIA = {"web-ui", "typography", "color", "iconography", "layout"}
STRUCT_MEDIA = {"structure", "slide-deck", "marketing-copy"}

GROUPS = {
    "claudeisms.md": {
        "title": "Claudeisms — and the generic prose tells Claude amplifies",
        "intro": "Tells most associated with Claude-family output, plus the cross-model prose tells that show up strongest in Claude registers. Severity is how loudly the tell announces machine authorship.",
        "pick": lambda i: i["dialect"] == "claude" or (i["dialect"] == "generic-llm" and i["medium"] in PROSE_GENERIC),
    },
    "gptisms-codexisms.md": {
        "title": "GPT-isms and Codexisms",
        "intro": "ChatGPT's service voice and README register, and the code-comment tells of Codex/Copilot-shaped generation.",
        "pick": lambda i: i["dialect"] in {"chatgpt", "codex"},
    },
    "other-model-dialects.md": {
        "title": "Other model dialects — Gemini, Kimi, DeepSeek, Qwen, Llama, Grok — and cross-model translationese",
        "intro": "Distinctive tics per model family, plus the affect-flatness tells that mark any machine register.",
        "pick": lambda i: i["dialect"] in {"gemini", "kimi", "deepseek", "qwen", "llama", "groq"}
                          or i["name"] in {"zero-typo-zero-contraction-affect-flatness", "tense-and-perspective-drift",
                                            "low-burstiness-uniform-rhythm", "as-an-ai-leakage"},
    },
    "visual-design-tells.md": {
        "title": "Visual design tells — the v0/Lovable look and AI imagery",
        "intro": "What makes a UI, slide, or image read as generated: the defaults nobody chose, clustering together.",
        "pick": lambda i: i["medium"] in VISUAL_MEDIA or i["name"].startswith("ai-image") or i["name"] in {"identical-face-different-people", "stock-mesh-gradient-background"},
    },
    "structure-and-deck-tells.md": {
        "title": "Structure, deck, and marketing-copy tells",
        "intro": "Document-shape tells: how generated long-form docs, slides, posts, and emails are assembled, independent of any sentence.",
        "pick": lambda i: i["medium"] in STRUCT_MEDIA,
    },
}

SEV_RANK = {"high": 0, "medium": 1, "low": 2}

def block(i):
    lines = [f"### `{i['name']}`  ·  {i['severity']} · {i['dialect']} · {i['medium']} · {i.get('detection_type','')}", ""]
    lines += [i["description"], ""]
    if i.get("why_it_reads_ai"):
        lines += [f"**Why it reads AI:** {i['why_it_reads_ai']}", ""]
    lines += [f"**Detect:** {i['detection']}", ""]
    lines += [f"**Fix:** {i['fix']}", ""]
    if i.get("before"):
        lines += ["**Before**", "", "> " + i["before"].replace("\n", "\n> "), ""]
    if i.get("after"):
        lines += ["**After**", "", "> " + i["after"].replace("\n", "\n> "), ""]
    return "\n".join(lines)

for fname, g in GROUPS.items():
    picked = sorted((i for i in items if g["pick"](i)), key=lambda i: (SEV_RANK.get(i["severity"], 3), i["name"]))
    doc = [f"# {g['title']}", "", g["intro"], "",
           f"_{len(picked)} items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._", ""]
    doc += [block(i) for i in picked]
    (REF / fname).write_text("\n".join(doc))
    print(f"{fname}: {len(picked)} items")

src_doc = ["# Sources", "", "Published catalogs, stylometry research, and essays the catalog draws on.", ""]
for s in sorted(sources, key=lambda s: s["title"].lower()):
    note = f" — {s['note']}" if s.get("note") else ""
    src_doc.append(f"- [{s['title']}]({s['url']}){note}")
(REF / "sources.md").write_text("\n".join(src_doc) + "\n")
print(f"sources.md: {len(sources)} sources")
