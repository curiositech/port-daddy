# Beamer Reference

## Skeleton

```latex
\documentclass[aspectratio=169, 11pt]{beamer}   % 169 = 16:9; default 4:3 looks dated
\usetheme{metropolis}        % modern; classic alternatives: Madrid, Frankfurt (avoid Warsaw-era chrome)
\setbeamertemplate{navigation symbols}{}        % kill the useless nav bar
\title{Talk Title}
\author{Name}
\date{\today}

\begin{document}
\begin{frame}\titlepage\end{frame}

\begin{frame}{Section Header}{optional subtitle}
  content
\end{frame}
\end{document}
```

## Overlays (incremental reveal)

| Command | Effect |
|---|---|
| `\pause` | everything after appears on next click |
| `\item<2->` | item appears from slide 2 of the frame onward |
| `\only<2>{x}` | x exists ONLY on slide 2 (takes no space otherwise — layout shifts) |
| `\onslide<2->{x}` | x invisible before slide 2 but reserves its space (no shift) |
| `\alt<2>{a}{b}` | a on slide 2, b otherwise |
| `\alert<2>{x}` | x highlighted on slide 2 |

Rule: prefer `\onslide` over `\only` inside body text — `\only` reflows the frame between
clicks, which reads as jumpy. `\only` is right for swapping figures in place.

`\begin{itemize}[<+->]` makes every item incremental without per-item annotations.

## The Fragile Trap

Any frame containing verbatim content (`verbatim`, `lstlisting`, `minted`, some `tikz`
externalization) **must** be declared fragile:

```latex
\begin{frame}[fragile]{Code}
\begin{lstlisting}[language=Python]
def f(x): return x
\end{lstlisting}
\end{frame}
```

Forgetting `[fragile]` produces the classic incomprehensible
`! Paragraph ended before \lst@next was complete` — the error message never mentions
fragility. This is the #1 beamer support question.

## Frame Options Worth Knowing

- `[allowframebreaks]` — auto-split overlong frames (references slide); use sparingly.
- `[plain]` — no header/footer (full-bleed images).
- `[shrink=10]` — last-resort content squeeze; a design smell, split the frame instead.
- `[standout]` (metropolis) — big centered statement slide.

## Structure & Content Discipline

- Frame ≈ one idea, ≤ ~5 bullets. Beamer makes it easy to write walls of bullets; don't.
- `\begin{columns}[T] \begin{column}{.55\textwidth}...` for figure+text layouts. `[T]`
  top-aligns — the default vertical centering misbehaves with tall figures.
- `block`/`alertblock`/`exampleblock` environments for callouts, matching the theme.
- Backup slides after `\appendix`; use `\againframe` to re-show an earlier frame in Q&A.

## Handouts & Notes

```latex
\documentclass[aspectratio=169, handout]{beamer}   % collapses all overlays to one slide
```

- `handout` mode + `pgfpages` (`\pgfpagesuselayout{4 on 1}[a4paper,landscape]`) for
  printable decks.
- Speaker notes: `\note{...}` after a frame plus `\setbeameroption{show notes on second
  screen=right}`; present with pympress or Skim's presenter mode.

## Beamer-Specific Gotchas

| Symptom | Cause |
|---|---|
| `Paragraph ended before \lst@next...` | missing `[fragile]` |
| Overlay numbers off by one | `\pause` interacts with `<+->` counters; pick one mechanism per frame |
| Theme fonts ignored | metropolis wants XeLaTeX/LuaLaTeX for Fira; under pdfLaTeX it falls back silently |
| Bibliography frame overflows | `[allowframebreaks]` on the references frame |
| Section slides missing | `\AtBeginSection` template not set; metropolis provides one via `\metroset{sectionpage=progressbar}` |
