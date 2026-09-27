# TikZ, PGF, and PGFPlots Layout Systems: Architectural Reference Guide for Robust, Collision-Free Diagrams

**Author:** Harbor Figure Architecture & Systems Research  
**Target Architecture:** TikZ/PGF 3.1+, PGFPlots 1.18+, TeX Live / Tectonic Engine Systems  
**Corpus Provenance & Empirical Validation:** Derived from production analytical corpora (`whitepaper/figures/pd-figure-language.tex`, `skills/harbor-chartwork/`, `skills/tikz-figure-engineering/`, and automated PyMuPDF geometry verification suites `figcheck.py` / `check_figure_clearance.py`).

---

### Executive Architectural Summary

In TeX’s layout model, graphics are constructed from box-and-glue primitives, deferred coordinate transformations, and post-processed path tokens. Unlike HTML/CSS constraint engines or modern layout solvers (e.g., Cassowary, Yoga), **TikZ does not have a global, multi-body relaxation or collision solver in standard engines (pdfTeX, XeTeX)**. Collision avoidance in publication-grade diagrams must be engineered deterministically through:
1. **Formal Box-Model Math**: Strict separation of content bounding width (`text width`), internal cushion (`inner sep`), clearance boundary (`outer sep`), and structural minimums (`minimum size`).
2. **Defensive Edge Typology**: Using knockout backing pads (`fill=pdpage`, `inner xsep=3pt..5pt, inner ysep=2pt..3.5pt`), text contour halos (`contour` package), and path shortening (`shorten >`, `shorten <`) to decouple labels from underlying strokes.
3. **Discrete Coordinate Cadences**: Using intersection coordinate syntax `(Participant |- Time)` and matrix/chain grids for sequence diagrams rather than manual floating coordinates.
4. **PGFPlots Gutter Architecture**: Strict discipline between `clip=true/false`, coordinate systems (`axis cs:`, `axis description cs:`, `ticklabel cs:`), and endpoint direct-labeling.

---

## 1. Native TikZ/PGF Node Geometry: Margins, Padding, and Overflow Prevention

### 1.1 The PGF Shape Model & Boundary Calculus

When TikZ constructs a node (e.g., `shape=rectangle`), it evaluates three nested bounding regions:

```
+-------------------------------------------------------------+  <-- Outer Anchor Boundary
|                            outer sep                        |      (.north, .east, etc.)
|   +-----------------------------------------------------+   |
|   |                      inner ysep                     |   |  <-- Stroke Boundary
|   |   +---------------------------------------------+   |   |      (Path drawn by `draw`)
|   |   |                                             |   |   |
|   |   |               \pgfnodeparttextbox           |   |   |
|   |ixs|                (Wrapped Text Box)           |ixs|   |  <-- Text Box Boundary
|   |   |             width = text width              |   |   |
|   |   +---------------------------------------------+   |   |
|   |                      inner ysep                     |   |
|   +-----------------------------------------------------+   |
|                            outer sep                        |
+-------------------------------------------------------------+
```

The mathematical relationships governing the final rendered dimensions are:

$$\text{Content Width } W_c = \begin{cases} \text{natural width of single line text}, & \text{if } \mathtt{text\ width} \text{ is undefined} \\ \mathtt{text\ width}, & \text{if } \mathtt{text\ width} \text{ is set} \end{cases}$$

$$\text{Shape Interior Width } W_s = \max\Big(W_c + 2 \times \mathtt{inner\ xsep},\; \mathtt{minimum\ width}\Big)$$

$$\text{Shape Interior Height } H_s = \max\Big((H_c + D_c) + 2 \times \mathtt{inner\ ysep},\; \mathtt{minimum\ height}\Big)$$

$$\text{Anchor / Clearance Width } W_a = W_s + 2 \times \mathtt{outer\ xsep}$$

$$\text{Anchor / Clearance Height } H_a = H_s + 2 \times \mathtt{outer\ ysep}$$

