#!/usr/bin/env python3
"""figure_doctrine.py -- score every figure in the Book against a named,
citable rubric instead of against three unnamed perspectives.

WHY A RUBRIC AND NOT MORE OPINIONS
----------------------------------
The desk already carries three agent reviewers (lensA exposition, lensB
drawing, lensC evidence) and, since the pixel judgment, a fourth voice that
read the printed page. All four are opinions. An opinion can be argued with
only by having a louder opinion. A criterion with a source can be argued with
on the merits: you can say "Tufte is wrong about that, and here is Few's
objection", and that is a different and better conversation.

So every criterion below carries:
  * `source`     -- the doctrine it comes from, named precisely enough to
                    look up and disagree with.
  * `contested`  -- whether serious people dispute it, and WHO. A rubric that
                    presents contested doctrine as settled is claiming an
                    authority it has not earned, so the dispute is shown in
                    the desk UI, not hidden in a footnote here.
  * `evidence`   -- one of:
                      "machine"  something in this repository answers it, and
                                 this file computes the answer;
                      "human"    the pixel judgment already judged it in
                                 prose, and this file MAPS that prose onto the
                                 criterion, quoting it;
                      "open"     nothing committed answers it. Recorded as
                                 unscored, with the reason. NOT guessed.

Nine criteria are machine-scored, two are mapped from prose, four are open.
That ratio is the honest state of the evidence, and it is shown on the desk
rather than padded out with invented verdicts.

THE TWO COUNTER-CHECKS
----------------------
Two criteria exist specifically to stop the rubric flattering itself:

  `over-erased`  Few and Wilke both argue Tufte's own redesigns strip ink the
                 reader needed. This repository's gates cannot produce this
                 list at all: every mechanical check it owns measures the
                 PRESENCE of a mark (a \\tiny, a bare \\fill, a line through
                 text), and this criterion measures a harmful ABSENCE. The
                 corpus's clearest instance is computed here:
                 `pd-figure-language-swiss.tex` overrides `pd focus fill`,
                 `pd caution fill`, `pd neutral fill`, `pd state` and
                 `pd hatch` with `draw=none`, and the Book is the Swiss
                 edition, so every region in every figure using those styles
                 prints with no drawn edge. That is scored HERE, against
                 over-erasure -- not against decorative-ink, where it would
                 read as a virtue.

  `caption-carries-the-fact`
                 The inverse of caption-states-a-claim. A caption can be
                 excellent and still be a defect, if the paragraph that
                 introduces the figure gave its one concrete fact away to the
                 caption and kept nothing. Computed by running
                 skills/textbook-craft/scripts/readers_eye.py -- with one
                 change that matters: readers_eye scans a chapter file's own
                 floats, and 56 of the Book's 59 figures live in `\\input`
                 fragments it never opens, so it sees almost none of them.
                 This module expands the `\\input` sites first and then runs
                 it, which takes the rule from 2 findings to 5. The gap is the
                 same species as the pixel judgment's finding 1.1: a checker
                 that reads one file cannot see a defect that lives in the
                 relation between two.

Imported by build_figure_desk.py; runnable on its own for a quick look:

    python3 scripts/harbor-research/figure_doctrine.py --repo-root . --json
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------
# The rubric
# ---------------------------------------------------------------------------

CRITERIA = [
    # --- Integrity (Tufte doctrine 1) -------------------------------------
    dict(id="lie-factor", group="Integrity",
         ask="Is the physical size of the effect proportional to the effect in the data? Honest band 0.95-1.05.",
         source="Tufte, The Visual Display of Quantitative Information, ch. 2 (the lie factor)",
         appliesTo="figures encoding quantity; n/a for diagrams", evidence="open",
         openBecause="Needs the plotted geometry measured against the underlying numbers. "
                     "Nothing committed pairs a figure with its own data series, so this is "
                     "not computable from the repository today.",
         contested=False, objectors=None),
    dict(id="dimensions-exceed-data", group="Integrity",
         ask="Are the visual dimensions no more than the data dimensions? No 3D for a scalar, no area for a 1-D number.",
         source="Tufte, VDQI ch. 2 (dimensionality)",
         appliesTo="all", evidence="machine",
         contested=False, objectors=None),
    dict(id="axes-labelled-in-units", group="Integrity",
         ask="Are the axes labelled in standard units, on the graphic itself and not only in the caption?",
         source="Tufte, VDQI ch. 2; dataviz skill, anti-patterns.md",
         appliesTo="plots with axes", evidence="machine",
         contested=False, objectors=None),
    dict(id="all-the-data", group="Integrity",
         ask="Is a subset shown where the full set would weaken the point? (the Challenger test: every case plotted, not only the failures)",
         source="Tufte, Visual Explanations ch. 2 (Challenger)",
         appliesTo="figures encoding quantity", evidence="open",
         openBecause="Requires knowing what was left out, which only the figure's own data "
                     "source can say. The figures naming a script and a seed are auditable in "
                     "principle; none is audited here.",
         contested=False, objectors=None),

    # --- Ink (doctrine 2, and its contested edge) -------------------------
    dict(id="decorative-ink", group="Ink",
         ask="Does any mark neither encode data nor orient the reader?",
         source="Tufte, VDQI ch. 4-5 (data-ink ratio, chartjunk)",
         appliesTo="all", evidence="human",
         contested=True,
         objectors="Few (Perceptual Edge) and Bateman et al. (CHI 2010) both find non-data ink "
                   "can aid recall without harming accuracy; Kosara argues the data-ink ratio "
                   "is an aesthetic preference presented as a measurement."),
    dict(id="over-erased", group="Ink",
         ask="Does removing this ink make the reader work harder for the same fact? If yes it was never chartjunk.",
         source="Few, 'Save the Pies for Dessert'; Wilke, Fundamentals of Data Visualization "
                "ch. 29 -- both argue Tufte's own redesigns over-erase",
         appliesTo="all", evidence="machine",
         contested=True,
         objectors="This criterion IS the objection to the one above it. Tufte would score most "
                   "of these figures as improved; Few and Wilke would not. Both positions are in "
                   "the rubric on purpose, and a figure can fail decorative-ink and over-erased "
                   "at once.",
         counterCheckFor="decorative-ink"),

    # --- Form (doctrines 3, 4, 15 and the dataviz decision tree) ----------
    dict(id="wrong-form", group="Form",
         ask="What does the decision tree say? <=20 numbers a reader looks up exactly -> a table. "
             "Many entities, same metric shape -> small multiples. A single number -> a sentence.",
         source="dataviz skill, choosing-a-form.md; Tufte, VDQI ch. 6-8",
         appliesTo="all", evidence="human",
         contested=False, objectors=None),
    dict(id="small-multiple-discipline", group="Form",
         ask="Where it is a grid: same scale, same frame, same size, exactly one dimension varying.",
         source="Tufte, Envisioning Information ch. 4 (small multiples)",
         appliesTo="grids of panels", evidence="open",
         openBecause="Needs per-panel axis ranges read out of the rendered picture. The pixel "
                     "pass measured type size and ink coverage, not panel scales.",
         contested=False, objectors=None),
    dict(id="belongs-in-margin", group="Form",
         ask="Could this be a sparkline or a regime strip in the margin instead of a float?",
         source="Tufte, Beautiful Evidence ch. 2 (sparklines); tufte-evidence-design skill",
         appliesTo="all", evidence="open",
         openBecause="A judgement about the page, not the picture. Recorded because the Book's "
                     "margin column is 43.2% occupied with a median of 34 characters when "
                     "present -- far more room than the corpus uses -- but no committed source "
                     "says which figure should move.",
         contested=False, objectors=None),

    # --- Words (doctrines 13, 14; textbook-craft) -------------------------
    dict(id="caption-states-a-claim", group="Words",
         ask="Is the caption a sentence asserting what the figure shows, not a label naming its axes?",
         source="Tufte, Beautiful Evidence ch. 6; textbook-craft skill",
         appliesTo="all", evidence="machine",
         heuristic="Machine-judged and deliberately weak. A caption reads as a claim when its "
                   "first sentence has a finite verb and is not of the form 'X vs Y' / 'X against "
                   "Y' / 'X by Z'. Two known limits: it cannot tell a true claim from a false one, "
                   "and math is stripped before the test (so the caption can be matched against "
                   "the rendered page), which means a caption whose only verb lives inside $...$ "
                   "reads as a label here. Argue with an individual verdict; the aggregate is the "
                   "signal.",
         contested=False, objectors=None),
    dict(id="caption-carries-the-fact", group="Words",
         ask="Does the caption state something concrete while the paragraph introducing the figure states nothing?",
         source="skills/textbook-craft/scripts/readers_eye.py, rule caption-carries-the-fact (PR #10200)",
         appliesTo="all", evidence="machine",
         counterCheckFor="caption-states-a-claim",
         contested=False, objectors=None),
    dict(id="figure-at-first-mention", group="Words",
         ask="Does the float land in the reading column where it is first mentioned, or pages away in a gallery?",
         source="Tufte, Beautiful Evidence ch. 4 (integration of word and image)",
         appliesTo="all", evidence="machine",
         contested=False, objectors=None),

    # --- Colour (dataviz -- computed, never eyeballed) --------------------
    dict(id="palette-pair-fails", group="Colour",
         ask="Does this figure put two of the palette's failing colour pairs where one reader sees both?",
         source="dataviz skill, color-formula.md; computed by scripts/harbor-research/palette_check.py",
         appliesTo="figures painted in a story colour", evidence="machine",
         contested=False, objectors=None),
    dict(id="colour-alone", group="Colour",
         ask="Is any distinction carried by colour with no redundant encoding?",
         source="dataviz skill, color-formula.md; WCAG 1.4.1",
         appliesTo="figures with two or more series hues", evidence="machine",
         contested=True,
         objectors="Not disputed on the merits, but it is not Tufte's. His four books are silent "
                   "on colour-vision deficiency; that silence is not permission, and this "
                   "criterion is imported from the dataviz skill rather than inherited."),

    # --- Voice (port-daddy-expository-writer) -----------------------------
    dict(id="earns-its-name", group="Voice",
         ask="Does the figure follow problem -> story -> analogy -> mechanism -> name, or does it "
             "present the house term before the reader has a reason to want it?",
         source="port-daddy-expository-writer skill (the expository move)",
         appliesTo="all", evidence="open",
         openBecause="Needs the figure read against the section that introduces it, in order. "
                     "readers_eye.py's metaphor and naming rules are the nearest mechanical "
                     "approach and they judge prose, not pictures.",
         contested=False, objectors=None),
]

CRITERIA_BY_ID = {c["id"]: c for c in CRITERIA}

# The five styles the Swiss edition strips the edge from. Whether it actually
# does is read from the two files at run time; these names are only the keys.
EDGED_STYLES = ("pd focus fill", "pd caution fill", "pd neutral fill", "pd state", "pd hatch")

SWISS_REL = "website-v2/public/whitepaper/figures/pd-figure-language-swiss.tex"
BASE_REL = "website-v2/public/whitepaper/figures/pd-figure-language.tex"
READERS_EYE_REL = "skills/textbook-craft/scripts/readers_eye.py"
READERS_EYE_LEX_REL = "skills/textbook-craft/references/readers-eye-lexicon.json"


def _read(root: str, rel: str) -> str | None:
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return fh.read()


# ---------------------------------------------------------------------------
# The Swiss edge deletion  (over-erased)
# ---------------------------------------------------------------------------

def swiss_edgeless_styles(root: str) -> dict:
    """Which edged styles the Swiss override sets to draw=none, and what the
    base figure language asked for instead. Both halves read from disk."""
    swiss, base = _read(root, SWISS_REL), _read(root, BASE_REL)
    out: dict = {}
    if not swiss:
        return out
    for style in EDGED_STYLES:
        m = re.search(re.escape(style) + r"/\.(?:append )?style\s*=\s*\{", swiss)
        if not m:
            continue
        seg = swiss[m.end():m.end() + 400].split("},\n")[0]
        if "draw=none" not in seg.replace(" ", ""):
            continue
        asked = None
        if base:
            bm = re.search(re.escape(style) + r"/\.style\s*=\s*\{", base)
            if bm:
                bseg = base[bm.end():bm.end() + 400].split("},\n")[0]
                dm = re.search(r"draw=([A-Za-z0-9!]+)", bseg)
                if dm:
                    asked = dm.group(1)
        out[style] = {"swissSetsDrawNone": True, "baseAskedFor": asked}
    return out


# ---------------------------------------------------------------------------
# Chapter colours  (palette-pair-fails)
# ---------------------------------------------------------------------------

def chapter_colours(textbook: dict) -> dict:
    """chapter number -> the story colour its part declares."""
    by_id = {c["id"]: c["number"] for c in textbook.get("chapters", [])}
    out = {}
    for part in textbook.get("parts", []):
        colour = part.get("color")
        for cid in part.get("chapters", []):
            if cid in by_id and colour:
                out[by_id[cid]] = colour
    return out


# ---------------------------------------------------------------------------
# readers_eye  (caption-carries-the-fact)
# ---------------------------------------------------------------------------

def readers_eye_findings(root: str, textbook: dict, label_to_id: dict) -> tuple[dict, str | None]:
    """Run readers_eye.py's caption rule over chapters with \\input expanded.

    Returns ({figure id: finding}, unavailable_reason_or_None). Never raises: a
    desk that cannot run the tool should say so, not fail to build.
    """
    script = os.path.join(root, READERS_EYE_REL)
    if not os.path.isfile(script):
        return {}, f"{READERS_EYE_REL} is not present on this branch"

    lex = os.path.join(root, READERS_EYE_LEX_REL)
    expanded: list[str] = []
    try:
        for c in textbook.get("chapters", []):
            src = os.path.join(root, c["source"])
            if not os.path.isfile(src):
                continue
            figdir = os.path.join(os.path.dirname(src), "figures")
            with open(src, encoding="utf-8") as fh:
                text = fh.read()

            def rep(m, _figdir=figdir):
                p = os.path.join(_figdir, m.group(1) + ".tex")
                if os.path.isfile(p):
                    with open(p, encoding="utf-8") as fh2:
                        body = fh2.read()
                    if "\\begin{figure}" in body and "\\caption" in body:
                        return body
                return m.group(0)

            # written beside the chapter so its own relative paths still resolve
            out = os.path.join(os.path.dirname(src), f".doctrine-expanded-ch{c['number']}.tex")
            with open(out, "w", encoding="utf-8") as fh:
                fh.write(re.sub(r"\\input\{figures/([^}]*)\}", rep, text))
            expanded.append(out)

        if not expanded:
            return {}, "no chapter source could be expanded"

        cmd = [sys.executable, script, "--rule", "caption-carries-the-fact",
               "--json", "--limit", "999", "--repo-root", root]
        if os.path.isfile(lex):
            cmd += ["--lexicon", lex]
        cmd += expanded
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, cwd=root)
        if proc.returncode not in (0, 1) or not proc.stdout.strip():
            return {}, f"readers_eye.py exited {proc.returncode}: {(proc.stderr or '').strip()[:200]}"
        data = json.loads(proc.stdout)
        items = data if isinstance(data, list) else data.get("findings", [])
    except Exception as e:  # pragma: no cover - defensive
        return {}, f"readers_eye.py could not be run: {e}"
    finally:
        for p in expanded:
            try:
                os.unlink(p)
            except OSError:
                # Best-effort cleanup of our own temp files, deliberately
                # silent. This runs in a `finally`, so it also runs on the
                # error paths above; letting an unlink failure raise here
                # would replace the real diagnostic (the readers_eye.py exit
                # status or exception) with an OSError about a scratch file
                # nobody is waiting on. A leftover temp file is the lesser
                # harm than a swallowed root cause.
                pass

    out = {}
    for f in items:
        label = (f.get("evidence") or {}).get("float_label")
        fid = label_to_id.get(label)
        if fid:
            out[fid] = f
    return out, None


# ---------------------------------------------------------------------------
# Mapping the pixel judgment's prose onto two criteria
# ---------------------------------------------------------------------------

_WRONG_FORM = [
    (r"\bthis is a table\b", "the decision tree says table"),
    (r"\bwants to be a\b", "the decision tree names a different form"),
    (r"\bis a classification\b", "a classification is a table, not a tinted matrix"),
    (r"\bnot a chart\b", "not a chart at all"),
    (r"\bthe ink is inverted\b", "the encoding is inverted"),
    (r"\bschematic\b[^.;]*\bno data\b|\bno data\b[^.;]*\bschematic\b",
     "a schematic curve with no data is a sentence"),
]
_FORM_OK = [r"\bright form\b", r"\bform ok\b", r"\bexactly right\b", r"\bthe right pair\b",
            r"\bis the right form\b", r"\bexactly the taxonomy", r"\bright form for\b"]
_DECOR = [
    (r"\bchartjunk\b", "named as chartjunk"),
    (r"\badds nothing\b", "a mark that adds nothing the words do not"),
    (r"\bdecorative\b", "a decorative mark"),
    (r"\bsecond caption\b", "a note long enough to read as a second caption"),
    (r"\bcarries nothing\b", "carries nothing the sentence does not"),
]


def _first_sentence_matching(text: str, pattern: str) -> str | None:
    for s in re.split(r"(?<=[.;])\s+", text or ""):
        if re.search(pattern, s, re.I):
            return s.strip()
    return None


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score(root: str, textbook: dict, figs: list, pixel: dict, palette: dict) -> tuple[dict, dict]:
    """-> ({figure id: {criterion id: {verdict, evidence, ...}}}, context)."""
    edgeless = swiss_edgeless_styles(root)
    ch_colour = chapter_colours(textbook)

    # failing pairs, narrowed to the colours chapters actually use -- a pair
    # between two colours no chapter carries is a defect no reader can see
    in_use = sorted(set(ch_colour.values()))
    fail_pairs = [p for p in palette.get("pairs", []) if p["verdict"].startswith("fail")]
    live_pairs = [p for p in fail_pairs if p["a"] in in_use and p["b"] in in_use]

    label_to_id: dict = {}
    frag: dict = {}
    for f in figs:
        p = os.path.join(root, f.get("src") or "")
        body = ""
        if (f.get("src") or "").endswith(".tex") and os.path.isfile(p):
            with open(p, encoding="utf-8") as fh:
                body = fh.read()
            lm = re.search(r"\\label\{([^}]*)\}", body)
            if lm:
                label_to_id[lm.group(1)] = f["id"]
        frag[f["id"]] = body

    re_hits, re_gap = readers_eye_findings(root, textbook, label_to_id)

    # distance from the \input site to the first \ref, per chapter source
    first_mention: dict = {}
    for c in textbook.get("chapters", []):
        src = os.path.join(root, c["source"])
        if not os.path.isfile(src):
            continue
        with open(src, encoding="utf-8") as fh:
            ctext = fh.read()
        for f in figs:
            lm = re.search(r"\\label\{([^}]*)\}", frag.get(f["id"]) or "")
            if not lm:
                continue
            site = ctext.find("\\input{figures/%s}" % f["id"])
            if site < 0:
                continue
            rm = re.search(r"\\(?:ref|autoref|cref|Cref)\{" + re.escape(lm.group(1)) + r"\}", ctext)
            if not rm:
                first_mention.setdefault(f["id"], ("unreferenced", c["number"]))
                continue
            paras = ctext[min(site, rm.start()):max(site, rm.start())].count("\n\n")
            prev = first_mention.get(f["id"])
            if prev is None or not isinstance(prev[0], int) or paras < prev[0]:
                first_mention[f["id"]] = (paras, c["number"])

    out: dict = {}
    for f in figs:
        fid = f["id"]
        body = frag.get(fid) or ""
        px = pixel.get(fid) or {}
        sc: dict = {}

        def put(cid, verdict, evidence, **extra):
            sc[cid] = dict(verdict=verdict, evidence=evidence, **extra)

        # ---- over-erased -------------------------------------------------
        used = [s for s in edgeless if s in body]
        if f.get("imported"):
            put("over-erased", "n/a",
                "An imported PDF: it does not use the Book's figure language at all, so the "
                "Swiss edge deletion cannot reach it. It obeys no house rule either way.")
        elif used:
            asked = ", ".join("`%s` (the base language asked for draw=%s)"
                              % (s, edgeless[s]["baseAskedFor"] or "an edge")
                              for s in sorted(used))
            put("over-erased", "fails",
                "Uses %s. The Book is the Swiss edition, and %s sets draw=none on %s, so every one "
                "of these regions prints with no drawn edge. The fragment asked for the edge; one "
                "style file removed it corpus-wide, which is exactly why tikz_precheck's P13 "
                "cannot see it." % (asked, SWISS_REL, "them" if len(used) > 1 else "it"),
                styles=sorted(used))
        else:
            put("over-erased", "passes",
                "Uses none of the five styles the Swiss edition strips the edge from.")

        # ---- palette-pair-fails -----------------------------------------
        colour = ch_colour.get(f.get("ch"))
        direct = sorted(set(re.findall(r"\bpd(?:cobalt|teal|gold|health|indigo|rust|violet)\b", body)))
        if not used and not direct:
            put("palette-pair-fails", "n/a",
                "Paints nothing in a story colour: it uses only the hh* figure set, which is what "
                "craft rule 4 asks for.")
        elif direct:
            put("palette-pair-fails", "fails",
                "Names the page-grammar story colour(s) %s directly. Craft rule 4 restricts figures "
                "to the hh* set." % ", ".join(direct), colours=direct)
        else:
            against = [p for p in live_pairs if colour in (p["a"], p["b"])]
            if against:
                others = []
                for p in against:
                    other = p["b"] if p["a"] == colour else p["a"]
                    chs = sorted(k for k, v in ch_colour.items() if v == other)
                    others.append("%s (ch %s) at dE %.1f normal-vision / %.1f worst CVD"
                                  % (other, ", ".join(map(str, chs)), p["normal"], p["worst"]))
                put("palette-pair-fails", "fails",
                    "Its regions take \\pdcurrentchaptercolor, which for chapter %s is %s. That "
                    "colour fails separation against %s. A reader holding this figure beside one "
                    "from those chapters cannot tell the two fills apart."
                    % (f.get("ch"), colour, "; ".join(others)),
                    colour=colour, failsAgainst=[p["a"] + "/" + p["b"] for p in against])
            else:
                put("palette-pair-fails", "passes",
                    "Its regions take %s, which clears every pair against the other chapter "
                    "colours in use." % colour)

        # ---- colour-alone ------------------------------------------------
        hues = sorted(set(re.findall(r"\bhh(?:teal|amber|ink|gray|sand|paper|rose|plum)\b", body)))
        series_hues = [h for h in hues if h not in ("hhink", "hhgray", "hhsand", "hhpaper")]
        redundant = bool(re.search(
            r"\b(dashed|dotted|densely|loosely|mark\s*=|pattern\s*=|double|line width)\b", body))
        if f.get("imported"):
            put("colour-alone", "unscored",
                "An imported matplotlib PDF: its encodings are not readable from the repository.")
        elif len(series_hues) < 2:
            put("colour-alone", "n/a", "Does not tell two series apart by colour.")
        elif redundant:
            put("colour-alone", "passes",
                "Uses %s for its series and also carries a second channel (dash pattern, marks or "
                "line weight), so the distinction survives greyscale and colour-vision deficiency."
                % ", ".join(series_hues))
        else:
            put("colour-alone", "fails",
                "Tells %s apart by hue alone -- no dash, mark or weight doubles it."
                % " and ".join(series_hues))

        # ---- axes-labelled-in-units -------------------------------------
        is_axis = ("\\begin{axis}" in body or "\\begin{semilogyaxis}" in body
                   or "\\begin{semilogxaxis}" in body or "addplot" in body)
        if not is_axis:
            put("axes-labelled-in-units", "n/a", "Not a plot with axes.")
        else:
            has_x = bool(re.search(r"\bxlabel\s*=", body))
            has_y = bool(re.search(r"\bylabel\s*=", body))
            if has_x and has_y:
                put("axes-labelled-in-units", "passes", "Both xlabel and ylabel are set on the axis.")
            else:
                miss = " and ".join(n for n, ok in (("xlabel", has_x), ("ylabel", has_y)) if not ok)
                put("axes-labelled-in-units", "fails",
                    "%s is missing from the axis, so that quantity is named only in the caption, "
                    "if at all." % miss)

        # ---- dimensions-exceed-data -------------------------------------
        if f.get("imported"):
            put("dimensions-exceed-data", "unscored", "An imported PDF; not inspectable from source.")
        elif re.search(r"\\addplot3|\bplot3\b|\bpie\b|\[3d\]", body, re.I):
            put("dimensions-exceed-data", "fails",
                "Draws a third visual dimension or an area encoding of a scalar.")
        else:
            put("dimensions-exceed-data", "passes",
                "Two visual dimensions, no 3D and no area encoding of a scalar.")

        # ---- caption-states-a-claim -------------------------------------
        cap = (f.get("caption") or "").strip()
        first = re.split(r"(?<=[.])\s", cap)[0] if cap else ""
        label_shaped = bool(re.match(
            r"^[^.]{0,80}?\b(vs\.?|versus|against|by)\b[^.]{0,40}$", first, re.I)) or len(first.split()) < 5
        has_verb = bool(re.search(
            r"\b(is|are|was|were|has|have|does|do|shows?|stays?|falls?|rises?|holds?|breaks?|"
            r"crosses?|carries|carry|closes?|needs?|costs?|keeps?|sits?|reaches?|becomes?|"
            r"differs?|survives?|collapses?|advances?|cannot|only)\b", first, re.I))
        if not cap:
            put("caption-states-a-claim", "unscored", "No caption could be read from the source.")
        elif label_shaped or not has_verb:
            put("caption-states-a-claim", "fails",
                "The caption opens as a label rather than a claim: %r" % first[:160], heuristic=True)
        else:
            put("caption-states-a-claim", "passes",
                "The caption's first sentence asserts something: %r" % first[:160], heuristic=True)

        # ---- caption-carries-the-fact -----------------------------------
        if re_gap:
            put("caption-carries-the-fact", "unscored", re_gap)
        elif fid in re_hits:
            ev = re_hits[fid]
            put("caption-carries-the-fact", "fails", ev.get("message", ""),
                paragraphWords=(ev.get("evidence") or {}).get("paragraph_words"),
                captionSample=(ev.get("evidence") or {}).get("caption_concrete_sample"))
        else:
            put("caption-carries-the-fact", "passes",
                "readers_eye.py finds no split between this figure's caption and the paragraph "
                "that introduces it.")

        # ---- figure-at-first-mention ------------------------------------
        fm = first_mention.get(fid)
        if f.get("imported"):
            put("figure-at-first-mention", "n/a",
                "Set inline in the chapter source at the point it is discussed.")
        elif fm is None:
            put("figure-at-first-mention", "unscored",
                "No \\label in the fragment to match a \\ref against.")
        elif fm[0] == "unreferenced":
            put("figure-at-first-mention", "fails",
                "Nothing in chapter %s references it: a float the prose never sends the reader to."
                % fm[1])
        elif fm[0] <= 2:
            put("figure-at-first-mention", "passes",
                "Input within %d paragraph(s) of its first reference." % fm[0])
        else:
            put("figure-at-first-mention", "fails",
                "%d paragraphs separate its first mention from where it is set." % fm[0])

        # ---- wrong-form / decorative-ink, mapped from the pixel prose ----
        prose = " ".join(str(px.get(k) or "") for k in ("dataviz", "pixels"))
        hit = next(((p, why) for p, why in _WRONG_FORM if re.search(p, prose, re.I)), None)
        if not px:
            put("wrong-form", "unscored", "Not judged on the page, so no form reading exists.")
        elif hit:
            put("wrong-form", "fails",
                "%s — %s" % (_first_sentence_matching(prose, hit[0]) or prose[:200], hit[1]),
                mappedFrom="pixel judgment, dataviz column")
        elif any(re.search(p, prose, re.I) for p in _FORM_OK):
            put("wrong-form", "passes",
                _first_sentence_matching(prose, "|".join(_FORM_OK)) or "the decision tree's form",
                mappedFrom="pixel judgment, dataviz column")
        else:
            put("wrong-form", "unscored",
                "The pixel judgment's form reading does not state plainly whether the decision "
                "tree was obeyed.")

        dhit = next(((p, why) for p, why in _DECOR if re.search(p, prose, re.I)), None)
        if not px:
            put("decorative-ink", "unscored", "Not judged on the page.")
        elif dhit:
            put("decorative-ink", "fails",
                "%s — %s" % (_first_sentence_matching(prose, dhit[0]) or prose[:200], dhit[1]),
                mappedFrom="pixel judgment")
        else:
            put("decorative-ink", "passes",
                "Nothing in the page reading names a mark that neither encodes nor orients.",
                mappedFrom="pixel judgment")

        # ---- the open criteria ------------------------------------------
        for c in CRITERIA:
            if c["evidence"] == "open":
                put(c["id"], "unscored", c["openBecause"])

        out[fid] = sc

    return out, {"edgelessStyles": edgeless, "chapterColours": ch_colour,
                 "livePalettePairs": live_pairs, "readersEyeGap": re_gap,
                 "readersEyeHits": sorted(re_hits)}


# ---------------------------------------------------------------------------
# Agreement with the three lenses
# ---------------------------------------------------------------------------

# A failure on one of these implies the figure needs work. Used only to ask
# "did a lens wave this through?" -- never to produce a verdict of its own.
IMPLIES_WORK = {"lie-factor", "dimensions-exceed-data", "axes-labelled-in-units", "all-the-data",
                "over-erased", "wrong-form", "caption-states-a-claim",
                "caption-carries-the-fact", "palette-pair-fails", "colour-alone"}


def doctrine_vs_lenses(scores: dict, crit: dict) -> dict:
    """Where the rubric fails a figure that a lens waved through."""
    out = {}
    for fid, sc in scores.items():
        fails = sorted(cid for cid, r in sc.items()
                       if r["verdict"] == "fails" and cid in IMPLIES_WORK)
        if not fails:
            continue
        waved = [L for L in ("lensA", "lensB", "lensC")
                 if str((((crit.get(fid) or {}).get(L) or {}).get("verdict") or "")).lower().startswith("keep")]
        if waved:
            out[fid] = {"fails": fails, "lensesSaidKeep": waved}
    return out


def main(argv=None) -> int:  # pragma: no cover - a convenience entry point
    import argparse
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.json:
        print(json.dumps({"criteria": CRITERIA}, indent=2))
    else:
        for c in CRITERIA:
            print(f"{c['id']:<28} {c['group']:<10} {c['evidence']:<8} "
                  f"{'CONTESTED' if c['contested'] else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
