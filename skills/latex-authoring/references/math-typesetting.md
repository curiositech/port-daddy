# Math Typesetting Reference

Load `mathtools` (which loads and patches `amsmath`), plus `amssymb` for symbol coverage
and `amsthm` for theorem environments.

## Choosing the Display Environment

| Need | Environment |
|---|---|
| One equation, numbered | `equation` |
| One equation, no number | `\[ ... \]` or `equation*` |
| Several equations aligned at `=` | `align` — alignment points at `&`, rows end `\\` |
| Several centered, no alignment | `gather` |
| One equation too long for a line | `multline` (first line left, last right) |
| Aligned block as ONE numbered unit | `split` inside `equation` |
| Sub-numbered group (1a, 1b, ...) | `subequations` wrapping `align` |
| Cases | `cases` (in text-size) or `dcases` (mathtools, display-size fractions) |
| Matrix | `pmatrix`/`bmatrix`/`vmatrix`; `bsmallmatrix` (mathtools) inline |

Rules that prevent 90% of math-mode errors:

- **No blank lines** inside any math environment — `! Paragraph ended before \align was complete`.
- Suppress one row's number with `\nonumber` (or `\notag`), the whole environment with the
  starred form.
- Punctuate displayed equations as part of the sentence (comma/period inside the display).
- `aligned`/`gathered` are the *inner* building blocks when you need alignment inside
  something else (e.g., a `cases` branch).

## Operators, Macros, Semantic Discipline

```latex
\DeclareMathOperator{\argmax}{arg\,max}    % upright, correct spacing
\DeclareMathOperator*{\esssup}{ess\,sup}   % * = limits go underneath in display
\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}   % \abs*{x} auto-sizes (mathtools)
\DeclarePairedDelimiter{\norm}{\lVert}{\rVert}
\newcommand{\R}{\mathbb{R}}
\newcommand{\E}[1]{\mathbb{E}\left[#1\right]}
```

- Built-in operators exist for most needs: `\max`, `\log`, `\sup`, `\lim`, `\det`. Writing
  `max` bare in math mode renders as $m \cdot a \cdot x$ in italic — a classic tell.
- `\left(`/`\right)` everywhere is a novice tell: they add space and can't break across
  lines. Use them only when contents are actually tall; prefer `\bigl(` `\bigr)` grades or
  paired-delimiter macros with `*`.
- Bold math: `\bm{...}` (package `bm`) or `\mathbf` for upright Latin only. Vectors:
  pick one convention (`\bm{x}` or `\vec{x}`) and macro-ize it: `\newcommand{\vx}{\bm{x}}`.
- Differential: `\,\mathrm{d}x` — or define `\newcommand{\dd}{\,\mathrm{d}}`.
- `\dots` chooses height by context; `\cdots` between operators, `\ldots` between commas.

## Theorems (amsthm)

```latex
\theoremstyle{plain}       % italic body: theorems, lemmas, propositions
\newtheorem{theorem}{Theorem}[section]     % numbered within section
\newtheorem{lemma}[theorem]{Lemma}         % shares theorem's counter
\theoremstyle{definition}  % upright body: definitions, examples
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem*{remark}{Remark}               % unnumbered
```

- Share one counter across theorem-like environments (the `[theorem]` optional arg) —
  "Lemma 3.2 followed by Theorem 3.3" reads better than parallel counters.
- `proof` environment supplies the QED square; if the proof ends in a displayed equation,
  put `\qedhere` inside the display to avoid a dangling square.

## Common Math Errors

| Symptom | Cause |
|---|---|
| `! Missing $ inserted` | `_`, `^`, `\alpha` etc. outside math mode (often in captions/section titles — these travel to the ToC; use `\texorpdfstring{$\alpha$}{alpha}` with hyperref) |
| `! Display math should end with $$` | `\]` missing, or blank line inside `\[...\]` |
| Equation number overlaps equation | line too long — break with `split`/`multline` |
| Italic "words" in equations | forgot `\text{...}` or `\DeclareMathOperator` |
| `! Double superscript` | `x^a^b` — brace it: `x^{a^b}` |
| Spacing wrong around `:=` | use `\coloneqq` (mathtools) |
