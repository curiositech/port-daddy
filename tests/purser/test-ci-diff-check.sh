#!/bin/bash

# Check CI workflow for diff detection logic
if grep -q 'git status --porcelain' .github/workflows/whitepaper-build.yml; then
  echo 'CI diff check passed'
  exit 0
else
  echo 'CI diff check failed: missing git status check'
  exit 1
fi