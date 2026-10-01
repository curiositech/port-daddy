#!/usr/bin/env python3
"""Committed source of record for Chapter 0 figures in the Swiss Modern Edition.

Crafted in accordance with:
- /nano-banana-image-gen (Google Gemini Nano Banana Pro prompting formula)
- docs/harbor-research/exposition/SWISS-BRIEF.md
- website-v2/docs/design/BRAND.md (Mineral Slate pdslate tokens)

Every figure prompt carries:
1. Explicit role labeling: Reference image 1 is the STYLE TEMPLATE for craft.
2. Hard modular grid of visible hairline rules on warm paper #FBF7EF.
3. One dominant high-contrast black-and-white halftone photograph cropped square to the grid.
4. Flat opaque planes in Chapter 0 Mineral Slate (#384856, #768694, #AAB5BF), charcoal #121212.
5. A single solitary signal red #DA291C accent dot/square (<= 2% area).
6. Strict positive text suppression: completely bare and unlettered planes.
"""
from __future__ import annotations

PIPELINE_VERSION = "4.1.0"

PALETTE = {
    "paper": "#FBF7EF",
    "ink": "#121212",
    "red": "#DA291C",
    "slate": {
        "100": "#384856",
        "62": "#768694",
        "38": "#AAB5BF",
    },
}

STYLE_HEADER = (
    "Reference image 1 is the STYLE TEMPLATE for craft only — match its hard flat-ink mechanical "
    "edges, its crisp geometric precision, its complete absence of gradients, texture, outlines, "
    "shading, photographic elements or printed marks, and its overall Swiss International Typographic "
    "Style rendering technique. Do not copy the reference image's own colors, shapes, layout or "
    "composition — this new figure uses an entirely different color palette and geometry, both "
    "specified below.\n\n"
)

REGISTER = (
    "A Swiss International Typographic Style plate in the manner of Josef Müller-Brockmann and "
    "Herbert Matter: built on a visible hard modular grid of fine hairline rules on warm off-white "
    "paper #FBF7EF, with flat planes of opaque color, and high-contrast black-and-white industrial "
    "scientific halftone photography montaged against those planes and cropped strictly square to "
    "the grid. Orthogonal and 45-degree constructivist composition, asymmetric balance, and active "
    "negative space. Printed flat on uncoated warm paper #FBF7EF. "
)

NO_TEXT = (
    " Absolutely no lettering, numerals, words, letterforms, captions, labels, logos or symbols "
    "resembling writing anywhere in the image. Where the composition calls for a type area, leave "
    "a clean empty plane of flat color; all typography is typeset afterwards in LaTeX."
)

GRID = (
    " A quiet lattice of hairline-thin near-black construction rules crosses the active picture area "
    "at regular intervals — mostly horizontal and vertical, with key construction lines at exactly 45 "
    "degrees. Every construction hairline reads as quiet underlying structure, not as a new shape."
)

APPENDIX = (
    "Flat offset-lithograph rendering on uncoated paper, in the manner of Swiss International "
    "Typographic Style and Zurich Konkrete Kunst. Every shape is a hard-edged area of completely "
    "flat, uniform, solid ink with a crisp mechanical edge and perfectly even color from edge to edge "
    "— never any gradient, blend, banding, glow, bevel, or texture within a shape or the ground. "
    "No outline unless the outline itself is the subject. No rotation off the horizontal, vertical or "
    "45-degree axes. The image fills its entire canvas edge to edge with the described flat colors "
    "touching all four sides directly. Square corners only, never rounded."
)


def _build_prompt(subject: str, header: bool = True) -> str:
    return (
        (STYLE_HEADER if header else "")
        + REGISTER
        + subject.strip()
        + GRID
        + "\n\n"
        + APPENDIX
        + NO_TEXT
    )


