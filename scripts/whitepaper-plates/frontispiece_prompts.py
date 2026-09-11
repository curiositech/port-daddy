"""Frontispiece prompts, one per edition, from the Leviathan brief.

The maritime plate already in the book gets seventy percent of the brief right
-- pillars, cartouche, the brass helmet with its cyclopean lens, a clockwork
torso, the scroll, the harbour, the emblematic side registers. Six things are
missing, and every prompt below is written to close them:

  1. The lens emits nothing. The Searchlight of Legibility is the whole
     argument of the head and it is inert.
  2. The scroll is blank. It is the Float Plan: hashes, receipts, ledgers,
     cascading into the quays.
  3. There is no subterranean cutaway. Merkle roots as tree roots twined
     through planetary gearing is the book's foundations, and it is absent.
  4. The sceptre is a plain staff, not an armillary sphere over a key cage.
  5. The colossus stands IN the water at the scale of a bather. Hobbes's
     sovereign rises OVER its city.
  6. Blank banner and blank lower register read as unfinished artwork rather
     than as cartouches awaiting type.

Blank cartouches are kept deliberately -- the Book sets its own type into them
-- but they are drawn as ornamented empty panels, not as white gaps.
"""

NEGATIVE = ("Do not render any lettering, words, numerals or typography anywhere. "
            "Avoid photographic realism, 3D rendering, CGI, glossy plastic surfaces, "
            "neon glow, anime, smooth digital painting, and oversaturated colour.")

MARITIME = """A masterwork frontispiece engraving for a philosophical treatise on autonomous
machine intelligence, in the exact manner of the 1651 Hobbes Leviathan frontispiece and
Durer intaglio copperplate work. Vertical composition framed by two massive classical
stone pilasters with Corinthian capitals at the left and right borders, an ornamented
empty ribbon cartouche across the top and a second empty panel across the foot.

Rising BEHIND and TOWERING OVER a fortified maritime harbour city, filling the upper two
thirds of the plate, a colossal mechanical sovereign seen from the thighs up. Its torso
and arms are composed of hundreds of thousands of interlocking brass clockwork automata,
escapements, gear trains, miniature vacuum tubes and fine filigree circuit traces. Its
head is an antique riveted brass diving helmet with one great circular ocular lens, and
from that lens a hard-edged CONE OF VOLUMETRIC SEARCHLIGHT drives down and across the
harbour below, its rays drawn as ruled engraved lines cutting through atmospheric haze.

In its right hand it holds aloft a sceptre crowned with an armillary sphere caging a
geometric key, throwing sharp radiant spires. In its left it holds an unfurling parchment
scroll densely covered in minute cryptographic hashes, tabulated ledgers and receipt
stubs, cascading down out of its hand and into the stone quays below.

Beneath, a seventeenth-century harbour: stone breakwaters, masted galleons at their
moorings, a lighthouse, classical domes, and among them monolithic slab towers and radio
masts. Below the waterline the plate opens into a SUBTERRANEAN CUTAWAY: a cross-section
of earth where branching tree roots interweave with vast planetary gear trains and
brass escapement wheels, the root branchings drawn as binary tree diagrams, a fissure of
molten light descending into a clockwork core.

Flanking emblematic panels down the left and right margins hold small engraved devices:
an open ledger, a lighthouse, an anchor, a vault door, a balance, a compass rose, a
strongbox, a fleet under sail, a gear cluster, an arched bridge.

Monochromatic sepia ink on aged textured antique vellum, dense hand-etched cross-hatching,
fine stippling, plate indentation at the border, museum-grade burin engraving, extremely
high line density, razor-sharp. """ + NEGATIVE

SWISS = """A frontispiece for a treatise on autonomous machine intelligence, executed as
International Typographic Style / Swiss modern poster art in the manner of Josef
Muller-Brockmann: hard-edged flat colour blocking, strict mathematical grid, no outlines,
no gradients, no texture, square corners, absolutely flat vector shapes.

The Leviathan of the classical frontispiece is rebuilt entirely from geometry. A colossal
standing figure occupies the vertical centre, its body a stacked column of flat rectangles
and circles in deep cobalt blue, each block a plain silhouette of a gear, a queue, a
ledger row -- machine parts abstracted to pure shape. Its head is a single flat circle in
cream carrying one smaller solid circle: the lens. From that lens a hard-edged WEDGE of
flat pale yellow opens downward across the lower third of the composition, a beam
rendered as one clean triangle with no falloff.

The right arm is a vertical bar topped by a flat concentric-ring disc, the armillary
reduced to three circles. The left arm holds a long flat rectangle running off the bottom
edge, banded in horizontal stripes of teal and cream: the ledger.

Below, the harbour is a horizon of flat rectangles in teal and deep green of graduated
height, with three flat triangles for sails and one tall thin bar for the lighthouse.
Beneath a hard horizontal rule, the substructure is a row of flat circles of decreasing
radius interlocked with a branching two-colour tree diagram in olive.

An empty rectangular panel across the top and another across the foot, both plain flat
cream fields with no ornament. Palette strictly limited to deep cobalt blue, teal, olive
green, warm cream ground, and one signal red square placed at the figure's heart.
Poster art, flat colour separation, extremely clean. """ + NEGATIVE

TECHNICAL = """A frontispiece for a treatise on autonomous machine intelligence, drawn as a
1970s engineering drawing sheet in the manner of Bell System technical manuals and NASA
assembly diagrams. The whole plate is a drafting sheet: a ruled rectangular border frame
with inch tick marks along every edge, a faint quarter-inch grid across the field, and an
empty ruled title block in the lower right corner divided into blank cells.

The subject is drawn as a monoline orthographic assembly elevation: a colossal humanoid
machine, centred, rendered in uniform thin ink line with NO shading except 45-degree
diagonal hatching and halftone dot fields to distinguish regions. Its torso is an exploded
mechanical assembly of gear trains, escapements and card cages, each subassembly bounded
by a thin leader line running to a small numbered circular callout balloon -- the balloons
are drawn empty, plain circles with no numerals inside.

Its head is a spherical housing with one circular aperture; from that aperture a
projection cone is drawn as two straight ruled lines opening downward with an arc closing
the far end, the enclosed region filled with a sparse halftone dot screen: an optical
projection diagram, not an illustration of light.

The right arm holds a shaft topped with a wireframe armillary of three intersecting
circles drawn in true isometric. The left arm holds a long banded strip descending off
the sheet, its bands drawn as a repeating register of empty rectangles: a tape.

The lower third is a sectional elevation: a harbour in thin-line profile with quays,
hulls and a mast tower, and beneath a section-cut ground line hatched at 45 degrees, a
cutaway of planetary gearing meshed with a branching binary tree diagram.

Ink line on warm off-white drafting stock, burnt orange and ochre used only for the
frame rules and callout leaders, olive for the section hatching. Flat, precise, technical.
""" + NEGATIVE

PLATES = {'frontispiece-maritime': MARITIME, 'frontispiece-swiss': SWISS,
          'frontispiece-technical': TECHNICAL}