Where $H_c$ and $D_c$ are the font-specific height (ascenders) and depth (descenders) of `\pgfnodeparttextbox`.

### 1.2 Interactions and Trapdoors

* **`text width` does NOT include `inner sep` (CSS `content-box` semantics):**  
  A frequent novice failure is setting `text width=2.5cm, minimum width=2.5cm`. Because TikZ adds `2 * inner xsep` to `text width`, the rendered box will be $2.5\,\text{cm} + 2 \times \mathtt{inner\ xsep}$. If adjacent layout slots allocate only $2.5\,\text{cm}$, nodes will collide.
* **The Role of `outer sep` in Stroke Terminations:**  
  `outer sep` does *not* expand the drawn boundary or fill of the node; it offsets the **anchor points** (`.north`, `.south`, `.west`, `.east`, and border ray intersections).  
  By default, TikZ sets `outer sep=auto`, which resolves to `0.5\pgflinewidth`. This mathematical offset ensures that an incoming arrow terminating at `(node.west)` lands exactly on the *outer edge* of the node's stroke, rather than penetrating to the stroke's mathematical center line.  
  Setting `outer sep=0pt` causes heavy borders (e.g. `line width=1.5pt`) to be partially pierced by arrowheads. Setting `outer sep=2pt` leaves an intentional floating gap between edges and the node stroke.
* **Descender Collisions & Asymmetric Cushioning:**  
  Glyph descenders (`g`, `j`, `p`, `q`, `y`) extend below the baseline by up to $0.3\times$ font size. If `inner ysep` is symmetric with `inner xsep` and set too small (e.g., $1.5\,\text{pt}$), descenders collide with or breach the bottom stroke.  
  *Production Law (from `pd-figure-language.tex`):* Always ensure `inner ysep` provides at least $3.0\,\text{pt}$ to $5\,\text{pt}$ clearance. For boxed text nodes, use `inner xsep=6pt..8pt, inner ysep=4.5pt..6pt`.

### 1.3 Overflow Prevention and Typography Discipline

When `text width` is declared without `align=...`, TeX formats the text as a justified paragraph. On short lines (e.g., `text width=2cm`), justification generates extreme glue stretching, leading to `Underfull \hbox (badness 10000)` and unsightly word gaps. Conversely, unbreakable literals (code symbols, URLs) cause `Overfull \hbox` and escape the node box into adjacent elements.

To prevent text overflow and crowding:
1. **Always pair `text width` with explicit alignment**: `align=center`, `align=left` (or `align=flush left`), or `align=right`.
2. **Inhibit hyphenation in technical diagrams**: Labels are names, not body prose. Hyphenating identifiers destroys word shape. Apply `\hyphenpenalty=10000\exhyphenpenalty=10000` inside `every node/.append style`.
3. **Use ragged-right raggedness controls**: `align=flush left` in TikZ invokes `\raggedright`, but leaves hyphenation active. For code identifiers, wrap tokens in `\texttt{}` or declare `pd mono label`.

```latex
% --- Idiom 1: Robust, Overflow-Free Container Node ---
\tikzset{
  robust node/.style={
    draw=black,
    line width=0.7pt,
    fill=white,
    rounded corners=2pt,
    text width=3.2cm,
    align=center,                 % Enables manual line breaks \\ and ragged margins
    inner xsep=7pt,               % Horizontal breathing room
    inner ysep=5pt,               % Clears ascenders/descenders
    outer sep=0.5\pgflinewidth,   % Default: arrowheads stop cleanly on stroke boundary
    minimum height=1.0cm,         % Enforces visual cadence across cards
    font=\pdfiglabelsize,
    execute at begin node={%      % Suppress hyphenation inside technical labels
      \hyphenpenalty=10000\exhyphenpenalty=10000\relax
    }
  }
}
```

---

## 2. Edge Label Placement and Path Collision Avoidance

### 2.1 Native Clearance Mechanisms

