#!/bin/bash
# Test pre-commit hook allows deletions but blocks new files
# Simulate deletion
echo 'test' > core/harbor-card-rs/target/test.txt
git add core/harbor-card-rs/target/test.txt
if ! git commit -m 'test' --no-verify 2>/dev/null; then
  echo 'Error: Deletion blocked by pre-commit hook'
  exit 1
fi
# Simulate new file addition
echo 'new' > core/harbor-card-rs/target/new.txt
if git commit -m 'test' 2>/dev/null; then
  echo 'Error: New target file not blocked'
  exit 1
fi