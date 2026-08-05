#!/bin/bash

# Check build script for Node.js dependency
if grep -q 'command -v node' scripts/build-whitepapers.sh; then
  echo 'Node.js dependency check passed'
  exit 0
else
  echo 'Node.js dependency check failed: missing node check'
  exit 1
fi