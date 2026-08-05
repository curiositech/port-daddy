#!/bin/bash

# Check GitHub Actions workflow for Node.js setup
if grep -q 'actions/setup-node@v4' .github/workflows/whitepaper-build.yml; then
  echo 'Node.js setup check passed'
  exit 0
else
  echo 'Node.js setup check failed: missing actions/setup-node@v4'
  exit 1
fi