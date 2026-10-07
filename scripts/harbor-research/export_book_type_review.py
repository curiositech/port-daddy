#!/usr/bin/env python3
"""Extract the typography review from the assembled Swiss Book, never chapter PDFs.

Usage: python3 scripts/harbor-research/export_book_type_review.py BOOK.pdf REVIEW.pdf
The Book's .aux file must sit beside the PDF. All selections follow current
labels and bookmarks, so repagination cannot silently change the witnesses.
Review links into omitted pages are deliberately removed; use the full Book
to check navigation. Four PNG witnesses are written beside the review PDF.
"""
import argparse
import json
from pathlib import Path

import fitz


def tex_groups(text):
    """Read nested/escaped TeX groups without confusing a title with an anchor."""
    groups, depth, start, escaped = [], 0, None, False
    for index, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "{":
            if depth == 0:
                start = index + 1
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                groups.append(text[start:index])
            if depth < 0:
                raise ValueError("Unbalanced TeX groups")
    if depth:
        raise ValueError("Unclosed TeX group")
    return groups


def export_review(source, destination):
    if source.resolve() == destination.resolve():
        raise ValueError("The review must not overwrite the assembled Book")
    with fitz.open(source) as book, fitz.open() as proof:
        aux = source.with_suffix(".aux").read_text()
        outline = book.get_toc()
        destinations = book.resolve_names()

        def page_for_label(key):
            line = next((line for line in aux.splitlines()
                         if line.startswith("\\newlabel{" + key + "}")), None)
            if line is None:
                raise ValueError(f"Missing assembled Book label: {key}")
            fields = tex_groups(tex_groups(line)[1])
            # Folios 1–3 also occur on unnumbered cover matter. The named PDF
            # destination, not the first matching folio, identifies the page.
            page = destinations[fields[3]]["page"]
            if book[page].get_label() != fields[1]:
                raise ValueError(f"Unconverged PDF/aux destination for {key}")
            return page

        toc_start = next(row[2] - 1 for row in outline if row[1] == "Contents")
        intro = next(row[2] - 1 for row in outline
                     if "Introduction: The Unit of Account" in row[1]
                     or "Introduction: the unit of account" in row[1]
                     or "Part I" in row[1]
                     or row[1].startswith("0 Foundations"))
        chapter = page_for_label("chap:swk")
        maya = page_for_label("ls:fig:split-ranker")
        left, right = (page_for_label("book:reader-" + side) for side in ("left", "right"))
        pages = [(0, "Cover: shared sans display"), (left, "Reader map: prose starts left"),
                 (right, "Reader map: continuation right")]
        pages += [(i, f"Complete contents: {book[i].get_label()}") for i in range(toc_start, intro)]
        manifest = json.loads((Path(__file__).resolve().parents[2] / "whitepaper/textbook.json").read_text())
        chapters = {item["id"]: item for item in manifest["chapters"]}
        for part in manifest["parts"]:
            start = page_for_label("part:" + part["numeral"])
            pages += [(start, f"Part {part['numeral']}: opening art"),
                      (start + 1, f"Part {part['numeral']}: facing chapter guide")]
            pages += [(page_for_label("chap:" + chapters[key]["prefix"]),
                       "Chapter opening: " + chapters[key]["title"]) for key in part["chapters"]]
        pages.append((chapter + 2, "Continuous prose: shared sans"))
        pages += [(i, f"Maya: book page {book[i].get_label()}") for i in range(maya - 1, maya + 2)]

        seen, bookmarks, labels = set(), [], []
        for index, title in pages:
            if index in seen:
                continue
            seen.add(index)
            proof.insert_pdf(book, from_page=index, to_page=index, links=False)
            bookmarks.append([1, title, len(proof)])
            labels.append({"startpage": len(proof) - 1, "prefix": book[index].get_label()})
        proof.set_toc(bookmarks)
        proof.set_page_labels(labels)
        proof.set_metadata({"title": "Book sans, contents, and Maya — visual proof",
                            "creator": book.metadata.get("creator", ""),
                            "subject": "Excerpt from the assembled Book; use the full Book for navigation links."})
        proof.save(destination, garbage=4, deflate=True)
        for key, index in [("reader-left", left), ("contents-first", toc_start),
                           ("chapter-opening", chapter), ("maya-slopegraph", maya)]:
            book[index].get_pixmap(dpi=130).save(destination.with_name(key + ".png"))
        print(f"{len(proof)} review pages from {len(book)} assembled Book pages: {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("book", type=Path)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    export_review(args.book, args.review)
