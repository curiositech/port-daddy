#!/bin/bash
# Run multi-pass LaTeX build

cd whitepaper

docker run --rm -v $(pwd):/data -w /data pandoc/latex:latest \
  pdflatex -interaction=nonstopmode single-writer-kernel.tex
pdflatex -interaction=nonstopmode single-writer-kernel.tex

cat single-writer-kernel.log | grep -E 'Overfull|Underfull|Warning' && exit 1

cd ..

echo 'LaTeX build validation passed'