When an edge connects two nodes, labels placed along the path are vulnerable to stroke strike-through. Five native mechanisms control this clearance:

| Mechanism | Implementation | Behavioral Mechanics | Trade-offs / Failure Modes |
|---|---|---|---|
| **Direct Knockout Box** | `fill=white, inner sep=2.5pt` | Draws an opaque rectangle beneath the label text before stroking glyphs, blanking out the edge underneath. | Blanks out background grids or regions. Must match the local background color (`fill=pdpage` or `fill=white`). |
| **Offset Anchoring** | `above=2pt`, `below=2pt`, `auto` | Moves the label anchor completely outside the stroke envelope. | Increases diagram height/width; can collide with parallel arrows if lane spacing is tight. |
| **Path Shortening** | `shorten >=2pt, shorten <=2pt` | Retracts the path endpoints before drawing arrowheads or line ends. | Prevents arrowheads from colliding with node borders or lifelines. |
| **Glyph Contour Halo** | `\usepackage[outline]{contour}`<br>`\contour{white}{Text}` | Generates a 360-degree microscopic glyph halo in the paper color. | Path passes cleanly between words and letter strokes without a rectangular "patch" appearance. |
| **Background Layering** | `\usetikzlibrary{backgrounds}`<br>`\begin{scope}[on background layer]` | Strokes path on a dedicated layer behind the nodes. | Nodes must have opaque `fill` (e.g. `fill=white`) to occlude the path. |

### 2.2 Long Arrows & Multi-Actor Clearance Discipline

In multi-actor diagrams (e.g. sequence ladders), long horizontal arrows span multiple intermediate vertical lifelines. If a label is placed at `pos=0.5` on an arrow spanning Actor 1 to Actor 4, the label will intersect Actor 2 and Actor 3’s vertical lifelines:

```
Actor 1             Actor 2             Actor 3             Actor 4
   |                   |                   |                   |
   |                   |   COLLISION!      |                   |
   +-------------------[ Long Label Text ]-------------------->| (pos=0.5 strikes Actor 2 & 3)
```

**Architectural Solutions:**
1. **Lane-Restricted Label Placement (`pos`, `anchor`)**:  
   Anchor the label strictly within the initiating or terminating actor’s immediate lane:
   ```latex
   \draw[pd arrow] (Actor1 |- t1) -- (Actor4 |- t1)
     node[pos=0.18, above, anchor=south west] {\texttt{broadcast(msg)}};
   ```
2. **Opaque Segmenting**: If an arrow must cross intermediate lifelines, ensure the label has `fill=pdpage` and `inner xsep=4pt, inner ysep=2.5pt` to cleanly mask the intersected lifeline.

---

## 3. Sequence Diagrams and Causal Timelines in Pure TikZ

### 3.1 Layout Architecture: Coordinate Registers & Intersection Syntax

In publication engines (e.g., Port Daddy / Harbor research), **pure TikZ with intersection coordinate registers** is the superior, maintenance-free pattern.

The fundamental primitive is TikZ's coordinate intersection syntax:
$$\mathtt{(P\ |- \ Q)}$$
This evaluates to the coordinate sharing the **x-coordinate of $P$** (actor lifeline rail) and the **y-coordinate of $Q$** (time step register).

### 3.2 Formal Sequence Diagram Conventions (Harbor Doctrine)

1. **Slender Activation Boxes Over Prose Rectangles**: Never impale a lifeline on a wide prose rectangle. An activation box must be $2.0\,\text{mm}$ to $2.5\,\text{mm}$ wide. Idle participants carry bare hairlines.
2. **Reflex Self-Messages**: A participant executing internal computation draws an orthogonal out-and-back loop (`-- ++(dx,0) -- ++(0,-dy) -- ++(-dx,0)`) on the right side of its activation box.
3. **Region Dividers Before Marks**: Environmental transitions (e.g. transitioning from online authority to local offline verification) are drawn as shaded background bands spanning the full diagram width (`\draw[fill=sand!20] (x0, y_top) rectangle (x1, y_bot);`) **before** lifelines and messages are stroked.
4. **Arrowhead Stand-off (`shorten >`)**: Stop arrowheads $1.2\,\text{mm}$ to $1.6\,\text{mm}$ short of the target activation box. Direct contact produces visual ink pooling at print resolutions.

