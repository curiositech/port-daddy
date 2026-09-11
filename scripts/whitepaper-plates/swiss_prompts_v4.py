#!/usr/bin/env python3
"""Swiss edition plate briefs, round 4 — photomontage, not flat shapes.

Rounds 1-3 asked for a handful of flat geometric primitives on paper. They
came back reading like Microsoft Paint, and no amount of precision language
fixed that, because the problem was never the model's draughtsmanship: five
plain shapes IS a thin design, and a thin design rendered perfectly is still
thin.

Real Swiss modern is denser than that. Muller-Brockmann, Herbert Matter and
the Swiss Railways information designers built with a hard modular grid, flat
signal-colour planes, reversed-out type areas, axonometric construction --
AND photography, high-contrast black-and-white halftone, cropped hard to the
grid and montaged against the colour planes. The photograph is what gives the
page life; the grid is what keeps it disciplined. That is the register these
briefs now ask for.

Every plate here therefore carries:
  - a visible hard modular grid of thin rules,
  - one dominant black-and-white halftone photographic element, cropped
    square to that grid, on a subject drawn from the chapter's own world,
  - flat planes of the part's ink plus the signal red accent,
  - asymmetric balance and active negative space,
  - and NO lettering of any kind: every panel that will carry type is left
    empty, because the type is set in LaTeX where it can be correct.

Aspect and image size are unchanged from the round-2 pipeline so the plates
drop into the same macros.
"""
from __future__ import annotations

PIPELINE_VERSION = "4.0.0"

PALETTE = {
    "paper": "#FBF7EF", "ink": "#121212", "red": "#DA291C",
    "I": "#001489", "II": "#006B5F", "III": "#582C83", "IV": "#666A00",
}

REGISTER = (
    "A Swiss International Typographic Style plate in the manner of Josef Muller-Brockmann and "
    "Herbert Matter: built on a hard modular grid whose thin rules are visible as structure, with "
    "flat planes of opaque colour, high-contrast black-and-white halftone photography montaged "
    "against those planes and cropped square to the grid, axonometric construction where the "
    "subject allows, asymmetric balance and active negative space. Printed flat on warm off-white "
    "paper #FBF7EF. The photographic elements are genuinely photographic -- real tonal halftone "
    "with visible screen, not illustration -- and they are the life of the composition. "
)

NO_TEXT = (
    " Absolutely no lettering, numerals, words, letterforms, captions, labels, logos or symbols "
    "resembling writing anywhere in the image. Where the composition calls for a type area, leave "
    "a clean empty plane of flat colour; the lettering is typeset afterwards."
)


def _brief(subject: str, colour: str, extra: str = "") -> str:
    return (
        REGISTER
        + f"Dominant colour: flat {colour}, with the signal red #DA291C used once and small as the "
          "single accent, and charcoal #121212 for reversed-out planes. "
        + subject.strip() + " " + extra.strip() + NO_TEXT
    )


