# TikZ Figure Language Quick Reference

This cheat-sheet provides a rapid lookup of the styles, macros, and color tokens defined in `figures/pd-figure-language.tex` (version 2). Use these standard styles rather than declaring custom or inline TikZ options.

---

## 1. Typographic Roles

| TikZ Style / Macro | Output Appearance | Usage Context |
|---|---|---|
| `pd title` | Bold, `\bfseries`, base label size | Panel headers, actor lifeline tops, column titles |
| `pd label` | Upright, regular weight, base size | Node text, state names, axis labels |
| `pd note` | Italic, `\itshape`, base size | Single allowable explanatory aside per figure |
| `pd tag` | White knockout text on solid ground | Text crossing an arrow, grid line, or rule |
| `pd kind` | Small-caps tag (`\scshape`) | Category indicators (e.g. `PROTOCOL`, `KERNEL`) |
| `\pdfiglabelsize` | `\footnotesize` (8.72 pt in Book) | Master font size macro; inherited by all roles |

*Note:* Never use `\tiny`, `\scriptsize`, `\Large`, or manual `\fontsize{...}` inside nodes.

---

## 2. Concept Hue Tokens

| Concept Role | Semantic Meaning | Color Token | Visual Accent |
|---|---|---|---|
| `pd focus ...` | Current chapter's primary subject | `\pdcurrentchaptercolor` | Solid edge (1.6 pt), 24% tinted fill |
| `pd truth` | Authoritative ground truth / kernel | `pdcobalt` (Reflex Blue) | Crisp cobalt rule |
| `pd legible` | Inspection, supervisory digest | `pdteal` (Deep Teal) | Teal outline / fill |
| `pd ready` | Admitted, verified, passing test | `pdhealth` (Forest Green) | Solid green border |
| `pd protocol` | Federation, wire communication | `pdindigo` (Indigo) | Indigo lifeline or arrow |
| `pd identity` | Agent card, cryptographic ID | `pdviolet` (Konkret Violet) | Violet box or badge |
| `pd reputation` | Historical underwriting, trust | `pdrust` (Warm Rust) | Rust rule or label |
| `pd value` | Escrow settlement, currency | `pdgold` (Ochre Gold) | Gold balance box |
| `pd breach` | Violation, refusal, revocation | `pderror` (Swiss Red) | **Dashed stroke**, diamond markers |
| `pd warn` | Spend cap, hazard perimeter | `pdamber` (Mustard Amber) | **Dashed stroke** (rules only, never text) |

---

## 3. Weight Ladder Styles

| Style | Stroke Width | Primary Application |
|---|---|---|
| `pd hairline` / `pd guide` | `0.5 pt` | Modular grid guides, coordinate ticks, badge borders |
| `pd rule` / `pd state` | `0.9 pt` | Standard arrows, messages, neutral state enclosures |
| `pd spine` / `pd focus rule` | `1.6 pt` | Focus sequence arrows, primary causal path, focus states |

---

## 4. Node & Surface Styles

| Style | Border / Fill | Semantic Role |
|---|---|---|
| `pd state` | 0.9 pt ink border, white fill | Base neutral state or system actor |
| `pd artifact` | 0.5 pt grey border, white fill | Subordinate document, log, or data record |
| `pd focus state` | 1.6 pt chapter-hue border, 24% tint | Active subject of the diagram |
| `pd climax state` | Solid chapter-hue fill, white text | Decisive end state or verified commit |
| `pd terminal` | Double border or solid fill | Categorically final terminal state |
| `pd panel` | 0.5 pt dashed grey border, no fill | Enclosing group / subsystem container |
| `pd trust boundary` | 0.9 pt dashed red/amber border | Isolation boundary / security perimeter |
| `pd bucket` | U-shaped vessel outline | Escrow pool or credit reservoir |
| `pd pipe` | Parallel lines with flow direction | Channel connecting two reservoirs |

---

## 5. Sequence Diagram Lifeline Idiom

```latex
% Standalone fallback hue
\pdfigurehue{pdcobalt}

\begin{tikzpicture}[pd figure, x=1cm, y=1cm]
  \useasboundingbox (0, 0) rectangle (11.4, 7.0); % 4.5 in single column

  % Lifeline Headers
  \node[pd focus state, text width=2.8cm] (mgr) at (2.0, 6.2) {\textbf{Manager}};
  \node[pd state, text width=2.8cm] (c1) at (6.0, 6.2) {\textbf{Contractor 1}};
  \node[pd state, text width=2.8cm] (c2) at (10.0, 6.2) {\textbf{Contractor 2}};

  % Lifelines
  \draw[pd line] (2.0, 5.6) -- (2.0, 0.8);
  \draw[pd line] (6.0, 5.6) -- (6.0, 0.8);
  \draw[pd line] (10.0, 5.6) -- (10.0, 0.8);

  % Messages
  \draw[pd focus msg] (2.0, 4.8) -- (6.0, 4.8)
    node[pos=0.5, above=2pt, font=\pdfiglabelsize] {1a. CFP Broadcast};
  \draw[pd msg] (2.0, 4.0) -- (10.0, 4.0)
    node[pos=0.5, above=2pt, font=\pdfiglabelsize] {1b. CFP Broadcast};
  \draw[pd focus msg] (6.0, 3.0) -- (2.0, 3.0)
    node[pos=0.5, above=2pt, font=\pdfiglabelsize] {2a. Formal Bid (\$4.20)};
  \draw[pd fail msg] (10.0, 2.2) -- (2.0, 2.2)
    node[pos=0.5, above=2pt, font=\pdfiglabelsize] {2b. Refusal (Overload)};
\end{tikzpicture}
```
