#!/usr/bin/env python3
"""The committed source of record for the Swiss edition's thirteen plates:
the palette, the per-plate mechanism, and the two candidate image-model
prompts actually sent for each plate (wave-16/swiss-plates redo). Read by
plates_pipeline.py's `build_swiss()` — regenerating any plate means editing
here and re-running the pipeline, not reconstructing a prompt from shell
history or from PROVENANCE.json's flat copy.

Art direction: docs/harbor-research/exposition/SWISS-BRIEF.md. Palette,
chapter tint ladder, and part inks below are transcribed from that brief's
section B and from whitepaper/textbook.json; do not hand-edit a hex here
without updating both.

Generation: Google's Nano Banana Pro (`gemini-3-pro-image-preview`) via
`nano-banana-image-gen/scripts/generate.py --image-size {2K,4K}
--no-fallback`, one candidate "a" and one candidate "b" per plate, the cover
generated first and then attached as the STYLE TEMPLATE `--style` reference
to every other plate. `CHOSEN` names the candidate actually used; the other
stays in PROVENANCE.json for the record.
"""

PIPELINE_VERSION = "2.0.0"

# ------------------------------------------------------------- palette -----
PALETTE = {
    "paper": "#FBF7EF",   # hhpaper
    "ink": "#121212",     # pdink, near-black
    "red": "#DA291C",     # signal red, reserved: cover, chapter-sealed, chapter-bonded only
    "parts": {
        "I": {"name": "Reflex Blue", "100": "#001489", "62": "#5F6AB0", "38": "#9CA1C8"},
        "II": {"name": "Tonhalle Green", "100": "#006B5F", "62": "#5FA093", "38": "#9CC2B8"},
        "III": {"name": "Konkret Violet", "100": "#582C83", "62": "#8B6BAA", "38": "#B9A0CE"},
        "IV": {"name": "Ledger Olive", "100": "#666A00", "62": "#9FA05B", "38": "#C2C194"},
    },
    # chapter-he's three-column redo asked for 100/60/35% tints specifically
    # (not the book's 100/62/38 ladder) -- olive mixed toward paper at those
    # exact fractions, kept here rather than only inline in the prompt text.
    "custom_tints": {
        "IV_60": "#A2A260",
        "IV_35": "#C7C69B",
    },
}

# ---------------------------------------------------------- shared clauses -
APPENDIX = (
    "Flat offset-lithograph rendering on uncoated paper, in the manner of Swiss International "
    "Typographic Style and Zurich Konkrete Kunst — Josef Müller-Brockmann, Richard Paul Lohse, "
    "Max Bill, Armin Hofmann. Every shape is a hard-edged area of completely flat, uniform, solid ink "
    "with a crisp mechanical edge and perfectly even color from edge to edge — never any gradient, "
    "blend, banding, glow, bevel, or texture within a shape or the ground. No outline unless the "
    "outline itself is the subject. No photograph, no illustration. No rotation off the horizontal, "
    "vertical or 45-degree axes. The image fills its entire canvas edge to edge with the described "
    "flat colors touching all four sides directly — there is no card, no page mockup, no picture "
    "frame, no drop shadow, no vignette, and no border of any color around the image; the flat color "
    "simply continues all the way to every edge of the frame. All reserved areas described above are "
    "completely bare and unmarked — nothing is printed there, not even a hairline. The picture "
    "consists only of the flat geometric shapes described, on their stated ground color. Square "
    "corners only, never rounded."
)

STYLE_HEADER = (
    "Reference image 1 is the STYLE TEMPLATE for craft only — match its hard flat-ink mechanical "
    "edges, its crisp geometric precision, its complete absence of gradients, texture, outlines, "
    "shading, photographic elements or printed marks, and its overall Swiss International Typographic "
    "Style rendering technique. Do not copy the reference image's own colors, shapes, layout or "
    "composition — this new plate uses an entirely different color palette and geometry, both "
    "specified below.\n\n"
)

GRID = (
    " A quiet lattice of hairline-thin near-black construction rules crosses the active picture area "
    "at a few regular intervals — mostly horizontal and vertical, with one running at exactly 45 "
    "degrees — some of them continuing past the edge of the main colored shape onto the immediately "
    "adjoining bare paper margin (never into the wide bare band reserved for lettering, which stays "
    "completely untouched). Every one of these construction hairlines is far thinner than any other "
    "line in the image and reads as quiet underlying structure, not as a new shape."
)


def _p(body, grid=True, header=True):
    return (STYLE_HEADER if header else "") + body + (GRID if grid else "") + "\n\n" + APPENDIX


# ---------------------------------------------------------------- PLATES ---
# aspect/image_size: the generate.py call. style: "cover" (attach the chosen
# cover render as --style) or None (cover itself has no reference).
# mechanism: one line, for humans, of which SWISS-BRIEF section D geometry
# this plate abstracts. a/b: the two full prompts sent. chosen: "a" or "b",
# filled in once picked; rationale: five-ish words on why.

