# Migrating a fragment from v1 to v2

The v1 names still compile (they are aliases in `pd-figure-language.tex`), so a
fragment can be migrated one at a time. A migrated fragment uses only v2 names
and no raw colours; `grep` below finds what is left.

## Names

| v1 | v2 | note |
|---|---|---|
| `pd row label` | `pd title,anchor=east` | |
| `pd panel title` | `pd title` | |
| `pd axis label` | `pd label` | |
| `pd direct label` | `pd label` in clear space, or `pd tag` on a rule | v1 backed it in cream: the sticker |
| `pd actor` | `pd state` | |
| `pd boundary` | `pd panel` | |
| `pd caution rule / arrow / fill / datum` | `pd breach rule / arrow / fill / datum` | |
| `pd state` (30 % sand) | `pd state` (white) for neutral, `pd focus state` for the subject | pick by role |
| `pd terminal` (double line) | `pd terminal` (1.6 pt edge) | |
| `pd artifact` (sand) | `pd artifact` (white, grey edge) | |
| `pd focus …` (always teal) | `pd focus …` (chapter hue) | teal is now `pd legible` |
| `pd neutral fill` (sand) | `pd neutral fill` (warm grey) | |

## Raw colours

| found in v1 fragments | replace with |
|---|---|
| `hhteal`, `pdteal`, teal tints | `pd legible …` or `pd focus …` (Part II) |
| `hhcobalt`, `pdcobalt`, `blue!…` | `pd truth …` or `pd focus …` (Part I) |
| `hhamber`, `pdamber`, `orange` | `pd warn rule` (never text) or `pd breach …` |
| `red`, `pderror`, `hhmayday` | `pd breach …` |
| `pdviolet` | `pd identity …` or `pd focus …` (Part III) |
| `pdgold` | `pd value …` or `pd focus …` (Part IV) |
| `hhsand`, `hhpaper`, `pdcream…` as fills | nothing (white) or `pd neutral fill` |
| `hhgray`, `gray!…` | `pd hairline`, `pd guide`, `pd note` |
| `hhink`, `black` | `pd rule` (ink is the default text colour) |

## Mechanics

| v1 habit | v2 |
|---|---|
| `\resizebox{…}{!}{…}` | remove; redraw to 11.4 cm |
| `font=\scriptsize`, `\tiny`, `\fontsize{6}` | remove; `pd figure` sets `\footnotesize` |
| `-{Stealth[length=2mm]}` inline | `->` (the tip comes from `pd figure`) |
| `line width=` inline | a weight role (`pd hairline`, `pd rule`, `pd spine`) |
| a prose paragraph node under the picture | a ruled `tabular` legend in the figure environment, or the caption |

## What is left

```bash
grep -nE 'hh(teal|cobalt|amber|sand|paper|gray|ink)|\b(red|blue|green|orange|gray|black)!|resizebox|scriptsize|\\tiny|pd (row label|direct label|axis label|actor|boundary|caution)' FRAGMENT.tex
```