---

## 4. PGFPlots Annotation and Collision Handling

### 4.1 Coordinate Systems Architecture

PGFPlots operates four distinct coordinate systems:
1. `axis cs:(x,y)`: Physical data coordinates. (Default in PGFPlots $\ge 1.11$).
2. `rel axis cs:(x,y)`: Dimensionless unit square coordinates $[0,1] \times [0,1]$, where $(0,0)$ is axis bottom-left, $(1,1)$ is axis top-right. Ideal for watermark regions or quadrant backgrounds.
3. `axis description cs:(x,y)`: Canonical space for titles and axis labels. Accounts for axis dimensions while decoupling label placement from data domains.
4. `ticklabel cs:(x)`: Dynamically positioned beyond tick numerals, ensuring axis titles never collide with wide tick numbers.

### 4.2 Clipping Mechanics: The `clip=true` vs `clip=false` Dilemma

* **Default Behavior (`clip=true`)**: PGFPlots clips all drawing commands to the inner plot frame $([x_{min}, x_{max}] \times [y_{min}, y_{max}])$. Any label, marker, or callout placed near the boundary is sliced off.
* **Naive Unclipping (`clip=false`)**: If `clip=false` is set globally, asymptotic curves (e.g. $1/(1-x)$ as $x \to 1$) shoot past the plot frame across the entire LaTeX page, triggering severe PDF mediabox boundary defects.
* **Robust Solution**: Set `clip mode=individual`. Clip divergent plot lines by bounding their analytical `domain`, while leaving annotation nodes unclipped:
```latex
\begin{axis}[
  clip mode=individual,
  % Global settings...
]
  % Curves are explicitly clipped or bounded by domain
  \addplot[clip=true, domain=0.18:0.72] {1 - 2*x/(1-x)};
  
  % Endpoint labels sit outside the plot frame without getting sliced
  \node[anchor=west, clip=false] at (axis cs:0.72,-3.5) {$\kappa \to \infty$};
\end{axis}
```

---

## 5. Authoritative Production Reference Card

Adhere to these five operational invariants:

| # | Invariant | Rule Definition | Mechanized QA Gate |
|---|---|---|---|
| **1** | **The Content Box Floor** | Never declare `text width` without `align=center` or `align=left`. Enforce `inner ysep \ge 4.5pt` on multi-line text to clear descenders. | `check_figure_clearance.py` BOX_MARGIN_DEFICIT |
| **2** | **Knockout Discipline** | Edge labels sharing path space must use `fill=pdpage` with `inner sep \ge 2.5pt` or `\contour{bg}{text}`. Never let raw ink strike through glyphs. | `check_figure_clearance.py` STROKE_COLLISION |
| **3** | **Vertical Monotonicity** | In sequence diagrams, time steps must decrement monotonically ($y_{i+1} \le y_i - \Delta y_{min}$, where $\Delta y_{min} \ge 0.9\,\text{cm}$) using named coordinate registers. | `check_figure_clearance.py` TEXT_COLLISION |
| **4** | **Unclipped Gutter Bounds** | In PGFPlots, use `clip mode=individual` or analytically bounded `domain` limits to allow curve labels into the right gutter without overflowing the page. | `figcheck.py` T5 (MediaBox Overflow) |
| **5** | **Absolute Dash Metrics** | Never use relative dash keys (`densely dotted`). Use explicit metric declarations (`dash pattern=on 1.2pt off 2.0pt`) so rasterizers resolve lines above the Nyquist limit at 150 DPI. | `figcheck.py` T9 (Dash Resolution) |
