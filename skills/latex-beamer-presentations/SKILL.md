---
name: latex-beamer-presentations
description: >-
  Author or revise Beamer slide decks, including frames, overlays, fragile
  content, aspect ratio, handout mode, and slide readability. Use for a .tex
  presentation. NOT for articles, books, whitepaper publication, generic
  compile failures, or standalone TikZ figures.
license: Apache-2.0
metadata:
  category: Writing
  tags: [latex, beamer, presentations]
  pairs-with: [latex-build-diagnostics, tikz-figure-engineering]
---

# LaTeX Beamer Presentations

A slide is read from a distance and in sequence. Keep one claim per frame,
use readable type, and make overlays reveal an argument rather than conceal
content needed to understand the current frame.

## Workflow

1. Set the required aspect ratio, normally `\documentclass[aspectratio=169]{beamer}`.
2. Outline the talk as claims and transitions before constructing frames.
3. Use a stable theme, restrained color, and a small number of text levels.
4. Use overlays only when each revealed state is coherent on its own.
5. Mark frames containing verbatim-like content as `fragile`.
6. Build both the presentation and handout variant if handouts are delivered.
7. Inspect projected-size and PDF views for clipped labels and excessive text.

`templates/beamer.tex` is a source starting point.
`references/beamer.md` contains frame, overlay, theme, and handout details.
Use `latex-build-diagnostics` for compiler and log failures. Use
`tikz-figure-engineering` when a slide contains a technical figure whose
geometry carries a claim.

## Quality gate

- The title and key mark remain legible at the intended viewing distance.
- A reveal does not strand a label, legend, or cross-reference.
- No figure is simply scaled until its text becomes unreadable.
- The handout retains the complete argument without relying on animation.
