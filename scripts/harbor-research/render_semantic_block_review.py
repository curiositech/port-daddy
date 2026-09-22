#!/usr/bin/env python3
"""Extract actual Book pages for semantic-style review, not automatic approval."""
import argparse
import json
from pathlib import Path
import re

import fitz


def render(pdf, output):
    output.mkdir(parents=True, exist_ok=True)
    patterns = {
        "definition": r"Definition\s+\d+\.\d+",
        "property": r"(?<!checked )Property\s+\d+\.\d+",
        "theorem": r"Theorem\s+\d+\.\d+",
        "hypothesis": r"Empirical\s*hypothesis\s+\d+",
        "invariant": r"Design\s*invariant\s+\d+",
        "model-checked": r"Model.checked\s*property\s+\d+",
        "numbers": r"Numbers by hand",
        "sparkline": r"Three.round model: net gain",
        "comparison": r"Nor is the pattern new in normative conflict",
        "authentication-equation": r"Authentication correspondence in the modeled phase",
        "rate-equation": r"one term per cell",
        "succession-equation": r"The price of the succession rule",
        "visible-topology": r"The auditor loses the DEF cycle",
        "rate-regime": r"zero.rate boundary enters at",
        "terminal": r"Error: Invariant RevocationFinal is violated",
    }
    selected = {}
    with fitz.open(pdf) as book, fitz.open() as review:
        for name, pattern in patterns.items():
            for number in range(30, len(book)):
                page = book[number]
                text = " ".join(page.get_text().split())
                if re.search(pattern, text, re.IGNORECASE):
                    selected[name] = {"pdf_page": number + 1, "folio": page.get_label()}
                    break
        # Equations must resolve to their own labels, not an earlier prose
        # mention of the title. Match printed page labels from the same aux.
        aux = pdf.with_suffix(".aux").read_text()
        for name, label in {
            "authentication-equation": "anchor:thm:injective",
            "rate-equation": "ls:eq:pinned-rate",
            "succession-equation": "he:thm:succession-price",
            "visible-topology": "fh:fig:fh-visible-topology",
            "rate-regime": "ls:fig:rate-regime",
        }.items():
            match = re.search(r"\\newlabel\{" + re.escape(label) +
                              r"\}\{\{[^}]*\}\{([^}]+)\}", aux)
            if match:
                for number, page in enumerate(book):
                    if page.get_label() == match[1]:
                        selected[name] = {"pdf_page": number + 1,
                                          "folio": page.get_label(), "label": label}
                        break
        pages = sorted({record["pdf_page"] - 1 for record in selected.values()})
        # Include both sides of the citation-heavy comparison's new break.
        if "comparison" in selected:
            number = selected["comparison"]["pdf_page"] - 1
            pages = sorted(set(pages) | {max(0, number - 1), number})
        for number in pages:
            book[number].get_pixmap(matrix=fitz.Matrix(1.6, 1.6)).save(
                output / f"page-{number+1:03}.png")
            review.insert_pdf(book, from_page=number, to_page=number)
        review.save(output / "semantic-review.pdf")
    report = {"source": str(pdf.resolve()), "selected": selected,
              "missing": sorted(set(patterns) - set(selected)),
              "scope": "Candidate pages selected by text; each requires visual inspection. Text matches can include prose references."}
    (output / "selection.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    render(args.pdf, args.output)
