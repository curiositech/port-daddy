#!/bin/bash
# Ensure no other target directories are tracked
if git ls-files | grep -E '(^|/)target/' | grep -v 'core/harbor-card-rs/target/'; then
  echo 'Error: Found untracked target directories elsewhere'
  exit 1
fi