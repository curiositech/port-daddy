#!/bin/bash
texlivebuild ../../website-v2/public/whitepaper/coordination-papers-mega-frontmatter.tex
if [ $? -ne 0 ]; then
  echo "TeX build failed"
  exit 1
fi
PAGE_COUNT=$(pdfinfo output.pdf | grep Pages | awk '{print $2}')
if [ $PAGE_COUNT -ne 247 ]; then
  echo "Page count mismatch: expected 247, got $PAGE_COUNT"
  exit 1
fi
exit 0