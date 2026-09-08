# Swiss Edition — Art Direction Brief
**Book:** *The Harbor, the Person, and the Economy* — A textbook of accountable autonomous work
**Author:** Erich Owens · **Imprint:** Curiositech · **Trim:** 7 × 10 in (177.8 × 254 mm), portrait
**Deliverables:** 1 cover (3 variants), 4 part-opener plates, 8 chapter plates, plus a figure-language change for the book's TikZ.
**Constraint that governs everything below:** the image model renders **no type**. Every plate is generated with a deliberate empty region; all letters, numerals and rules-with-type are set afterwards in LaTeX.

---

## 0. What "Swiss modern" actually is, in craft terms

Read this before the rules; it is what the rules are for.

The International Typographic Style is not a look, it is a **method that makes its own reasoning visible**. Ernst Keller taught at the Kunstgewerbeschule Zürich from 1918 to 1956 that *the content determines the form* and refused to teach a house style at all — the Triest Verlag monograph on him is literally titled *No Style* ([Design Reviewed](https://designreviewed.com/designer/ernst-keller/), [Triest Verlag, 2017](https://designreviewed.com/artefacts/no-style-ernst-keller-1891-1968-teacher-and-pioneer-of-the-swiss-style-triest-verlag-2017/)). Everything downstream — the grid, the grotesk, the flat inks — is machinery for getting a specific argument onto a specific sheet without decoration. When the machinery is copied without an argument, you get the "Swiss template," which is the failure mode this brief is written to avoid.

### The canon, and the one move each contributes

| Figure | Named works | The one move a prompt must name |
|---|---|---|
| **Ernst Keller** | Zürich Kunstgewerbemuseum exhibition posters; Rietberg Museum mark; his teaching programme, 1918–56 | *Sign, not picture:* reduce the subject to a single constructed mark whose form is derived from the subject's own structure, then place it with maximum control of surrounding space. |
| **Josef Müller-Brockmann** | *Beethoven* (Zürich Tonhalle, 1955); the *Musica Viva* series (1957–72, 70+ posters); *Grid Systems in Graphic Design* (1981) | *Arithmetic arcs:* concentric arcs or circles struck from one point, with radii and band-widths in an explicit numeric series. In the Beethoven poster the arcs advance around the centre on an **11.25° module** and their widths **double: 1, 2, 4, 8, 16** ([Elam's geometric analysis](https://www.behance.net/gallery/9862277/Mueller-Brockmanns-Beethoven-Poster-Geometric-Analysis)). |
| **Armin Hofmann** | *Giselle*, Basler Freilichtspiele (1959); Stadttheater Basel and Kunsthalle Basel posters, late 1950s–60s; *Graphic Design Manual: Principles and Practice* (Niggli, 1965) | *Point, line, plane in contrast:* one photographic or tonal element reduced to a high-contrast silhouette, cropped so it becomes a graphic sign rather than a depiction, set against a plain plane ([Poster House](https://posterhouse.org/blog/armin-hofmann-1920-2020/), [Niggli](https://niggli.ch/en/products/methodik-der-form-und-bildgestaltung)). |
| **Emil Ruder** | *Typographie: A Manual of Design* (Niggli, 1967); Basel Kunstgewerbeschule curriculum; Univers-set specimen work | *Type as texture:* the block of text is a grey field with a measurable value; form and **counter-form** (the white) are designed together; rhythm comes from contrast of grey values, not from ornament ([Typotheque](https://www.typotheque.com/books/typography-a-manual-of-design), [full text](https://archive.org/details/typographie-a-manual-of-design-emil-ruder)). |
| **Max Bill** | *Quinze variations sur un même thème* (1935–38); Ulm HfG (founding rector, 1953); "die mathematische denkweise" (1949) | *Serial transformation:* one generative rule applied N times produces the whole set; here a triangle grows side-by-side into square, pentagon, hexagon, heptagon, octagon along a spiral ([Mercedes-Benz Art Collection](https://art.daimler.com/en/artwork/quinze-variations-sur-un-meme-theme-15-variations-on-one-theme-max-bill-1935-38-2/), [MoMA](https://www.moma.org/collection/works/7678)). |
| **Richard Paul Lohse** | *Fifteen Systematic Colour Rows with Vertical Condensations* (1950–68); *Fifteen Systematic Colour Series*; *Neue Grafik* co-editor | *Colour as a counted sequence:* hues are ordered in a predetermined cycle of 15, 18 or 30 steps, each occupying an equal module; the composition is the ordering, not a judgement of taste ([MoMA](https://www.moma.org/collection/works/80503), [Hauser & Wirth](https://www.hauserwirth.com/hauser-wirth-exhibitions/richard-paul-lohse/), [Haus Konstruktiv](https://www.hauskonstruktiv.ch/en/exhibitions/richard-paul-lohse?tab=1)). |
| **Karl Gerstner** | *Designing Programmes* (Niggli, 1964); *Die Formen der Farben / The Forms of Color* (1986); Boîte à musique and capital-market work for Gerstner+Kutter | *Programme, not solution:* define a parameter set (the morphological box, after Zwicky) and let the artefact be one legal cell of it; colour is generated by laying geometry onto a colour solid ([PDF](https://openlab.citytech.cuny.edu/langecomd3504sp2020/files/2018/10/Gerstner_DesigningProgrammes-1.pdf), [MIT Press](https://mitpress.mit.edu/9780262570817/forms-of-color/)). |
| **Wim Crouwel** | *Vormgevers*, Stedelijk (1968); *New Alphabet* (1967); Stedelijk catalogue system, 1964–85; Total Design | *Show the grid:* print the construction lattice itself and build the forms out of its cells, so the substrate is the image ([MoMA](https://www.moma.org/collection/works/139322), [Stedelijk](https://www.stedelijk.nl/en/news/wim-crouwel-1928-2019-2)). |
| **Massimo Vignelli** | NYC Subway diagram (Unimark, with Bob Noorda and Joan Charysyn, 1970–72); NYCTA *Graphics Standards Manual* (1970); Knoll identity; *The Vignelli Canon* | *Angular discipline:* every line bends only at **45° or 90°**; topology beats geography; one grotesk, a handful of sizes, a closed colour set ([MoMA](https://www.moma.org/collection/works/89300), [NY Transit Museum](https://www.nytransitmuseum.org/vignelli/), [Canon PDF](https://www.rit.edu/vignellicenter/sites/rit.edu.vignellicenter/files/documents/The%20Vignelli%20Canon.pdf)). |
| **Otl Aicher** | Munich 1972 pictograms and *Richtlinien und Normen für die visuelle Gestaltung*; Braun and Lufthansa identities; Ulm HfG | *Constrained construction:* every figure built from segments on a lattice of horizontals, verticals and 45° diagonals, no freehand, no rotation off those axes — a system, not drawings ([Smithsonian](https://www.smithsonianmag.com/innovation/this-graphic-artists-olympic-pictograms-changed-urban-design-forever-180978256/), [manual in Fonts In Use](https://fontsinuse.com/uses/38873/organisationskomitee-fuer-die-spiele-der-xx-o), [Olympic-Museum](https://www.olympic-museum.de/pictograms/olympic-games-pictograms-1972.php)). |
| **Siegfried Odermatt & Rosmarie Tissi** | Odermatt's *Union Safe Company* newspaper campaign; Tissi's Zürich culture posters; the studio 1968– | *Break one rule on purpose:* keep the reduction and the flat ink, then jam, overlap or crop the form until legibility is deliberately strained — Swiss rigour with a played card ([Design Reviewed](https://designreviewed.com/designer/odermatt-tissi/), [Wikipedia](https://en.wikipedia.org/wiki/Rosmarie_Tissi)). |

### The grammar

**The grid, and making it visible.** Müller-Brockmann's *Grid Systems* works its examples through **8-, 20- and 32-field** modular grids: margins define a type area, the type area is divided into columns *and* rows by consistent gutters, and every element — text, image, caption — starts and ends on a field boundary ([book PDF](https://ia803105.us.archive.org/29/items/GridSystemsInGraphicDesignJosefMullerBrockmann/Grid%20systems%20in%20graphic%20design%20-%20Josef%20Muller-Brockmann.pdf)). He is explicit that "the grid system is an aid, not a guarantee." Asymmetry is what makes the grid legible: a symmetrical layout hides its structure, an off-centre one exposes the module you are counting in. Crouwel's *Vormgevers* takes the last step and prints the lattice ([Stedelijk](https://www.stedelijk.nl/en/news/wim-crouwel-1928-2019-2)).

**The mathematics of the composition.** Bill: one rule, iterated, generates the set. Lohse: colours advance through a counted cycle across equal modules. Müller-Brockmann: arcs on an 11.25° module with doubling widths. The rule is that **a viewer could reconstruct the numbers**. If you cannot state the series out loud, the image is decoration.

**Typography as image.** One grotesk — Akzidenz-Grotesk was the workhorse before Helvetica and remained the preferred face of the Zürich school ([Wikipedia](https://en.wikipedia.org/wiki/Akzidenz-Grotesk)). Flush-left, ragged-right, never justified, never centred. **Two or three sizes only** in a single artefact; Vignelli's exhibition made the point by doing an entire body of print with four typefaces total ([Fonts In Use](https://fontsinuse.com/uses/14164/massimo-vignelli-s-a-few-basic-typefaces)). Type sits *on* the grid: baselines land on row lines, the ragged edge is the only irregular contour on the page. Rotation, when used, is 90° exactly, never a jaunty angle.

**The photographic strand.** Hofmann's *Giselle* is a photograph pushed to near-pure black and white and cropped through the head and foot so the dancer "becomes a graphic symbol of movement rather than a three-dimensional image" ([Poster House](https://posterhouse.org/blog/armin-hofmann-1920-2020/), [Cooper Hewitt](https://www.cooperhewitt.org/2018/08/05/aharmonyofcontrasts/)). The vocabulary is **photogram, high-contrast halftone, silhouette cut-out, coarse screen** — the photograph is a tonal *plane*, one of Hofmann's three elements, not a window.

**Colour.** One or two flat spot inks plus black and the paper. Colour is chosen for its behaviour as *ink on a sheet*, not as light: it has a value, and the value must sit in a legible relation to black and paper. Red appears when a single element must carry all the urgency of the piece and nothing else may compete. The Lohse spectrum appears when the subject *is* a series — then you may use many hues, but only as a counted progression across equal modules. Primary jewel tones read cheap when they are (a) at maximum saturation *and* maximum area, (b) more than two of them, (c) sitting on pure white rather than paper. The fix is: knock the ground off pure white to an uncoated paper value; give the colour a large calm area or a small violent one but not both; and let black do the structural work.

**Scale and white space.** Swiss posters were printed at **Weltformat, 128 × 90.5 cm**, a format standard in Switzerland since 1914 ([Galerie 123](https://www.galerie123.com/en/poster-history/swiss-size-weltformat-format-mondial/)) — the compositions assume you can see them from across a street *and* read the programme up close, hence the size contrast. The working rule of thumb: the largest and smallest type on a piece stand at roughly **5:1**, and the **largest single empty area is about five times the largest printed element**. Emptiness is not leftover; it is a pressurised field that pushes the marks into position. If you can add an element without disturbing anything, the composition is not finished — it is underconstrained.

### Book covers specifically

The Zürich school's own publishing organ, **Neue Grafik / New Graphic Design / Graphisme actuel** (1958–65, 18 issues, edited by Müller-Brockmann, Neuburg, Lohse and Vivarelli), set the type of the artefact we are making: trilingual columns on a strict field grid, a wordmark locked to the grid, and a cover that is the grid ([Wikipedia](https://en.wikipedia.org/wiki/Neue_Grafik), [Lars Müller reprint](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965)). **Arthur Niggli Verlag** published the school's textbooks — Ruder's *Typographie* (1967), Hofmann's *Graphic Design Manual* (1965), Gerstner's *Designing Programmes* (1964) — and their covers established the textbook idiom: a title in one grotesk, flush left, in a reserved band; a single constructed image occupying a defined block; publisher's mark small and on the grid.

The critical precedent for a **long title on a series cover** is Romek Marber's 1961 Penguin Crime grid: the image occupies just over **two-thirds** of the cover; the top third is divided into thin horizontal bands carrying, in order, colophon/series/price, title, and author, all ranged left; proportions derived from the golden section; colour reduced to one green plus black on white ([Romek Marber](https://romekmarber.com/portfolio/penguin-grid/), [Eye](https://www.eyemagazine.com/feature/article/penguin-crime-text-in-full)).

**What that means for our title.** "The Harbor, the Person, and the Economy" is a three-part title with two commas and a conjunction — it *wants* to break into three lines. Do not fight this: set it flush left in three lines, one noun phrase per line, the commas doing the work of the line breaks, at one size. The subtitle drops two steps (not one) and goes below, in the same face, with more leading than the title. The author sits at the foot of the type band; the imprint sits at the very foot of the cover, small, on the same left datum. Total: **three type sizes**, one face, one left edge for everything. That is the whole cover typography.

### Contemporary practice, and the pastiche line

- **Wolfgang Weingart** is the rupture point: trained in Stuttgart letterpress, at the Basel school from 1968, he spent four decades systematically breaking the grid he was taught — letterspaced heads, overprinting, broken grids, deliberate illegibility, published as the "TM Communication" supplements in *Typografische Monatsblätter* from 1972 ([Wikipedia](https://en.wikipedia.org/wiki/Wolfgang_Weingart)). Everything after him is post-rupture and knows it.
- **Lars Müller Publishers** — the discipline is that the book's physical design *argues the same thing the content argues*; format, paper and binding are content decisions ([Lars Müller](https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965)).
- **Norm** (Dimitri Bruni, Manuel Krebs, Ludovic Varone, Zürich) — reduction, proportion and modularity carried to the point of being a *theory* published as books (*Introduction*, *The Things*, *Dimension of Two*); the grid is the subject, not the tool ([Wikipedia](https://en.wikipedia.org/wiki/Norm_(graphic_design_group)), [Eye](https://eyemagazine.com/feature/article/buying-into-the-norm-cosmos)).
- **Experimental Jetset** (Amsterdam) — late-modernist vocabulary used as a *native language*, not a costume; Marieke Stolk on Helvetica: "We actually hate Helvetica" — it is a tone of voice, not a tribute ([Designboom](https://www.designboom.com/design/experimental-jetset-interview/), [Helveticanism](https://www.jetset.nl/archive/helveticanism)).
- **Felix Pfäffli / Studio Feixen** (Lucerne) — 100+ Südpol posters, 2010–15; refuses a signature style and re-derives the system per subject ([Studio Feixen](https://www.studiofeixen.ch/sudpol/), [AGI](https://a-g-i.org/design/s%C3%BCdpol-plakate-1)).
- **Cornel Windlin / Lineto** (Zürich) — "minimalist typography based on the use of just a few sizes of a single font style and powerfully reduced colour range" ([Swiss Federal Design Awards](http://www.swissdesignawards.ch/designprize/2011/cornel-windlin/index.html?lang=en), [Lineto](https://lineto.com/information/designers/lineto-designers/cornel-windlin)).
- **Bureau Mirko Borsche** (Munich) — concept-driven, precise typographic craft that changes register per client rather than applying one ([It's Nice That](https://www.itsnicethat.com/articles/mirko-borsche-design-museum)).

**Dignified vs. template.** Dignified work: the geometry is derived from the *subject*, and you can say out loud which number generates it; the artefact commits to one idea and lets the empty area carry the risk; the colour has a print reference, not a screen one. Template work: Helvetica Bold on a red rectangle; a circle because circles are Swiss; three sizes chosen by eye; "minimalist" as the whole intent. **The test:** delete the geometry and ask whether the remaining sheet would still be about *this book*. If yes, the geometry was decoration.

---

## A. Ten rules, one line each

1. **Content determines form; there is no house style to apply.** — Ernst Keller's teaching, 1918–56; the monograph is titled *No Style* ([Design Reviewed](https://designreviewed.com/designer/ernst-keller/)).
2. **Everything sits on a modular field grid — columns *and* rows, consistent gutters, inside declared margins.** — Müller-Brockmann, *Grid Systems*, worked in 8-, 20- and 32-field examples ([PDF](https://ia803105.us.archive.org/29/items/GridSystemsInGraphicDesignJosefMullerBrockmann/Grid%20systems%20in%20graphic%20design%20-%20Josef%20Muller-Brockmann.pdf)).
3. **Compose asymmetrically, so the module you are counting in becomes visible.** — the Zürich poster practice; taken to its limit by Crouwel printing the lattice in *Vormgevers*, 1968 ([Stedelijk](https://www.stedelijk.nl/en/news/wim-crouwel-1928-2019-2)).
4. **The composition must be generated by a stateable number series, not by eye.** — Beethoven's 11.25° module and 1-2-4-8-16 band widths ([Elam analysis](https://www.behance.net/gallery/9862277/Mueller-Brockmanns-Beethoven-Poster-Geometric-Analysis)); Bill's *Fifteen Variations* ([Daimler](https://art.daimler.com/en/artwork/quinze-variations-sur-un-meme-theme-15-variations-on-one-theme-max-bill-1935-38-2/)).
5. **Colour is a counted sequence across equal modules, not a taste decision.** — Lohse, *Fifteen Systematic Colour Rows*, 1950–68 ([MoMA](https://www.moma.org/collection/works/80503)).
6. **One grotesk; two or three sizes in the whole artefact; flush left, ragged right, never justified.** — Ruder, *Typographie*, 1967 ([Typotheque](https://www.typotheque.com/books/typography-a-manual-of-design)); Vignelli's four-typeface exhibition ([Fonts In Use](https://fontsinuse.com/uses/14164/massimo-vignelli-s-a-few-basic-typefaces)).
7. **Text is a grey texture with a measurable value; design the counter-form with the form.** — Ruder's chapters "Form and counter-form" and "Shades of grey" ([full text](https://archive.org/details/typographie-a-manual-of-design-emil-ruder)).
8. **Photography enters as a high-contrast tonal plane, cropped until it is a sign.** — Hofmann, *Giselle*, 1959; *Graphic Design Manual*, 1965 ([Poster House](https://posterhouse.org/blog/armin-hofmann-1920-2020/), [Niggli](https://niggli.ch/en/products/methodik-der-form-und-bildgestaltung)).
9. **Every line bends only at 90° or 45°; nothing is freehand.** — Vignelli's 1972 subway diagram ([MoMA](https://www.moma.org/collection/works/89300)); Aicher's Munich lattice ([Smithsonian](https://www.smithsonianmag.com/innovation/this-graphic-artists-olympic-pictograms-changed-urban-design-forever-180978256/)).
10. **The empty area is the largest element on the sheet and is under pressure; if you can add something freely, you are not finished.** — the Weltformat poster tradition, where one piece must read at 30 m and at 30 cm ([Galerie 123](https://www.galerie123.com/en/poster-history/swiss-size-weltformat-format-mondial/)).

---

## B. Palette

The Swiss edition keeps the book's semantic colour logic (one hue, one meaning) and re-specifies each hue as an **ink**, with a print reference. Hexes below are the specified values; the Pantone names are the **nearest coated matches** and must be confirmed against a fan deck at proof, not trusted from a screen.

### Ground

| Role | Hex | Reference |
|---|---|---|
| **Paper** | `#FBF7EF` | The book's existing `hhpaper`. An uncoated offset white with warmth — deliberately *not* `#FFFFFF`, which is what makes flat spot colours read cheap. All plates are generated on exactly this value. |
| **Ink** | `#121212` | The book's `pdink`. Near-black, not `#000000`: reads as dense process black on uncoated stock rather than as a screen void. |
| **Signal red** | `#DA291C` | Pantone 485 C — the red specified for the Swiss federal flag and the standard "one red" of Swiss poster work. **Reserved.** Appears on at most three plates in the whole book, never as an area larger than 2% of the plate. This is the book's existing breach/correction semantics, given a Swiss job. |

### The four part colours

Each is a darkened, ink-weight restatement of the hue that part already carries in the maritime edition, so the two editions remain siblings.

| Part | Name | Hex | Nearest coated | Provenance and why it is Swiss |
|---|---|---|---|---|
| **I — Ground Truth** | Reflex Blue | `#001489` | **Pantone Reflex Blue C** | The default European spot blue on offset presses since the 1950s — the blue a Zürich studio reached for when the job was "one colour plus black," and the trunk-line blue of the Vignelli/Unimark subway diagram ([MoMA](https://www.moma.org/collection/works/89300)). Replaces `pdcobalt #003FB8`; darker, denser, less screen-lit. |
| **II — The Cost of Seeing** | Tonhalle Green | `#006B5F` | Pantone 3298 C (`#006152`) | Carried over unchanged from the book's `pdteal`. It already sits in the printed dark-green register of Swiss cultural posters — a green with black in it, not a digital teal. |
| **III — What Survives the Restart** | Konkret Violet | `#582C83` | **Pantone 268 C** | A printed purple with ink weight, in the family Lohse used at the cool end of his systematic colour rows ([MoMA](https://www.moma.org/collection/works/80503)). Replaces `pdviolet #933FA5`, which is a lilac on screen and goes chalky in flat areas. |
| **IV — Trade Between Strangers** | Ledger Olive | `#666A00` | Pantone 5757 C | Carried over from the book's `pdgold`. A yellow that has been taken all the way down to olive is the classic Swiss escape from "primary jewel tone": maximum hue identity, print-plausible value, no glitter. |

Value check: `#001489`, `#006B5F`, `#582C83`, `#666A00` all sit in a narrow luminance band (roughly L\* 25–42), so the four part plates carry the same *weight* on the shelf and differ only in hue. That is the Lohse move — the series is the point, not any one member.

### How the eight chapters take colour from their part

Each chapter uses **its part's ink screened at one of three fixed tints — 100%, 62%, 38%** — in chapter order within the part. This is a spot colour on a halftone screen, the cheapest and most orthodox Swiss way to get three colours out of one plate, and it makes the part membership visible at a glance while ranking the chapters inside it.

| Ch. | Title | Part | Tint | Resulting value on `#FBF7EF` |
|---|---|---|---|---|
| 1 | The Single-Writer Kernel | I | 100% | `#001489` |
| 2 | The Anchor Protocol | I | 62% | `#5F6AB0` |
| 3 | The Sealed Harbor | I | 38% | `#9CA1C8` |
| 4 | The Legible Swarm | II | 100% | `#006B5F` |
| 5 | From Spawn to Person | III | 100% | `#582C83` |
| 6 | The Harbor Economy | IV | 100% | `#666A00` |
| 7 | The Bonded Commons | IV | 62% | `#9FA05B` |
| 8 | The Federated Harbor | IV | 38% | `#C2C194` |

**Rule for the plates:** a chapter plate may use *only* its own tint, ink `#121212`, and paper. Where a plate needs internal ranking, it uses the two lighter tints of the same part hue (so Ch. 1 may also use `#5F6AB0` and `#9CA1C8`). Two part hues never appear on one plate — except on the cover, and on the Part IV chapter 8 plate where the two lattices are the two lighter olive tints.

*Note for II and III:* those parts hold one chapter each, so the 62% and 38% tints of green and violet are free. Use them inside those plates for internal ranking; do not lend them to other parts.

---

## C. The cover

### Grid (applies to all four compositions)

7 × 10 in trim = 177.8 × 254 mm. Margins: **14 mm** left and right, **16 mm** head, **20 mm** foot. Type area 149.8 × 218 mm. Divided into **6 columns × 9 rows** with 4 mm gutters, giving a module of **21.63 × 20.67 mm** — near-square, so horizontal and vertical counts are directly comparable. This is a 54-field grid in the Müller-Brockmann family. Everything, in type and in image, begins and ends on a field boundary. There is exactly **one left datum** at 14 mm; title, subtitle, author and imprint all hang from it.

Type sizes: three only. Title ≈ 34 pt / 38 pt leading, set flush left in three lines. Subtitle ≈ 13 pt / 17 pt. Author and imprint ≈ 9 pt. Ratio largest:smallest ≈ 3.8:1, tightened from the poster's 5:1 because this is a book read at arm's length.

### Composition A — "The Origin and the Arcs" *(recommended)*

**The picture:** a harbour seen as pure geometry. One point on a wall is the origin — the person, the ledger position, the single writer. From it, concentric quarter-arcs open outward across the page: the basin, then the trade beyond it. The arcs are struck, not drawn; their widths follow Müller-Brockmann's doubling.

**The geometry, literally.** The image block occupies **rows 5 through 9, all 6 columns** (149.8 × 108 mm), flush to the left and right margins, its foot on the bottom margin. Ground is paper `#FBF7EF`. The arc centre is the **bottom-left corner of the image block**. Five concentric quarter-annuli are struck from that centre, sweeping the full 90° from the block's left edge to its bottom edge, in Reflex Blue `#001489` at 100%. Reading outward from the centre, their radial widths are in the ratio **16 : 8 : 4 : 2 : 1** and they are separated by paper gaps of exactly **1 unit** each, where 1 unit = 2 mm. So: band 1 spans radius 12–44 mm, gap to 46, band 2 to 62, gap to 64, band 3 to 72, gap to 74, band 4 to 78, gap to 80, band 5 to 82 mm. Every band is hard-clipped by the image block's four edges — the outermost bands run off the right edge, which is what makes the field read as larger than the page. Inside radius 12 mm there is only paper. On the centre point sits a single solid square, **6 × 6 mm**, in signal red `#DA291C`, its lower-left corner exactly at the centre — the only red on the book. No outlines, no strokes, no gradient: five flat blue bands, one red square, paper.

**The type region (empty in the generated image):** **rows 1 through 4, all 6 columns** — the top 96 mm of the type area, plus the head margin, is unbroken paper. Title on rows 1–3 flush left ("The Harbor," / "the Person," / "and the Economy"); subtitle on row 4; author at the foot of row 4 right-aligned to the left datum's column 4 boundary; imprint set in the foot margin below the image block, flush left. The generated plate simply must not put anything above the image block.

**Why it is this book.** The origin is the single writer and the durable file; the first band is the sealed harbour's two fences; the widening bands are the swarm, the persons, the market; the red square is the one thing that can go wrong and must be seen. Delete the arcs and the sheet stops being about this book — which is the test in §0.

### Alternative B — "Two Fences, One Slot"

The image block is enlarged to **rows 4–9, full width**, and is a **solid Reflex Blue rectangle** — a printed field, not an outline. Two full-height paper-white slots, each **4 mm wide**, cut vertically through it: one on the column 2/3 gutter, one on the column 4/5 gutter. The two slots are of different lengths — the left one runs the full height of the block, the right one stops **2 modules short of the top**, so the field is not symmetrical and the eye counts the difference. Between them, one solid square of Ledger Olive `#666A00`, **20 × 20 mm**, sits on the block's horizontal centreline. Type region: rows 1–3, paper, above the block. This is the Hofmann plane-with-incision move and the most severe of the three; it makes the book look like a Niggli manual.

### Alternative C — "The Ledger Field"

A Lohse serial field. The image block occupies **rows 4–9**, and is filled with a **6 × 6 array of squares** on the column module (each 21.63 × 17.3 mm, 4 mm gutters). The squares are filled in **reading order, column-major**, with the four part inks in strict rotation — Reflex Blue, Tonhalle Green, Konkret Violet, Ledger Olive, Reflex Blue, … — but the fill **stops at the 23rd square**; the remaining 13 modules are paper. The last filled square is red `#DA291C`. The result is a ledger that has been written up to a point and no further: a record with a present moment. Type region: rows 1–3. This is the variant that most obviously says "textbook of a *series*," and it is the best one if the book gets sequels.

### Alternative D — "Point, Line, Plane" *(described, no prompt; it is a one-line variant of A)*

A vertical plane of ink `#121212` occupying **column 1 only, full page height, bleeding off head and foot** — a spine-side bar. One hairline (0.4 mm) crosses the full page width on the **row 6/7 boundary**. One solid disc of Reflex Blue, **44 mm diameter**, sits tangent both to the hairline (above it) and to the right edge of the ink bar. Everything else is paper. Type region: columns 2–6, rows 1–5. Hofmann in three elements; the most austere and the least explanatory.

---

## D. The twelve plates

**Shared plate specification.** Each plate is generated at **3:2 landscape** for part openers (they run across a full opening or a full page with a deep type well) and **4:3 landscape** for chapter plates. Ground is always paper `#FBF7EF`. A **reserved empty region** is specified per plate and must be unbroken paper. Every plate is a *constructive abstraction* — a diagram of the idea's structure, never a picture of a machine, a harbour, a person or a computer. All edges are horizontal, vertical or 45°. All fills are flat. Nothing is outlined unless the outline is itself the subject.

### The four part plates

**Part I — Ground Truth.** *A datum, and what rests on it.*
Field of 24 × 16 units (1 unit = 1/24 of the width). A single horizontal bar of ink `#121212`, **1.5 units tall**, spans the full width at **y = 10** (measuring from the top). Resting on it, upper edge free, one solid square of Reflex Blue `#001489`, **5 × 5 units**, whose left edge is at **x = 4**. Below the bar, **five hairlines** (0.2 units) span the full width at y = 12, 12.75, 13.5, 14.25, 15 — strata beneath the datum, none of them the datum. Nothing above the square. Reserved region: the whole area above y = 5, full width.

**Part II — The Cost of Seeing.** *Resolution has a price, and the price is countable.*
Field of 24 × 16 units. The right two-thirds carries a lattice of small squares on a 0.5-unit module, in Tonhalle Green `#006B5F`. Density decays leftward in **four discrete vertical zones** of equal width (6 units each): rightmost zone 100% of cells filled, next 50%, next 25%, next 12.5% — the halving is visible if you count. Cells are filled by a fixed rule (every cell, every other cell, every fourth, every eighth), never randomly. Reserved region: the leftmost 6 units, full height, plus a 2-unit band along the top.

**Part III — What Survives the Restart.** *One thing crosses the gap.*
Field of 24 × 16 units. A band from y = 4 to y = 12 contains **seventeen vertical bars** of Konkret Violet `#582C83`, each 0.8 units wide on a 1.4-unit pitch, full band height. A **paper gap 3 units wide** cuts the band vertically at x = 13–16, erasing the bars it crosses. Exactly **one** bar continues through the gap at full height and full colour, at x = 14.2. Reserved region: everything above y = 3 and below y = 13.

**Part IV — Trade Between Strangers.** *Three parties, one book of record.*
Field of 24 × 16 units. Three rectangles of **equal area (12 square units) but different proportion** — 6 × 2, 4 × 3, 3 × 4 — in Ledger Olive `#666A00`, placed apart and not touching, at roughly (3,3), (17,4), (9,11). Three straight rules of ink `#121212`, 0.3 units, run from a point on each rectangle's edge and **meet at exactly one point** at (12,7). One horizontal rule, 0.8 units, ink, spans the **full width** through that point. Reserved region: a 3-unit band along the top, full width.

### The eight chapter plates

**Ch. 1 — The Single-Writer Kernel** *(Reflex Blue `#001489`)*
Field 24 × 12. One solid square, **3 × 3 units**, at (2,4) — the writer. From its right edge, one bar **1 unit tall**, on the square's horizontal centreline, extends to the right edge of the field, but is composed of **seven appended segments** separated by paper gaps of 0.15 units; segment lengths increase 1, 1.5, 2, 2.5, 3, 3.5, 4 units. Nothing touches the bar from above or below. Reserved: the top 3 units, full width.

**Ch. 2 — The Anchor Protocol** *(`#001489`, 62% `#5F6AB0`, 38% `#9CA1C8`)*
Field 24 × 12. **Four nested rectangles sharing their top-left corner** at (3,2): 18 × 8, 13 × 6, 9 × 4, 5 × 2.5 units. Each is a flat fill, drawn back-to-front so each smaller one sits on top: 38%, 62%, 100%, then ink `#121212` for the innermost. Every step is smaller in **both** dimensions — the visual statement that delegation only narrows. Reserved: a 3-unit band along the right and the bottom 2 units.

**Ch. 3 — The Sealed Harbor** *(38% `#9CA1C8`, ink, red `#DA291C`)*
Field 24 × 12. Two concentric rectangular **rings** (stroke, not fill) in ink `#121212`, stroke width 0.5 units: outer 18 × 9 at (3,1.5), inner 12 × 5.5 at (6,3.25). Each ring is broken by exactly **one paper gap 1.5 units wide** — the outer gap on its right edge, the inner gap on its top edge (90° apart, never aligned). Inside the inner ring, one solid square **3 × 3** of `#9CA1C8`. One red hairline (0.2 units) leaves that square, passes through the inner gap, and **stops dead** on the inner face of the outer ring. Reserved: the top 1.5 units and left 3 units.

**Ch. 4 — The Legible Swarm** *(Tonhalle Green `#006B5F` and its 38% `#9CC2B8`)*
Field 24 × 12. **Forty identical small squares**, 0.7 × 0.7 units, in 38% green, placed on a 1.5-unit lattice but occupying an irregular subset of it (grid-aligned, never floating off-grid), spread across y = 1 to y = 7. Beneath them, one **full-width bar** of 100% green, 1.2 units tall, at y = 9.5 — one line of sight under forty machines. No line connects the squares to the bar. Reserved: the bottom 1.5 units, full width.

**Ch. 5 — From Spawn to Person** *(Konkret Violet `#582C83`, tinted)*
Field 24 × 12. A row of **twelve squares**, 1.4 × 1.4 units, on a 1.8-unit pitch from x = 2, all sitting on a common baseline at y = 8. Their fills run a strict Lohse progression: 8%, 17%, 25%, 33%, 42%, 50%, 58%, 67%, 75%, 83%, 92%, 100% of `#582C83` on paper. The baseline is a **hairline (0.15 units) under the first eight squares and thickens abruptly to 1 unit** under the ninth and onward, running to the field's right edge. Reserved: the top 5 units, full width.

**Ch. 6 — The Harbor Economy** *(Ledger Olive `#666A00`, 62% `#9FA05B`, 38% `#C2C194`)*
Field 24 × 12. An equilateral triangle of side 11 units centred at (12,5.5), drawn as **three separate straight bars, 0.9 units thick, that stop 1 unit short of every corner** — three parties who transact but do not merge. The three bars are 100%, 62% and 38% olive. One ink rule, 0.6 units, spans the **full field width** through the triangle's centroid. Reserved: the bottom 3 units, full width.

**Ch. 7 — The Bonded Commons** *(62% olive `#9FA05B`, ink, red `#DA291C`)*
Field 24 × 12. A column of **eight horizontal bars**, each 0.9 units tall on a 1.3-unit pitch from y = 1.5, all beginning at x = 3. Five run to x = 20 (full bond). Three — the 2nd, 5th and 6th — are **shortened from the right** by 3, 6 and 9 units respectively (the forfeiture is a counted series). One solid red square, 0.9 × 0.9, sits at **x = 21.5** on the row of the shortest bar, separated from it by paper — the appeal, outside the bond. Reserved: the right 2 units above and below the red square, and the bottom 1.5 units.

**Ch. 8 — The Federated Harbor** *(62% `#9FA05B` and 38% `#C2C194` olive, ink)*
Field 24 × 12. **Two square fields**, each 8 × 8 units, at (1.5,2) and (14.5,2), separated by a paper gutter 5 units wide. Each contains an identical **5 × 5 lattice of small squares**, 0.6 × 0.6 units — the left lattice in 62% olive, the right in 38%. The right lattice is **offset by half a module** (0.8 units down and right) relative to the left, so the two are provably not the same coordinate system. **Three straight ink rules**, 0.3 units, cross the gutter horizontally; each enters the opposite field and **stops at the first lattice square it meets**, never traversing. Reserved: the top 2 units, full width.

---

## E. Fifteen ready-to-run image prompts

### How to use them

- **Model:** Nano Banana Pro (`gemini-3-pro-image-preview`) for every plate — its text-rendering architecture suppresses type reliably when instructed, which the Flash models do not.
- **Text suppression is done positively, never negatively.** Gemini's image head does not honour "no text"; the working technique is to describe the empty area as *something* ("unbroken flat paper, nothing printed on it"). Every prompt below already does this ([Google Cloud prompting guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana), [Gemini prompt tips](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/)).
- **Aspect ratio** goes in `imageConfig.aspectRatio` *and* is restated in the prompt; the model otherwise crops into the wrong region.
- **Style template:** once you have one plate you are happy with, attach it to every subsequent call labelled "**Reference image 1 is the STYLE TEMPLATE — match its flat ink rendering, paper value, edge quality and absence of any printed marks.**" This is worth more than any adjective.
- **Colour is stated by hex.** Do not write "blue."

### Shared appendix — paste at the end of every prompt

> Flat offset-lithograph rendering on uncoated paper, in the manner of Swiss International Typographic Style and Zurich Konkrete Kunst — Josef Müller-Brockmann, Richard Paul Lohse, Max Bill, Armin Hofmann. Every shape is a hard-edged area of solid flat ink with a crisp mechanical edge. Ground is unbroken flat paper #FBF7EF. All surfaces are bare and unmarked; every reserved area is empty flat paper with nothing printed on it; the picture consists only of the geometric shapes described.

### Shared negative prompt — for any model that accepts one

> gradient, drop shadow, glow, bevel, 3D, perspective, depth of field, texture overlay, grain, paper mockup, book mockup, frame, border, vignette, brush stroke, hand-drawn, sketch, watercolour, halftone noise, photograph, illustration, character, logo, watermark, signature, letters, words, numbers, text, caption, label, UI, icon.

*(Include it where supported; on Nano Banana it is inert — the positive appendix above is what actually works.)*

---

#### 1 — Cover A, "The Origin and the Arcs"

> Vertical 7:10 composition. The top 44% is unbroken flat paper #FBF7EF, entirely bare. The lower 56% is a rectangle of the same paper containing five concentric quarter-ring bands of solid flat #001489 struck from its bottom-left corner, sweeping 90 degrees from the left edge to the bottom edge. Reading outward, band thicknesses are in the ratio 16:8:4:2:1, separated by narrow paper gaps; outer bands run off the right edge. A single small solid #DA291C square sits at the corner point. Nothing else. *(+ shared appendix)*

#### 2 — Cover B, "Two Fences, One Slot"

> Vertical 7:10 composition. The top third is unbroken flat paper #FBF7EF, completely bare. The lower two-thirds is one solid flat rectangle of #001489 spanning the full width. Two narrow vertical paper-white slots cut through it: the left slot runs the rectangle's full height, the right slot stops short of the top, so the two are deliberately unequal. Between the slots, one solid flat #666A00 square sits on the rectangle's horizontal centreline. Hard mechanical edges, no outlines. *(+ shared appendix)*

#### 3 — Cover C, "The Ledger Field"

> Vertical 7:10 composition. The top third is unbroken flat paper #FBF7EF, completely bare. The lower two-thirds holds a precise 6-by-6 grid of equal rectangles with even paper gutters. Filled in column-major order, the rectangles cycle strictly through solid flat #001489, #006B5F, #582C83, #666A00, repeating. The fill stops after 23 rectangles; the remaining 13 are empty paper. The 23rd rectangle is #DA291C. Hard mechanical edges, flat inks, no outlines, no shading. *(+ shared appendix)*

#### 4 — Part I plate, "Ground Truth"

> Horizontal 3:2 composition on flat paper #FBF7EF. The top third is unbroken bare paper. Below it, one solid flat #121212 horizontal bar spans the entire width at about 62% of the height. One solid flat #001489 square rests exactly on top of that bar, left of centre, its lower edge touching the bar. Beneath the bar, five thin evenly spaced #121212 hairlines span the full width. Nothing else appears. Hard mechanical edges, flat ink areas, no outlines. *(+ shared appendix)*

#### 5 — Part II plate, "The Cost of Seeing"

> Horizontal 3:2 composition on flat paper #FBF7EF. The left quarter and a band along the top are unbroken bare paper. The remaining area holds a precise square lattice of small solid #006B5F squares whose density halves in four equal vertical zones: the rightmost zone completely filled, the next with every second cell filled, the next every fourth, the next every eighth. All squares are identical in size and sit exactly on the lattice. Flat ink, hard edges, no outlines. *(+ shared appendix)*

#### 6 — Part III plate, "What Survives the Restart"

> Horizontal 3:2 composition on flat paper #FBF7EF. Broad bare paper bands at top and bottom. Across the middle, a row of seventeen identical narrow vertical bars of solid flat #582C83, evenly pitched, all the same height. A wide clean vertical band of paper cuts through the row right of centre, erasing the bars it crosses. Exactly one bar survives inside that gap at full height and full colour. Hard mechanical edges, flat ink, no outlines, no shading. *(+ shared appendix)*

#### 7 — Part IV plate, "Trade Between Strangers"

> Horizontal 3:2 composition on flat paper #FBF7EF, with a bare paper band along the top. Three solid flat #666A00 rectangles of equal area but different proportions — one wide, one nearly square, one tall — sit apart from one another, not touching. Three straight thin #121212 rules run from the rectangles and converge at exactly one point near the centre. One thicker #121212 horizontal rule passes through that same point and spans the entire width. Hard mechanical edges, no outlines. *(+ shared appendix)*

#### 8 — Chapter 1, "The Single-Writer Kernel"

> Horizontal 4:3 composition on flat paper #FBF7EF, top quarter unbroken bare paper. One solid flat #001489 square sits at the left. From its right edge, a thin horizontal bar on the square's centreline runs to the right edge of the image, broken into seven segments separated by narrow paper gaps; the segments grow steadily longer from left to right. Nothing touches the bar above or below. Hard mechanical edges, flat ink, no outlines, no shading. *(+ shared appendix)*

#### 9 — Chapter 2, "The Anchor Protocol"

> Horizontal 4:3 composition on flat paper #FBF7EF, with bare paper along the right side and the bottom. Four solid flat rectangles are nested so that they all share one top-left corner, each strictly smaller than the last in both width and height. From largest to smallest their colours are #9CA1C8, #5F6AB0, #001489, then #121212, each sitting on top of the previous. Hard mechanical edges, flat ink areas, no outlines, no shading, no overlap other than the nesting. *(+ shared appendix)*

#### 10 — Chapter 3, "The Sealed Harbor"

> Horizontal 4:3 composition on flat paper #FBF7EF. Two concentric rectangular outlines of solid flat #121212 with even stroke thickness. The outer outline is interrupted by one clean paper gap in its right side; the inner outline is interrupted by one clean paper gap in its top side. Inside the inner outline sits one solid flat #9CA1C8 square. A single thin #DA291C line leaves that square, passes through the inner gap, and stops exactly at the inner face of the outer outline. Bare paper margins. *(+ shared appendix)*

#### 11 — Chapter 4, "The Legible Swarm"

> Horizontal 4:3 composition on flat paper #FBF7EF, bottom band unbroken bare paper. Forty identical small solid #9CC2B8 squares are scattered across the upper two-thirds, every one aligned exactly to an invisible regular lattice, none rotated. Below them, one solid flat #006B5F bar spans the entire width, thicker than the squares, unconnected to them by any line. Hard mechanical edges, flat ink areas, no outlines, no shading, no connecting strokes. *(+ shared appendix)*

#### 12 — Chapter 5, "From Spawn to Person"

> Horizontal 4:3 composition on flat paper #FBF7EF, top half unbroken bare paper. In the lower half, twelve equal squares sit in a single evenly spaced row on one common baseline. Their fills step evenly from a very pale tint of #582C83 at the left to full solid #582C83 at the right, a strict twelve-step progression. The baseline under the first eight squares is a thin hairline; from the ninth square onward it abruptly becomes a thick solid bar running to the right edge. Flat ink, hard edges. *(+ shared appendix)*

#### 13 — Chapter 6, "The Harbor Economy"

> Horizontal 4:3 composition on flat paper #FBF7EF, bottom quarter unbroken bare paper. An equilateral triangle is suggested by three separate straight thick bars, one per side, each stopping short of the corners so the three never touch. The bars are solid flat #666A00, #9FA05B and #C2C194, one colour each. One thin #121212 rule passes horizontally through the triangle's centre and spans the entire image width. Hard mechanical edges, flat ink, no outlines, no shading. *(+ shared appendix)*

#### 14 — Chapter 7, "The Bonded Commons"

> Horizontal 4:3 composition on flat paper #FBF7EF. A vertical stack of eight identical horizontal bars of solid flat #9FA05B, evenly spaced, all beginning at the same left edge. Five reach the same right end; three are cut short from the right by clearly different, steadily increasing amounts. One small solid #DA291C square floats at the far right on the row of the shortest bar, separated from it by clean paper. Bare paper along the bottom. Hard mechanical edges, flat ink, no outlines. *(+ shared appendix)*

#### 15 — Chapter 8, "The Federated Harbor"

> Horizontal 4:3 composition on flat paper #FBF7EF, top band unbroken bare paper. Two equal square fields sit left and right, separated by a wide clean paper gutter. Each holds an identical 5-by-5 lattice of small solid squares — the left lattice #9FA05B, the right #C2C194 — and the right lattice is visibly offset by half a step relative to the left. Three thin straight #121212 rules cross the gutter horizontally; each enters the far field and stops at the first small square it reaches. *(+ shared appendix)*

---

## F. The figure language — how the TikZ changes

The Swiss edition already has an override file at `website-v2/public/whitepaper/figures/pd-figure-language-swiss.tex`, loaded by `pd-figure-language.tex`. These ten bullets are the changes to make there and in `pd-palette.tex`; they are deliberately expressed as edits to what exists.

1. **Repoint the part inks.** In the Swiss edition only, `pdcobalt` → `#001489` and `pdviolet` → `#582C83`; `pdteal` and `pdgold` stay. Add `\definecolor{pdswissred}{HTML}{DA291C}` and use it in place of `pderror` for the Swiss `pd caution *` styles. Ground stays `hhpaper #FBF7EF`; make `hhink` `#121212` in this edition so plates and figures share one black.

2. **Chapter tint ladder, not chapter hues.** Replace per-chapter colour lookups with `\pdcurrentparthue` plus a tint index: define `pd tint a/b/c` as `\pdcurrentparthue`, `\pdcurrentparthue!62!hhpaper`, `\pdcurrentparthue!38!hhpaper`. Every figure ranks its elements with those three and nothing else. Two part hues never appear in one figure.

3. **Fills carry meaning; strokes carry containment.** Keep the existing split (`pd state` and `pd datum` are fills with `draw=none`; `pd boundary` and `pd actor` are strokes) and enforce it — a node is *either* filled *or* outlined, never both. Delete every `fill=...!22` "focus fill" tint that is neither a ranked tint nor paper.

4. **Three stroke weights, no more.** Hairline **0.4 pt** (guides, lattices, grid ticks), line **1.0 pt** (all ordinary linework and arrows), rule **2.0 pt** (enclosures, datums, the one emphasised path). The current file has 0.5/0.6/0.9/1.1/1.5/2.0 — collapse to three. Weight is a semantic channel; six values means it carries nothing.

5. **Right angles and 45° only.** Add a house `pd edge` style using `to path={-| (\tikztotarget)}` variants and forbid free-angle `--` between nodes; where a diagonal is genuinely needed it is exactly 45°. This is the Vignelli/Aicher constraint and it is what will make the figures look like one book instead of thirty drawings.

6. **One arrowhead, one size, everywhere.** Keep `Triangle[length=2.4mm,width=2.2mm]` and delete every other arrow tip in the tree. A second arrowhead shape must earn its place by meaning something (e.g. "unauthenticated"), and then must be documented in the figure legend chapter.

7. **Square corners, no rounding, no shadow, no fill opacity.** `rounded corners=0pt` is already set on the Swiss styles — extend it to `pd actor`, `pd artifact` and every ad-hoc node in the 60+ `fig-*.tex` files, and grep out `drop shadow`, `opacity=`, `shading=` and `blur`.

8. **Type: one grotesk, three sizes, flush left.** `\pdgrotesk` at `\footnotesize` for all labels, `\scriptsize` for axis ticks and notes, `\small\bfseries` for panel titles. Nothing italic; nothing centred inside a node except a single-word state name; `align=left` everywhere else. Label text is sentence case, never Title Case.

9. **Put the grid in the drawing.** Every figure declares a module (`\pdmod`, default 4 mm) and places every node origin, every rule and every gap at an integer multiple of it. Where the structure is the point — the sealed room, the lattice figures, the tint ladders — draw the module as a 0.4 pt `hhink!25` lattice and leave it visible. That is the Crouwel move and it is free legibility.

10. **Reserve the empty area explicitly.** Give each figure a `pd reserve` rectangle occupying at least 30% of the bounding box that no element may enter, positioned asymmetrically (usually the upper-left or lower-right quadrant). Add it to the figure QA check alongside the existing `check-figure-palette.mjs` — the same script should now also fail the build on any colour outside {paper, ink, current part hue at 100/62/38, swiss red}.

---

## G. Sources

**Canon and craft**
- Ernst Keller — https://designreviewed.com/designer/ernst-keller/ · *No Style* (Triest Verlag, 2017) — https://designreviewed.com/artefacts/no-style-ernst-keller-1891-1968-teacher-and-pioneer-of-the-swiss-style-triest-verlag-2017/
- Müller-Brockmann, *Musica Viva* — https://www.moma.org/collection/works/7233 · https://collections.vam.ac.uk/item/O110243/musica-viva-poster-josef-muller-brockmann/ · https://www.thegraphicdesignschool.com/design-history/joseph-mueller-brockmann/
- Beethoven poster, geometric analysis (after Kimberly Elam, *Geometry of Design*) — https://www.behance.net/gallery/9862277/Mueller-Brockmanns-Beethoven-Poster-Geometric-Analysis
- Müller-Brockmann, *Grid Systems in Graphic Design* (full text) — https://ia803105.us.archive.org/29/items/GridSystemsInGraphicDesignJosefMullerBrockmann/Grid%20systems%20in%20graphic%20design%20-%20Josef%20Muller-Brockmann.pdf
- Armin Hofmann — https://posterhouse.org/blog/armin-hofmann-1920-2020/ · https://www.cooperhewitt.org/2018/08/05/aharmonyofcontrasts/ · *Graphic Design Manual* https://niggli.ch/en/products/methodik-der-form-und-bildgestaltung · full text https://b.parsons.edu/~dejongo/12-fall/stuff/departmentalReadings/graphic-design-manual-principles-and-practice.pdf
- Emil Ruder, *Typographie* — https://www.typotheque.com/books/typography-a-manual-of-design · https://archive.org/details/typographie-a-manual-of-design-emil-ruder
- Max Bill, *Quinze variations* — https://art.daimler.com/en/artwork/quinze-variations-sur-un-meme-theme-15-variations-on-one-theme-max-bill-1935-38-2/ · https://www.moma.org/collection/works/7678
- Richard Paul Lohse — https://www.moma.org/collection/works/80503 · https://www.hauserwirth.com/hauser-wirth-exhibitions/richard-paul-lohse/ · https://www.hauskonstruktiv.ch/en/exhibitions/richard-paul-lohse?tab=1
- Karl Gerstner, *Designing Programmes* — https://openlab.citytech.cuny.edu/langecomd3504sp2020/files/2018/10/Gerstner_DesigningProgrammes-1.pdf · *The Forms of Color* https://mitpress.mit.edu/9780262570817/forms-of-color/
- Wim Crouwel — https://www.moma.org/collection/works/139322 · https://www.stedelijk.nl/en/news/wim-crouwel-1928-2019-2 · https://www.neugraphic.com/wim/typography.html
- Massimo Vignelli — https://www.moma.org/collection/works/89300 · https://www.nytransitmuseum.org/vignelli/ · *The Vignelli Canon* https://www.rit.edu/vignellicenter/sites/rit.edu.vignellicenter/files/documents/The%20Vignelli%20Canon.pdf · https://fontsinuse.com/uses/14164/massimo-vignelli-s-a-few-basic-typefaces
- Otl Aicher — https://www.smithsonianmag.com/innovation/this-graphic-artists-olympic-pictograms-changed-urban-design-forever-180978256/ · https://fontsinuse.com/uses/38873/organisationskomitee-fuer-die-spiele-der-xx-o · https://www.olympic-museum.de/pictograms/olympic-games-pictograms-1972.php · https://www.otlaicher.de/en/articles/the-rainbow-games/
- Odermatt & Tissi — https://designreviewed.com/designer/odermatt-tissi/ · https://en.wikipedia.org/wiki/Rosmarie_Tissi

**Books, covers, journals**
- *Neue Grafik* — https://en.wikipedia.org/wiki/Neue_Grafik · https://www.lars-mueller-publishers.com/neue-grafiknew-graphic-designgraphisme-actuel-1958-1965
- Romek Marber, Penguin grid — https://romekmarber.com/portfolio/penguin-grid/ · https://www.eyemagazine.com/feature/article/penguin-crime-text-in-full
- Weltformat / Swiss poster size — https://www.galerie123.com/en/poster-history/swiss-size-weltformat-format-mondial/ · Poster House, *The Swiss Grid* https://swissgrid.posterhouse.org/
- Akzidenz-Grotesk — https://en.wikipedia.org/wiki/Akzidenz-Grotesk

**Contemporary practice**
- Wolfgang Weingart — https://en.wikipedia.org/wiki/Wolfgang_Weingart
- Norm — https://en.wikipedia.org/wiki/Norm_(graphic_design_group) · https://eyemagazine.com/feature/article/buying-into-the-norm-cosmos
- Experimental Jetset — https://www.designboom.com/design/experimental-jetset-interview/ · https://www.jetset.nl/archive/helveticanism
- Felix Pfäffli / Studio Feixen — https://www.studiofeixen.ch/sudpol/ · https://a-g-i.org/design/s%C3%BCdpol-plakate-1
- Cornel Windlin / Lineto — http://www.swissdesignawards.ch/designprize/2011/cornel-windlin/index.html?lang=en · https://lineto.com/information/designers/lineto-designers/cornel-windlin
- Bureau Mirko Borsche — https://www.itsnicethat.com/articles/mirko-borsche-design-museum

**Image-model craft**
- Google Cloud, ultimate prompting guide for Nano Banana — https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
- Google, Nano Banana Pro prompting tips — https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/
- Local skill: `skills/nano-banana-image-gen/references/prompt-formula.md` (§"Suppressing text": "There is no negative prompt. Always use positive framing.") and `references/troubleshooting.md`

**This repository**
- `website-v2/public/whitepaper/figures/pd-palette.tex` — current semantic palette and hexes
- `website-v2/public/whitepaper/figures/pd-figure-language-swiss.tex` — current Swiss figure overrides
- `website-v2/public/whitepaper/figures/pd-textbook-map.tex` — chapter/part titles, hues, one-line summaries
- `website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex` — `\pdchapter`, `\pdpart`, edition switch