FIGURES = {
    "fig-0-5a-cnp-bidding": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Bilateral task announcement, capacity self-assessment, and auction refusal",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. On the left third, high-contrast "
            "black-and-white scientific macro halftone photograph of an industrial harbor telegraph annunciator "
            "dial with brass indicator hands, cropped strictly square to the grid. Running across the center "
            "is a heavy horizontal datum bar of charcoal #121212. Above the datum bar sits an elongated "
            "rectangular plane of flat opaque Mineral Slate #384856 representing a formal bid submission, "
            "and below it an adjacent smaller slate plane severed by a clean 20% gap representing an explicit "
            "capacity refusal. Centered at the bid junction sits a single solitary signal red #DA291C square."
        ),
    ),
    "fig-0-5b-cnp-settlement": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Exclusive worktree lease, sandbox confinement, and dual-control escrow settlement",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. In the left column, a high-contrast "
            "black-and-white industrial halftone photograph of heavy machined steel bank vault dual-key "
            "lock cylinders in raking directional light, cropped hard and square to the grid. In the central "
            "field, an isolated rectangular plane of solid charcoal #121212 representing a confined sandbox enclave. "
            "On the right half, two interlocking vertical slabs of flat opaque Mineral Slate (#384856 and #768694) "
            "meet at a razor-sharp vertical seam representing dual-control verification keys. A single sharp "
            "signal red #DA291C circular dot sits at the release threshold between the two slabs."
        ),
    ),
    "fig-0-6-big-brother-logic": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Dynamic epistemic observation cones, asymmetric visibility, and shadow containment",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. In the central grid module, a high-contrast "
            "black-and-white optical laboratory halftone photograph: an optical beam-splitter prism refracting "
            "a sharp light blade across a black table into deep shadow, cropped square to the grid. Radiating "
            "from the center are two 45-degree triangular wedges of flat opaque Mineral Slate #384856 representing "
            "directed observation cones. Flanking them is a broad rectangular field of solid charcoal #121212 "
            "representing an epistemic shadow. Inside the shadow floats a single tiny signal red #DA291C dot "
            "representing an unobserved secret proposition."
        ),
    ),
    "fig-0-8-skills-logarithmic": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Progressive disclosure of skills across four logarithmic decades of context contraction",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. In the upper-left quadrant, a high-contrast "
            "black-and-white macro halftone photograph of an antique brass logarithmic slide rule with fine "
            "engraved scales and a glass cursor hairline, cropped square to the grid. The remaining canvas "
            "features a visible logarithmic lattice of fine hairline rules with column widths stepping down in "
            "powers of two (1, 1/2, 1/4, 1/8). Across these decades descend four stepped horizontal rectangular "
            "monoliths of flat Mineral Slate #384856, stepping down exponentially in height. At the foot of the "
            "steepest drop sits a solitary signal red #DA291C square marking zero-token execution."
        ),
    ),
    "fig-0-9-lifecycle-hooks": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Nested supervisory loops: outer turn lifecycle and inner tool interception gates",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. In the central square module, a high-contrast "
            "black-and-white industrial scientific halftone photograph of heavy concentric mechanical planetary "
            "escapement gears and trip pawls, cropped hard and square to the grid. Surrounding the photograph are "
            "two nested rectangular frame enclosures of fine hairline rules: a wide outer perimeter in pale slate "
            "#AAB5BF, and an inner chamber in solid charcoal #121212. At the ingress port of the inner chamber "
            "sits a single sharp signal red #DA291C rectangular interlock tooth representing the pre-tool veto gate."
        ),
    ),
    "fig-0-11-closed-loop": dict(
        aspect="16:9",
        image_size="2K",
        style="cover",
        mechanism="Three-tier closed agentic loop: probabilistic deliberation, host execution, and TCB governance",
        prompt=_build_prompt(
            "Horizontal 16:9 composition on flat paper #FBF7EF. In the upper-right quadrant, a high-contrast "
            "black-and-white architectural halftone photograph of a multi-tier canal lock chamber with heavy steel "
            "guillotine gates, cropped square to the grid. Spanning the entire width are three cleanly separated "
            "horizontal rectangular strata: top stratum in pale slate #AAB5BF (deliberation), middle stratum in "
            "mid slate #768694 (sandboxed execution), and bottom stratum in deep mineral slate #384856 (kernel "
            "governance). Connecting the tiers is a crisp vertical hairline datum rule, punctuated at the kernel "
            "commit horizon by a single solitary signal red #DA291C square."
        ),
    ),
}

if __name__ == "__main__":
    print(f"Chapter 0 Swiss Modern Figures Registry (v{PIPELINE_VERSION})")
    for k, v in FIGURES.items():
        print(f"  - {k} ({v['aspect']}, {v['image_size']}): {v['mechanism']}")
