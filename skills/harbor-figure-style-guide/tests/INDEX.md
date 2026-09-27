# Tests Index

This directory contains test suites verifying the correctness of the figure style tooling:

- [test_all_diagram_families.py](test_all_diagram_families.py): Integration tests auditing style and clearance across all canonical diagram family templates.
- [test_check_figure_style.py](test_check_figure_style.py): Unit tests for `check_figure_style.py`, validating detection of small fonts, serif leaks, raw colors, oversized measure, and banned chart types.