PLATES = {
    "cover": dict(
        aspect="2:3", image_size="4K", style=None,
        mechanism="the origin and the arcs — SWISS-BRIEF Composition A",
        a=_p(
            "Vertical 2:3 portrait book-cover composition, one continuous sheet of flat paper #FBF7EF "
            "from edge to edge with absolutely no border, frame, rectangle outline, or bounding line drawn "
            "anywhere on the sheet. The top 44% of the sheet is that same flat paper, completely bare and "
            "empty — reserved for typeset lettering added afterward; nothing at all may appear there. "
            "Beginning at a point on the left edge of the sheet, 44% of the way down from the top, five "
            "concentric quarter-ring bands of solid flat ink-blue #001489 sweep outward across the lower "
            "part of the sheet toward the lower right, drawn precisely as portions of perfect circles "
            "curving smoothly with no kinks, no straight segments, and no waviness anywhere along any arc. "
            "Reading outward from that point, the five band thicknesses are in the ratio 16:8:4:2:1, each "
            "band separated from the next by a thin gap of bare paper; the widest, outermost bands run off "
            "the right edge and the bottom edge of the sheet, as though the sheet were a window onto a "
            "larger pattern continuing beyond it — a large field breaking its own frame, one of the "
            "boldest single gestures in the whole book. Centered exactly on that starting point sits one "
            "small solid square of flat signal red #DA291C, no more than a fingernail's width across against "
            "the whole sheet — the smallest mark on the page set against the largest. Every arc is a "
            "true, smooth, perfectly circular curve; every other edge is perfectly straight. The composition "
            "is deliberately weighted to the lower right; the upper-left quadrant of the lower block stays "
            "the emptiest part of that block.",
            header=False,
        ),
        b=_p(
            "Vertical 2:3 portrait book-cover composition, one continuous sheet of flat paper #FBF7EF from "
            "edge to edge, no border, no frame, no outline anywhere. The top 44%, full width, is that same "
            "flat paper, entirely bare and empty, reserved for lettering added afterward — nothing may "
            "appear there. Starting at a single point on the left edge, 44% of the way down, five concentric "
            "quarter-ring bands of solid flat ink-blue #001489 sweep across the lower block toward the "
            "bottom right corner as true, mechanically perfect circular arcs — never a polygon "
            "approximation, never a facet, never a straight chord. From innermost to outermost the five "
            "band thicknesses double each time (ratio 1:2:4:8:16), each pair separated by a hairline gap of "
            "bare paper; the outer two bands are cut off by the right edge and the bottom edge of the sheet "
            "as if the pattern kept going past the page. At the exact origin point sits one small, isolated "
            "solid square of signal red #DA291C — the single smallest shape on the sheet, and the only "
            "warm color anywhere. Every other edge in the image is perfectly straight, horizontal or "
            "vertical. The whole lower block reads as one confident asymmetric gesture pulled hard toward "
            "the bottom right, leaving even the lower-left corner of that block comparatively open.",
            header=False,
        ),
        chosen="a", rationale="cleaner doubling, evener strikes",
    ),
    "part-I": dict(
        aspect="3:2", image_size="4K", style="cover",
        mechanism="a datum, and what rests on it",
        a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge. The top third of the frame is unbroken "
            "bare flat paper #FBF7EF, completely empty. The lower two-thirds is a single unbroken flat "
            "field of ink-blue #001489, meeting the paper along one hard straight horizontal seam. Within "
            "that blue field, one solid flat horizontal bar of near-black ink #121212 spans the full width, "
            "positioned at about 60% of the total frame height from the top — a datum every other mark "
            "in the field rests on. Resting on top of that bar, its lower edge exactly meeting the bar's "
            "upper edge and extending upward into the blue field, one solid flat square of paper #FBF7EF, "
            "roughly a third of the frame's width, positioned left of center: one large pale plane held up "
            "by the datum. Below the bar, five thin evenly spaced horizontal hairlines of paper #FBF7EF "
            "span the full width, reaching down toward the bottom edge — strata beneath the datum, each "
            "far thinner than the bar itself and none as thick as it. Nothing else appears anywhere in the "
            "frame; the whole composition sits low and left-weighted, the right two-thirds of the blue field "
            "below the bar left calm and empty but for the hairlines."
        ),
        b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge. The upper 34% of the frame is unbroken "
            "bare flat paper #FBF7EF. The rest of the frame is a single flat field of ink-blue #001489. "
            "One solid flat bar of near-black ink #121212, noticeably thick, spans the entire width at "
            "roughly 62% down the frame — the one immovable datum line in the image, thicker than "
            "anything else drawn. Sitting squarely on top of it, sharing its exact upper edge, one large "
            "solid flat square of paper #FBF7EF occupies roughly the left third of the width, rising well "
            "up into the blue field above the bar — a single large pale mass resting on the datum, in "
            "deliberate contrast with what lies beneath it. Below the datum bar, five short, very thin flat "
            "paper #FBF7EF hairlines run the full width at even intervals, getting no closer in thickness to "
            "the datum bar than a tenth of it — clearly subordinate strata. Nothing else is drawn; the "
            "right half of the frame below the datum stays open blue field."
        ),
        chosen="a", rationale="square rests flush, cleaner proportion",
    ),
    "part-II": dict(
        aspect="3:2", image_size="4K", style="cover",
        mechanism="resolution has a price, countable",
        a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of deep teal #006B5F. A 2-unit-tall bare paper #FBF7EF band spans the full width along "
            "the very top edge; the leftmost one-quarter of the frame, full height, is also unbroken bare "
            "paper #FBF7EF — both completely empty. The remaining right three-quarters of the frame "
            "below the top band holds a precise grid of identical square cells on one fixed module, large "
            "enough that individual cells are clearly countable up close. That grid is divided into exactly "
            "four equal vertical zones side by side, separated from one another by a single crisp near-black "
            "#121212 hairline running the full height of the grid at each of the three zone boundaries — "
            "so the eye can count exactly where each zone starts and stops. Reading left to right: zone one "
            "has only one cell in eight filled solid paper #FBF7EF, in a sparse regular pattern with the rest "
            "bare teal; zone two has one cell in four filled, twice as dense as zone one and visibly so; zone "
            "three has one cell in two filled in a strict checkerboard, twice as dense again; zone four is "
            "completely solid paper #FBF7EF, every single cell filled, a single unbroken pale block with no "
            "teal showing through at all. Each step must look like a distinct, countable rung of a ladder "
            "from across a room — four flat tones reading instantly as a halftone screen doubling in "
            "density from left to right, not a gradual fade. Nothing else appears."
        ),
        b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, ground a single flat field of deep teal "
            "#006B5F. A narrow bare paper #FBF7EF strip runs the full width along the top edge, and the "
            "leftmost quarter of the frame is entirely bare paper #FBF7EF, floor to ceiling — both "
            "empty. The remaining space is divided into four equal vertical bands by three crisp near-black "
            "#121212 hairlines, full height, so the four bands are unmistakably separate fields, not one "
            "continuous fade. Each band carries its own coarse, large-celled square lattice, all four "
            "lattices on the identical module and scale so only fill density differs: from left to right the "
            "fraction of solid paper #FBF7EF cells is exactly one eighth, one quarter, one half, and finally "
            "the whole band solid paper with no teal visible — each band roughly twice as pale as its "
            "neighbor to the left, a doubling series a viewer could count and state out loud, stepping "
            "cleanly rather than blending. Nothing else is drawn anywhere in the frame."
        ),
        chosen="a", rationale="four zones read at a glance",
    ),
    "part-III": dict(
        aspect="3:2", image_size="4K", style="cover",
        mechanism="one thing crosses the gap",
        # v1 (below, kept for the record) rendered the gap as fully empty in
        # both candidates on first generation -- the survivor bar the whole
        # mechanism depends on was missing. v2 names the sixteen context bars
        # as two explicit groups and the seventeenth as "the single most
        # important shape... omitting it is a critical error", which fixed it
        # in both v2 candidates; v2-a is what shipped (v2-b's paper bands did
        # not reach the frame edge, reading as a mounted card).
        a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of deep violet #582C83. Broad bare paper #FBF7EF bands run the full width along the top "
            "and bottom edges, each about a fifth of the frame's height, both completely empty. Across the "
            "middle band, draw sixteen identical narrow vertical bars of solid flat paper #FBF7EF, evenly "
            "spaced side by side, all the same height, arranged in two groups of eight: eight bars on the "
            "left side of the frame, then a gap, then eight more bars on the right side of the frame, with "
            "the gap itself roughly as wide as three of the bars put together. Inside that gap, exactly "
            "centered between the two groups and touching neither of them, stands one more single vertical "
            "bar — the seventeenth — identical in width, height, and solid paper-white color to all the "
            "others, standing completely alone, surrounded on its left and right by nothing but bare violet "
            "ground. This seventeenth bar is the entire point of the image: it must be rendered, clearly "
            "visible, the same brightness and height as every other bar, sitting by itself in the middle of "
            "the empty gap — omitting it is a critical error. Nothing else appears anywhere in the frame."
        ),
        b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of deep violet #582C83. Broad bare paper #FBF7EF bands run the full width along the top "
            "and bottom edges, each about a fifth of the frame's height, both completely empty. Across the "
            "middle band, draw sixteen identical narrow vertical bars of solid flat paper #FBF7EF, evenly "
            "spaced side by side, all the same height, arranged with ten bars grouped toward the left "
            "two-thirds of the frame, a wide bare-violet gap, then a single lone survivor bar positioned "
            "just left of center inside that gap, then more bare violet gap, then a final group of six bars "
            "toward the right edge. The lone survivor bar in the middle is drawn exactly like every other "
            "bar — same width, same height, same solid paper-white fill — and is the single most "
            "important shape in the image: it stands with generous bare violet space visible on both sides "
            "of it, clearly separated from both groups, unmistakably present, never merged into the "
            "surrounding violet and never omitted. Nothing else appears anywhere in the frame."
        ),
        v1_a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of deep violet #582C83. Broad bare paper #FBF7EF bands run the full width along the top "
            "and bottom edges, each about a fifth of the frame's height, both completely empty. Across the "
            "middle band, a row of seventeen identical narrow vertical bars of solid flat paper #FBF7EF "
            "stand evenly spaced side by side, all the same height, filling nearly the whole middle band. "
            "One wide vertical band of the same flat #582C83 ground cuts cleanly through the row right of "
            "center, completely erasing every bar it crosses — a hard gap, not a fade. Exactly one bar, "
            "and only one, survives inside that gap at full height and full paper brightness, positioned "
            "near the gap's right edge, conspicuously alone in the emptiness — one small, exact, "
            "unmistakable mark standing where sixteen others were erased. Nothing else appears."
        ),
        v1_b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, ground a single flat field of deep violet "
            "#582C83. Wide bare paper #FBF7EF bands, each roughly a fifth of the height, run the full width "
            "at the very top and very bottom, left entirely empty. In the band between them, seventeen equal, "
            "evenly spaced, tall narrow bars of solid flat paper #FBF7EF stand like a fence across the full "
            "width, all sharing the same height. A single wide flat #582C83 gap cuts vertically through the "
            "fence just right of the frame's center, wiping out every bar inside its width with hard, sharp "
            "edges. Precisely one bar continues through that gap at identical height and identical solid "
            "paper brightness, sitting near the gap's right side, isolated and unmistakable against the bare "
            "violet around it. No other marks appear anywhere."
        ),
        chosen="a", rationale="v2: only candidate with visible survivor",
    ),
    "part-IV": dict(
        aspect="3:2", image_size="4K", style="cover",
        mechanism="three parties, one book of record",
        # v1's three converging rules to a vanishing point read as a
        # perspective sketch, not Swiss (review note). v2 drops the
        # convergence entirely: three rectangles, one flat horizontal rail
        # crossing all three at the same height, no diagonals but the
        # standard construction-grid hairlines.
        a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of olive #666A00. A 3-unit-tall bare paper #FBF7EF band spans the full width along the "
            "very top edge, completely empty. Below it, draw exactly three solid rectangles of paper "
            "#FBF7EF — three shapes total, no more and no fewer — all equal in area but each a "
            "different proportion: one wide and short, one nearly square, one narrow and tall. The three "
            "sit apart from one another at different heights across the frame, never touching, weighted "
            "toward different corners so the arrangement reads as deliberately asymmetric rather than "
            "centered. One single solid horizontal bar of near-black ink #121212, noticeably thick, spans "
            "the entire width of the frame edge to edge at one fixed height, passing directly through all "
            "three rectangles at that same height and visibly crossing over each one — a single rail the "
            "three unequal shapes all cross at once. No diagonal lines of any kind connect the rectangles; "
            "no converging rules; no vanishing point; nothing radiates from a point. The only marks in the "
            "picture besides the three rectangles are that one flat horizontal bar and the construction "
            "hairlines described below. Nothing else appears."
        ),
        b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, ground a single flat field of olive "
            "#666A00. The top edge carries a bare paper #FBF7EF band, full width, completely empty. In the "
            "field below, three solid paper #FBF7EF rectangles of exactly equal area but visibly different "
            "proportion — one long and low, one squarish, one tall and narrow — sit scattered at "
            "unequal heights, deliberately off-balance, none touching another. One thick, flat, perfectly "
            "straight horizontal bar of near-black ink #121212 runs the full width of the frame at a single "
            "constant height and passes directly across all three rectangles at that same height, "
            "overlapping each of them once. This horizontal bar is the only line in the composition apart "
            "from the construction hairlines described below — there are no diagonal rules, no rules "
            "converging on a point, no perspective lines of any kind. Nothing else is drawn."
        ),
        v1_a=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, the entire ground a single unbroken flat "
            "field of olive #666A00. A 3-unit-tall bare paper #FBF7EF band spans the full width along the "
            "very top edge, completely empty. Below it, draw exactly three solid rectangles of paper "
            "#FBF7EF — three shapes total, no more and no fewer — all equal in area but each a "
            "different proportion: one wide and short, one nearly square, one narrow and tall. The three "
            "sit apart from one another at different heights across the frame, never touching, weighted "
            "toward different corners so the arrangement reads as deliberately asymmetric rather than "
            "centered. Three straight thin rules of near-black ink #121212 run from a point on each "
            "rectangle's edge and converge at exactly one shared point near the frame's center. One further "
            "straight rule of ink #121212, thicker than the other three, passes horizontally through that "
            "same convergence point and spans the entire width of the frame edge to edge — one ledger "
            "line running under three unequal parties. Nothing else appears."
        ),
        v1_b=_p(
            "Horizontal 3:2 composition, full bleed edge to edge, ground a single flat field of olive "
            "#666A00. The top edge carries a bare paper #FBF7EF band, full width, completely empty. In the "
            "field below, three solid paper #FBF7EF rectangles of exactly equal area but visibly different "
            "proportion — one long and low, one squarish, one tall and narrow — sit scattered at "
            "unequal heights, deliberately off-balance, none touching another. From a point on each "
            "rectangle's edge a thin straight near-black #121212 rule runs inward; all three rules meet at "
            "one exact shared point near center. A fourth rule, distinctly thicker than the other three, "
            "runs perfectly horizontal through that same point and spans the full width of the frame edge to "
            "edge. Nothing else is drawn."
        ),
        chosen="a", rationale="v2: one clean rail, no vanishing point",
    ),
    "chapter-swk": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="one heavy bar every form passes through",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; well over three-quarters of the "
            "frame stays bare paper. The subject sits inside a middle horizontal band about half the frame's "
            "height; leave generous bare paper strips above and below it, and a wide bare margin on the "
            "right. One heavy solid vertical bar of flat ink-blue #001489 stands near the left third of the "
            "frame, running the full height of that middle band — the single largest, most immovable "
            "mark in the image. To its right, several much smaller separate solid rectangles of the same "
            "flat #001489, of different widths and set at slightly different heights, are arranged in a "
            "loose horizontal row crossing toward the right edge — every single one of them is cut by "
            "the heavy vertical bar, so the bar visibly divides each into a left piece and a right piece, as "
            "though every form must pass through it with no exception. No outlines, no shading."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the great majority of the sheet "
            "left as bare open paper. Inside a modest middle band, one tall, thick, solid vertical bar of "
            "flat ink-blue #001489 stands well left of center, running the full height of that band, "
            "dwarfing everything else in the frame. A scattered handful of smaller flat #001489 rectangles "
            "of varying width sit at slightly different heights strung out toward the right side of the "
            "band; every one of them, without exception, is bisected by the tall bar, its left fragment and "
            "right fragment both visible on either side. No shape floats free of the bar. No outlines, no "
            "shading, no gradient."
        ),
        chosen="a", rationale="calmer grid, less cluttered pairing",
    ),
    "chapter-anchor": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="nested shapes strictly shrinking",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; the great majority of the frame is "
            "bare paper, weighted toward the right and bottom, left completely empty there. Toward the "
            "upper-left, draw exactly four solid rectangles, like four flat picture-frame mats stacked "
            "directly on top of one another, all sharing one common top-left corner point, each one strictly "
            "smaller than the one beneath it in both width and height — a staircase of four flat steps "
            "shrinking toward the shared corner, largest occupying real space, smallest a mere accent. Each "
            "rectangle is exactly one single flat, perfectly even, uniform color with completely sharp "
            "straight edges. From largest (outermost) to smallest (innermost) the four flat colors are: pale "
            "blue-violet #9CA1C8, medium blue #5F6AB0, deep blue #001489, and near-black ink #121212. No "
            "outlines, no shading, no gradient anywhere."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, most of the sheet left bare, "
            "especially the right half and the lower strip, kept completely empty. In the upper-left "
            "quadrant, four solid flat rectangles nest inside one another sharing a single top-left corner, "
            "each one a strict, visible step smaller than the last in both directions — a shrinking "
            "staircase where every step is a clearly countable notch narrower and shorter than the one before "
            "it. Colors from largest to smallest: pale blue-violet #9CA1C8, medium blue #5F6AB0, deep blue "
            "#001489, near-black ink #121212, each one flat and sharp-edged with no gradient or shading "
            "anywhere."
        ),
        chosen="b", rationale="a's grey mockup border missed edge-bleed",
    ),
    "chapter-sealed": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="a closed ring, one slot, red stops AT the inner face",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; the large majority of the frame is "
            "bare paper, especially a wide margin at top, bottom, and left, all kept completely empty. "
            "Toward the right of center, one solid flat rectangular ring drawn as a thick, even band of "
            "near-black ink #121212 is fully closed on all four sides except for exactly one narrow slot of "
            "bare paper cut cleanly through its right side — the ring's black ink is otherwise perfectly "
            "continuous and unbroken all the way around, with no other gap anywhere in it. Inside that closed "
            "ring, one smaller solid flat square of pale blue-violet #9CA1C8 sits centered. A single thin "
            "straight line of signal red #DA291C leaves that inner square, travels toward the slot, and "
            "terminates in a small flat red square exactly flush with the ring's inner boundary — the "
            "outer edge of that small red terminus touches the ring's inner edge precisely and stops there; "
            "the red never overlaps, crosses, covers, or extends past the black ring by even a hair, and the "
            "ring's black ink remains the unbroken outer boundary at every point except that one exact "
            "touching spot. If in doubt, render the red stopping a hair short of the ring rather than "
            "touching or crossing it. The red line and its terminus never appear inside the slot itself or "
            "beyond the ring's outer edge. No outlines beyond the ring itself, no shading, no gradient."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, most of the frame bare, with wide "
            "empty paper at the top, bottom and left. Right of center, a single closed rectangular ring, a "
            "thick even stroke of solid near-black ink #121212, runs unbroken around all four sides except "
            "for one clean rectangular notch of bare paper cut through its right edge — everywhere else "
            "the black ring is one continuous, unbroken line with no other interruption. Centered inside the "
            "ring sits one solid flat square of pale blue-violet #9CA1C8. From that square, a thin straight "
            "signal-red #DA291C line runs toward the notch and ends abruptly in a small solid red square "
            "whose far edge lands exactly on the ring's inner face and goes no further — picture the red "
            "as a plug capped flush against the inside of the black ring, never poking through it, never "
            "lying on top of it, never reaching the notch or the paper beyond. The black ring's continuity is "
            "never interrupted by the red at any point. No other marks, no shading, no gradient."
        ),
        chosen="a", rationale="red stops clean, not inside the slot",
    ),
    "chapter-ls": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="many small marks resolved by one circle",
        # v1's field squares were the chapter hue's 38% tint (#9CC2B8) --
        # too pale to print on uncoated stock (review note). v2 raises the
        # field to a >=40% tint (#5FA093) and inverts the mechanism inside
        # the circle: squares caught under the full-hue circle flip to
        # paper-white cutouts, so the circle still reads as a full-hue lens.
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; a broad band of bare paper, "
            "especially the bottom band and the outer edges, is left completely empty. Within a middle zone, "
            "forty or more small identical solid squares of medium teal #5FA093 — a strong, clearly "
            "visible, medium-dark tint, not a pale wash — are scattered in an irregular but grid-aligned "
            "pattern across that zone, none touching, none rotated, each one small against the field but "
            "unmistakably printed, dark enough to read clearly on the paper from across a room. Among them, "
            "one single large solid flat circle of full deep teal #006B5F, dramatically bigger than any of "
            "the small squares, sits over a cluster of them near the frame's center. Wherever a small "
            "square would fall directly inside the area covered by that large circle, it is rendered instead "
            "as a small solid paper-white #FBF7EF square sitting on top of the dark circle — the circle's "
            "own dark fill shows everywhere else inside it, but each square caught inside the circle flips to "
            "paper-white, as though the circle inverts every mark it gathers. Squares outside the circle stay "
            "solid #5FA093 on the paper ground exactly as described. No lines connect anything, no "
            "outlines, no shading."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the bottom third and the frame's "
            "outer margins left as unbroken bare paper. Scattered across the remaining middle field, forty or "
            "more small identical flat squares of medium teal #5FA093 — clearly dark and legible, well "
            "above a pale wash — sit on an invisible regular lattice, irregular in placement but never "
            "off-grid, never touching, never rotated. One large, solid, flat circle of full deep teal "
            "#006B5F, far larger than any single square, sits among the cluster near the center. Every "
            "small square that falls inside the footprint of that circle is rendered as solid paper-white "
            "#FBF7EF instead of teal, so the circle reads as a lens that turns the marks it gathers into "
            "bright cutouts against its own dark fill; every square outside the circle stays solid #5FA093 "
            "on the paper ground. No connecting lines, no outlines, no shading anywhere."
        ),
        v1_a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; a broad majority of the sheet, "
            "especially the bottom band and the outer edges, is bare paper left completely empty. Within a "
            "middle zone, forty or more small identical solid squares of pale teal #9CC2B8 are scattered in "
            "an irregular but grid-aligned pattern, none touching, none rotated, each one tiny against the "
            "field. Among them, one single large solid flat circle of deep teal #006B5F, dramatically bigger "
            "than any of the small squares — an order of magnitude larger, the one big mass against many "
            "small marks — overlaps and visually gathers a cluster of the small squares near the frame's "
            "center, as though it resolves the scattered marks into one legible whole. No lines connect "
            "anything, no outlines, no shading."
        ),
        v1_b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the bottom third and the frame's "
            "outer margins left as unbroken bare paper. Scattered across the remaining middle field, forty "
            "or more tiny identical flat squares of pale teal #9CC2B8 sit on an invisible regular lattice, "
            "irregular in placement but never off-grid, never touching, never rotated — many small marks "
            "with no evident order at a glance. One large, solid, flat circle of deep teal #006B5F, far "
            "larger than any single square, sits among the cluster near the center and visually gathers a "
            "knot of the small squares under it, one big legible form standing in for the scatter. No "
            "connecting lines, no outlines, no shading anywhere."
        ),
        chosen="b", rationale="v2: denser inverted cluster, hue >=40%",
    ),
    "chapter-stp": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="a broken arc continued at the same radius, unmistakably",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; the majority of the frame, "
            "especially top and bottom, is bare paper left completely empty. Within a middle band, a very "
            "faint hairline-thin near-black #121212 circle is drawn as pure construction geometry, its full "
            "circumference visible at low contrast against the paper, tracing one continuous, perfectly "
            "round path from the left portion of the band all the way across to the right. Along the left "
            "arc of that same construction circle, a solid flat arc band of pale violet #B9A0CE, exactly the "
            "same radius and centered on the same point as the faint circle, sweeps across the left portion "
            "of the band and stops abruptly, leaving a clean gap of bare paper with the faint construction "
            "circle still visible passing quietly through that gap. Immediately after the gap, on the exact "
            "continuation of that same faint circle — identical center, identical radius, identical arc "
            "thickness — a second solid flat arc band picks the path back up and continues it seamlessly "
            "rightward, but rendered in full solid, strongly saturated violet #582C83, dramatically darker "
            "and more intense than the first pale arc, an unmistakable jump in color weight even though the "
            "geometry never wavers, as though the identical path continues under a completely new identity. "
            "The two colored arcs never touch each other directly; only the faint construction circle passes "
            "unbroken through the gap between them, proving they are the same curve. No other marks, no "
            "shading, no gradient."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, most of the sheet bare paper, "
            "especially above and below the middle band. A single perfectly round arc path runs across that "
            "band; drawn very faintly as a hairline near-black #121212 construction circle for its whole "
            "length so the underlying geometry is always legible. Over the left half of that path, a thick "
            "solid arc band of pale, washed-out violet #B9A0CE follows it exactly, then stops hard, opening a "
            "clear gap of bare paper where only the faint construction hairline continues. On the right half "
            "of the identical path — same center point, same radius, same band thickness, verified by "
            "the unbroken faint circle running straight through the gap — a second, unmistakably darker "
            "and fully saturated arc band of violet #582C83 resumes and completes the curve to the frame's "
            "right edge. The jump from pale to intense violet across the gap must read instantly, while the "
            "faint hairline circle makes plain it is one single unbroken path underneath. Nothing else "
            "appears."
        ),
        chosen="a", rationale="one circle continues; b drew two",
    ),
    "chapter-he": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="three bars on one base",
        # v1's fan of three angled, converging bars read as a logo fragment,
        # not Swiss (review note). v2 replaces the fan with three square-
        # cornered flat columns on one baseline, stepping up in height, and
        # one thin red rule at the tallest column's height -- "the price the
        # last unit clears at" -- with custom tints (100/60/35%) mixed for
        # this composition specifically (not the book's 100/62/38 ladder).
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; well over three-quarters of the "
            "frame, especially top and left, is bare paper left completely empty. Three solid flat "
            "rectangles stand side by side on one common baseline near the bottom of the frame, all the "
            "same width, each with sharp square corners and completely flat fill — no diagonal edge, no "
            "angled top, every edge purely horizontal or vertical. Reading left to right the three step up "
            "in height, each one taller than the last, like three ascending bar-chart columns: the "
            "shortest, leftmost column is solid flat #C7C69B; the middle column, taller, is solid flat "
            "#A2A260; the tallest, rightmost column is solid flat #666A00, the densest and darkest of the "
            "three. The columns never touch each other — a narrow gap of bare paper separates each pair. "
            "One thin, perfectly straight horizontal rule of signal red #DA291C spans the entire width of "
            "the frame edge to edge, at the exact height of the top of the tallest (rightmost) column — "
            "the red line grazes only the top of that one tall column and passes as bare paper above the "
            "shorter two. There are no diagonal lines, no fan of angled bars, no lines converging on a "
            "point anywhere in the picture. Nothing else appears."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the frame left mostly bare, "
            "especially the top half and the left third. Near the bottom, three solid flat rectangular "
            "columns of equal width sit on one shared baseline, separated by small bare-paper gaps, every "
            "edge strictly horizontal or vertical, no diagonals anywhere on any column. The columns "
            "increase in height from left to right in three clear steps: #C7C69B for the shortest on the "
            "left, #A2A260 for the middle column, and full solid #666A00 for the tallest column on the "
            "right. A single thin dead-straight signal red #DA291C rule crosses the entire width of the "
            "frame at the height of the tallest column's top edge, floating clear above the two shorter "
            "columns. No other lines, no fan, no rays, no vanishing point, no diagonal of any kind. "
            "Nothing else is drawn."
        ),
        v1_a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; well over three-quarters of the "
            "frame, especially top, bottom, and left, is bare paper left completely empty. In the remaining "
            "space, draw three separate solid flat rectangular bars, spaced well apart with clear bare paper "
            "gaps between them so they never overlap and never touch each other directly, each bar tilted at "
            "its own distinct angle, like three fingers of an open hand splayed apart. Each bar's lower end "
            "touches one single shared point near the bottom of the frame, so the three bars fan outward and "
            "upward from that one common base point; the bars must not cross or overlap one another anywhere. "
            "The three bars are flat solid olive in three distinct opaque values: full olive #666A00, medium "
            "olive #9FA05B, and pale olive #C2C194. One thin straight rule of near-black ink #121212 spans "
            "the entire width of the frame horizontally, passing exactly through that shared base point. No "
            "outlines, no shading, no transparency, no overlap."
        ),
        v1_b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the frame left mostly bare, "
            "especially along the top and the left side. Three flat, solid, non-overlapping rectangular bars "
            "fan upward from one shared point near the bottom of the frame like splayed fingers, each at a "
            "different angle, each with clear bare paper between it and its neighbors. Their flat opaque "
            "colors, one each, are full olive #666A00, medium olive #9FA05B, and pale olive #C2C194. A single "
            "thin near-black #121212 rule crosses the entire frame horizontally, passing exactly through the "
            "shared base point where the three bars meet. No shading, no transparency, no overlap between "
            "bars anywhere."
        ),
        chosen="a", rationale="v2: single red rule, not doubled",
    ),
    "chapter-bonded": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="a square held at three points",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; the large majority of the frame, "
            "especially the right margin, top, and bottom, is bare paper left completely empty. Left of "
            "center, one solid flat square of medium olive #9FA05B is held in place by three short straight "
            "rules of near-black ink #121212, each rule touching a different point on the square's edge — "
            "one on the top, one on the lower left, one on the lower right — and each rule ending in "
            "empty paper rather than connecting to anything else, as though three separate anchors hold the "
            "square without enclosing it. Well to the right, isolated in open paper with clear bare paper on "
            "every side — not touching or overlapping the edge — one small solid square of signal "
            "red #DA291C sits entirely alone, touching nothing else, the smallest and only warm mark on the "
            "sheet. No outlines, no shading."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, the majority of the sheet bare "
            "paper, particularly a wide empty stretch on the right. A solid flat square of medium olive "
            "#9FA05B sits left of center, held by three short near-black #121212 rules that each touch one "
            "point on its edge — top, lower left, lower right — and end in open paper without joining "
            "anything else, three separate anchors that never enclose the square. Far to the right, fully "
            "surrounded by bare paper and touching nothing, one small isolated solid square of signal red "
            "#DA291C sits alone — the single smallest and only warm shape in the frame. No outlines, no "
            "shading anywhere."
        ),
        chosen="a", rationale="upright square, not a rotated diamond",
    ),
    "chapter-fh": dict(
        aspect="16:9", image_size="2K", style="cover",
        mechanism="separate blocks joined by thin lines",
        a=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF; a wide bare paper band runs the "
            "full width along the top edge, completely empty. Below it, two separate solid flat square blocks "
            "sit apart from each other, left and right, with a wide clean gap of bare paper between them: the "
            "left block filled with a small identical grid lattice of tiny solid medium-olive #9FA05B "
            "squares, the right block filled with an identical lattice of tiny solid pale-olive #C2C194 "
            "squares, the right lattice visibly offset by half a step relative to the left one so the two are "
            "clearly not on the same grid. The two blocks touch nothing between them except three separate "
            "thin straight rules of near-black ink #121212 that cross the gap horizontally, each rule "
            "stopping the instant it reaches the first small square inside the opposite block. No outlines, "
            "no shading, no other connection between the blocks."
        ),
        b=_p(
            "Horizontal 16:9 landscape composition on flat paper #FBF7EF, a bare paper strip running the full "
            "width along the top, left completely empty. Two equal square fields of tiny flat lattice squares "
            "sit left and right with a wide bare paper gutter between them: the left lattice in solid "
            "medium-olive #9FA05B, the right in solid pale-olive #C2C194, the right one shifted half a module "
            "so the two grids are visibly out of step with each other. Three thin near-black #121212 rules "
            "cross the gutter horizontally, each one entering the far field and stopping dead the instant it "
            "meets the first small square there, never crossing further. No outlines, no shading, nothing "
            "else joins the two blocks."
        ),
        chosen="a", rationale="clean gutter; b's blocks touched",
    ),
}

# Final aspect ratio (post-crop) and long-edge target for each plate, in the
# same order plates_pipeline.py's fit() wants them: (ratio w/h, long_edge_px).
FINAL = {
    "cover": (2 / 3, 3400),
    "part-I": (1.5, 3400), "part-II": (1.5, 3400), "part-III": (1.5, 3400), "part-IV": (1.5, 3400),
    "chapter-swk": (2.0, 3400), "chapter-anchor": (2.0, 3400), "chapter-sealed": (2.0, 3400),
    "chapter-ls": (2.0, 3400), "chapter-stp": (2.0, 3400), "chapter-he": (2.0, 3400),
    "chapter-bonded": (2.0, 3400), "chapter-fh": (2.0, 3400),
}

if __name__ == "__main__":
    for k, v in PLATES.items():
        print(k, v["aspect"], v["image_size"], "chosen=" + v.get("chosen", "?"))
