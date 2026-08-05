#!/bin/bash

# Test error handling in build script
if grep -q 'return 1' scripts/build-whitepapers.sh; then
  echo 'Error handling check passed'
  exit 0
else
  echo 'Error handling check failed: missing error returns'
  exit 1
fi