#!/bin/bash
# Test concurrent add/delete operations
for i in {1..5}; do
  echo "file$i" > core/harbor-card-rs/target/file$i
  git add core/harbor-card-rs/target/file$i
  git reset core/harbor-card-rs/target/file$i
  git add core/harbor-card-rs/target/file$i
  git commit -m "test$i" --no-verify || exit 1
  rm core/harbor-card-rs/target/file$i
  git add core/harbor-card-rs/target/file$i
  git commit -m "delete$i" --no-verify || exit 1
done
# Verify no residual tracked files
if git ls-files core/harbor-card-rs/target/ | grep -q .; then
  echo 'Error: Residual tracked files after concurrency'
  exit 1
fi