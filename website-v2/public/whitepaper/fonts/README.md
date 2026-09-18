# Book type assets

The Swiss edition uses **Source Serif 4** for an editorial, serif-led reading
system inside the Book's Swiss grid. The text cut carries continuous prose;
the Caption cut has stronger small-size detail for marginalia and diagrams;
the Display cut carries large chapter and part titles. Real Semibold is the
bold role. Source Sans 3 is reserved for explicitly sans interface material;
Source Code Pro remains the literal/code face supplied by the TeX bundle.

These are unmodified OpenType files under the SIL Open Font License 1.1.
Each directory includes its upstream license and copyright notice. Loading
uses repository-relative filenames, not fonts installed on the build host.

| Assets | Upstream | Pinned revision |
|---|---|---|
| `source-serif/` | [Adobe Source Serif](https://github.com/adobe-fonts/source-serif) | `80d3f8894c09c937bebfa9011247d2e1c79fd6f4` |
| `source-sans/` | [Adobe Source Sans](https://github.com/adobe-fonts/source-sans) | `87b37a2daaed80fcb8e8ccb0085c4d72ddade12e` |

Files come from each revision's `OTF/` directory; licenses come from
`LICENSE.md`. Regular, Italic (`It`), Semibold, and Semibold Italic are the only
weights shipped. Serif includes Text, Caption, and Display cuts. No variable
font instancing, synthetic styles, or renamed derivatives are used.

The mathematical symbol and Greek fonts remain `newpxmath`; explicit math
text, operators, and numerals use the new serif. This preserves the established
proof notation while its compatibility is checked on rendered pages.

IBM Plex Serif and Newsreader were compared at the Book's text and caption
sizes. Plex's technical character is useful, but its available small-cap
coverage did not fit the existing apparatus. Newsreader is a warm editorial
alternative; Source's small optical cut and denser, sturdier labels make it
the better first implementation for this particular Book.
