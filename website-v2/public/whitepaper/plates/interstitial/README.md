# Reflective Swiss plates

Wordless interstitial illustrations commissioned by the author, 19 September 2026.
These are reflective art, not photographs documenting a real scene or figures
that establish a technical result. Their prompts and source hashes are in
`PROVENANCE.json`. The waiting diver is a new rendering of a remembered motif;
the earlier illustration was not recovered.

| Plate | Facing idea |
| --- | --- |
| `the-unseen-boat` | A clean summary can leave the important thing unseen. |
| `the-waiting-body` | A body can be replaced; continuity needs something that survives it. |
| `the-paper-crossing` | An obligation or permission must cross independent authorities. |
| `the-controlled-opening` | A confinement claim must account for the information its output releases. |

The visual references are the Swiss chapter plates, especially the eye-shaped
marina: halftone objects, cream paper, one large geometric ink field, sparse
registration lines, and a physically impossible but recognizable scene.

## Placement

`figures/pd-reflection-plates.tex` provides `\pdreflectionplate{key}` in the Book.
It emits art only in the Swiss edition, inside a six-by-nine-inch frame.
The original three plates remain wordless. Registered text-bearing plates use
an opaque lower field with selectable white text, never patterned artwork behind
body copy. All registered plates also appear in the contents. Technical
figures retain their ordinary margin captions.

Call it **only at a selected paragraph/section boundary**, outside a proof,
worked example, list or float. It flushes the preceding page and pending floats;
review that preceding page for stranded text. It does not insert empty parity
leaves or use a timed page callback that can bisect prose. A verso plate faces
the following recto; a recto plate faces the preceding verso. Inspect the actual
pair after every substantial reflow. Do not infer semantic adjacency from the
source call alone.

## Proof, not print master

The originals are 1024 by 1536 pixels (about 171 ppi at the current size), with
no resampling or crop. A higher native-resolution generation is required for a
300-ppi print master. Increasing a metadata DPI value would not solve that.

`render_book_reflection_review.py BOOK.pdf OUTPUT_DIR` reads the matching aux,
checks unique records, physical parity, clean art pages and bounded images,
and creates a six-page excerpt plus three rendered facing spreads. Check the
facing prose and surrounding pages yourself; these geometry checks do not
establish artistic quality or reading continuity.
