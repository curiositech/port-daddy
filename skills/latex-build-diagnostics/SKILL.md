---
name: latex-build-diagnostics
description: >-
  Compile and troubleshoot a LaTeX document or project: select the available
  compiler, read the first log error, resolve references and citations, and
  verify rendered output. Use for build, render, install-status, or TeX log
  questions. NOT for source writing, Beamer composition, figure semantics,
  or a repository's committed-PDF registry and publication process.
license: Apache-2.0
metadata:
  category: Tooling
  tags: [latex, compile, tectonic, latexmk, diagnostics]
  pairs-with: [latex-authoring, latex-whitepaper-engineering]
---

# LaTeX Build and Diagnostics

Use the smallest build path that matches the artifact and its toolchain.
A successful process exit is not enough: read the log for undefined citations,
references, missing glyphs, and overfull material, then inspect the PDF page.

## Choose the path

| Artifact | Build path |
|---|---|
| Standalone `.tex` document opened in Codex | Save it and use the built-in editor and `compile_latex_document`; inspect diagnostics and preview. No local TeX installation is required. |
| Existing multi-file project | Use the repository's pinned build script or `latexmk` with its required engine and output directory. |
| Simple project with Tectonic available | Use Tectonic with an explicit output directory when the project needs no unsupported external pass. |
| Committed PDF with metadata registry | Use `latex-whitepaper-engineering` and the repository's pinned publication pipeline. |

A plugin's `latex-compile` script may detect Tectonic and a TeX Live fallback;
its `latex-doctor` script tests installed runtimes. Resolve the installed
plugin path at execution time. A staged marketplace path is transient and
must not be copied into a skill. Do not install a TeX toolchain to use the
Codex standalone editor.

## Project build

For a conventional TeX Live project, `latexmk` owns repeated passes and
bibliography execution. Prefer `-halt-on-error`, an explicit engine, and an
output directory. Do not run fixed pass counts as a generic rule; follow a
repository's pinned recipe when it differs. Tectonic can compile a simple
project directly, but a bibliography, index, shell escape, custom engine, or
publisher's pinned output may require the full project toolchain.

## Diagnose from the first error

1. Locate the first `!` or file-line error in the `.log`. Later errors may be
   consequences of the first.
2. Identify the source file and line, then inspect nearby braces, math mode,
   alignment tabs, and package load order.
3. Fix one cause, rebuild, and read the new first error.
4. Check warnings after a clean build: undefined labels/citations, missing
   glyphs, large overfull boxes, and a stale bibliography.
5. Inspect affected pages at final size. A clean log does not prove readable
   typography or uncropped figures.

`references/debugging.md` carries the longer error catalog and minimization
techniques. If no compiler is available for a multi-file project, report the
missing runtime and preserve the source; do not claim compilation.
