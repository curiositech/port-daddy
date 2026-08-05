#!/bin/bash
REFERENCE_COUNT=$(grep -c '\bibitem{' ../../website-v2/public/whitepaper/coordination-papers-mega-frontmatter.tex)
if [ $REFERENCE_COUNT -ne 202 ]; then
  echo "Reference count mismatch: expected 202, got $REFERENCE_COUNT"
  exit 1
fi
exit 0