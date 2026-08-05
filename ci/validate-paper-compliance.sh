#!/bin/bash
for paper in papers/*.tex; do
  pdflatex -halt-on-error -file-line-error --output-directory=build \"\usepackage{magnolia} \input{$paper}\" || exit 1
done