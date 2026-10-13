# Scripts Index

This directory contains the automation tooling for figure style validation:

- [check_figure_clearance.py](check_figure_clearance.py): Standalone CLI tool that audits vector stroke intersections, container overlaps, and text margin clearance.
- [check_figure_style.py](check_figure_style.py): Standalone CLI tool that checks TikZ source code and rendered PDF geometry against style rules.
- [compile_fragment.sh](compile_fragment.sh): Standalone compilation wrapper for compiling bare TikZ fragments against the Book preamble.