PLATES = {
    "cover": dict(
        aspect="2:3", image_size="4K", style=None,
        subject=(
            "THE MOST IMPORTANT CONSTRAINT: the upper 40 percent of this image, full width, is one "
            "clean empty plane of bare paper. Nothing at all appears in it -- no photograph, no "
            "colour plane, no grid rule, no mark of any kind. The title is typeset into that space "
            "afterwards and must not fight anything. Everything described below happens strictly "
            "BELOW that band. "
            "Subject: a great container port seen from above and slightly oblique -- gantry cranes "
            "in a row, stacked containers in strict rows, a ship alongside -- as one large "
            "high-contrast halftone photograph filling the lower 60 percent, cropped hard on the "
            "grid. Over it, three flat colour planes of the dominant ink, offset from one another "
            "on the grid, one of them running off the right edge."
        ), colour="#001489 reflex blue"),
    "part-I": dict(
        aspect="3:2", image_size="4K", style="cover",
        subject=(
            "Subject: raw board-marked concrete substructure -- a massive foundation wall and "
            "footing photographed square-on in hard raking light -- as a halftone photograph "
            "filling the right two thirds. Flat colour planes step across it from the left on the "
            "grid; one narrow plane is reversed out to charcoal. A clean empty band across the top."
        ), colour="#001489 reflex blue"),
    "part-II": dict(
        aspect="3:2", image_size="4K", style="cover",
        subject=(
            "Subject: a dense array of instrument dials and radar scopes photographed head-on, as "
            "a halftone photograph cropped into a strict grid of equal rectangles, some cells "
            "replaced by flat colour planes so the photograph reads as a partly-resolved field. A "
            "clean empty band across the top."
        ), colour="#006B5F tonhalle green"),
    "part-III": dict(
        aspect="3:2", image_size="4K", style="cover",
        subject=(
            "Subject: a ship's riveted hull in dry dock, shored on timber blocks, photographed "
            "from below in hard light, as a halftone photograph occupying the left half and "
            "bleeding off the left edge. Flat colour planes of the dominant ink stack to the right "
            "on the grid. A clean empty band across the top."
        ), colour="#582C83 konkret violet"),
    "part-IV": dict(
        aspect="3:2", image_size="4K", style="cover",
        subject=(
            "Subject: a bonded warehouse interior -- ranked shelving, crates, a weighing floor -- "
            "photographed in one-point perspective as a halftone photograph, cropped to a wide "
            "band across the middle. Flat colour planes above and below it on the grid, one "
            "reversed out to charcoal. A clean empty band across the top."
        ), colour="#666A00 ledger olive"),
    "chapter-swk": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: the mechanism of a teleprinter or typebar machine photographed in extreme "
            "close-up, levers and linkages in hard light, as a halftone photograph cropped into a "
            "tall block on the left third. To its right, flat colour planes marching across the "
            "grid, each smaller than the last, and one thin red rule crossing all of them."
        ), colour="#001489 reflex blue"),
    "chapter-anchor": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: an anchor windlass and heavy chain on a foredeck, photographed close and "
            "square, as a halftone photograph in a block on the right. Nested flat colour "
            "rectangles, each strictly smaller and darker than the one before, step into it from "
            "the left on the grid."
        ), colour="#001489 reflex blue"),
    "chapter-sealed": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a bank vault door, its locking bolts and hinge visible, photographed "
            "square-on as a halftone photograph in a centred block. A closed flat colour frame "
            "surrounds it with exactly one slot cut through the right side, and a single red rule "
            "runs from the right edge and stops dead at the inner face of that frame."
        ), colour="#006B5F tonhalle green"),
    "chapter-ls": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a harbour crowded with small boats seen from directly overhead, as a "
            "high-contrast halftone photograph filling the plate, over which a scattered field of "
            "small flat colour squares sits on the grid -- dense at the edges, and resolving into "
            "one large solid colour disc at the centre where the squares stop."
        ), colour="#006B5F tonhalle green"),
    "chapter-stp": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a riveted steel hull plate with one clean welded seam running across it, "
            "photographed raking, as a halftone photograph band across the lower half. Above it "
            "one broad flat colour arc is interrupted and then resumes, both parts plainly the "
            "same band on the same circle, the gap sitting directly over the weld."
        ), colour="#582C83 konkret violet"),
    "chapter-he": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a coin press and stacked minted blanks photographed close in hard light, as "
            "a halftone photograph block on the right. Three flat colour bars of increasing height "
            "stand on one shared charcoal baseline to the left of it on the grid."
        ), colour="#666A00 ledger olive"),
    "chapter-bonded": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a strapped and sealed cargo crate on a warehouse floor, photographed "
            "three-quarter, as a halftone photograph in a square block. A flat colour plane sits "
            "behind it, gripped at exactly three points by short heavy charcoal brackets, and one "
            "small red square sits alone in the negative space to the right."
        ), colour="#666A00 ledger olive"),
    "chapter-fh": dict(
        aspect="16:9", image_size="4K", style="cover",
        subject=(
            "Subject: a railway switching yard seen from above, tracks fanning and rejoining, as a "
            "halftone photograph band across the plate. Over it, three separated flat colour "
            "blocks joined by thin charcoal rules that run exactly along the tracks below."
        ), colour="#666A00 ledger olive"),
}


def prompt(name: str) -> str:
    spec = PLATES[name]
    return _brief(spec["subject"], spec["colour"])
