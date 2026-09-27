# TikZ / PGF Reference

## Core Idioms

```latex
\usepackage{tikz}
\usetikzlibrary{positioning, arrows.meta, calc, fit, backgrounds}

\begin{tikzpicture}[
  node distance = 8mm and 12mm,          % vertical and horizontal
  box/.style  = {draw, rounded corners, minimum width=2.2cm, minimum height=8mm, align=center},
  arr/.style  = {-{Stealth[length=2.5mm]}, thick},
]
  \node[box] (a) {Input};
  \node[box, right=of a] (b) {Process};
  \node[box, right=of b] (c) {Output};
  \draw[arr] (a) -- (b);
  \draw[arr] (b) -- (c) node[midway, above] {\small transform};
\end{tikzpicture}
```

Expert habits that keep TikZ maintainable:

- **`positioning` library + relative placement** (`right=of a`) — never hardcode
  coordinates for node layouts. Hardcoded `(4,0)` diagrams break the moment a label
  changes width.
- **Styles in the picture (or preamble via `\tikzset`)** — one `box/.style` edit restyles
  the whole diagram. Inline styling on every node is the novice tell.
- **`arrows.meta`**, not the deprecated `arrows` library (`-{Stealth}` not `->` with
  `>=stealth` if you want modern tips; plain `->` is fine for quick work).
- Name every node; connect by name, with `.north`/`.south east` anchors when edges crowd.
- `calc` library for midpoints/offsets: `($(a)!0.5!(b)$)`.
- Loops: `\foreach \i in {1,...,5} { \node ... }` — never copy-paste five nodes.

## Standalone Figures

For any nontrivial figure, build it as its own document with the `standalone` class —
fast iteration, reusable PDF, and the main doc just `\includegraphics{fig/foo.pdf}`:

```latex
\documentclass[tikz, border=2pt]{standalone}
\usetikzlibrary{positioning}
\begin{document}
\begin{tikzpicture} ... \end{tikzpicture}
\end{document}
```

## Externalization (slow builds)

TikZ recompiles every picture on every pass. For documents with many pictures:

```latex
\usetikzlibrary{external}
\tikzexternalize[prefix=build/tikz/]     % dir must exist
```

Requires `-shell-escape` on the compile. Caveats: fragile with `\ref` inside pictures
(use `\tikzexternaldisable` around those), and stale caches cause "my edit didn't show
up" confusion — wipe the prefix dir when in doubt. Standalone-figure workflow is usually
the better answer than externalization.

## pgfplots (data plots)

```latex
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}    % ALWAYS set compat, or axes render with 2010 defaults

\begin{tikzpicture}
\begin{axis}[xlabel={epoch}, ylabel={loss}, width=.7\linewidth,
             legend pos=north east, grid=major]
  \addplot table[x=epoch, y=loss, col sep=comma] {data/train.csv};
  \addplot table[x=epoch, y=val,  col sep=comma] {data/train.csv};
  \legend{train, validation}
\end{axis}
\end{tikzpicture}
```

- Plot from CSV files with `table` — never inline coordinate dumps for real data.
- `groupplots` library for panel grids; `\begin{semilogyaxis}` for log scales.
- If a plot has >5k points, pgfplots gets slow and `! Dimension too large` appears —
  downsample the CSV or render that figure with matplotlib and `\includegraphics` it.

## Common TikZ Errors

| Symptom | Cause |
|---|---|
| `! Package tikz Error: Giving up on this path` | missing `;` at end of a `\draw`/`\node` |
| `! Package pgf Error: No shape named 'x'` | typo in node name, or forward-reference without `remember picture` |
| `! Dimension too large` | coordinate >16383pt — runaway `calc` expression or huge data plot |
| Nothing renders | picture is there but empty: styles resolved to `draw=none`, or `\path` used where `\draw` intended |
| Externalized figure stale | delete the extern prefix dir; check `-shell-escape` is on |
