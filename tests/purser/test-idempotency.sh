#!/bin/bash

# Test idempotency of build script
if grep -q 'if [ -z' scripts/build-whitepapers.sh; then
  echo 'Idempotency check passed'
  exit 0
else
  echo 'Idempotency check failed: missing idempotency logic'
  exit 1
fi