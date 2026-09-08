#!/bin/bash
# Verify all target files are untracked
if git ls-files core/harbor-card-rs/target/ | grep -q .; then
  echo 'Error: Some target files remain tracked'
  exit 1
fi
# Verify .gitignore applies
if ! git check-ignore -v core/harbor-card-rs/target/.rustc_info.json | grep -q '**/target/'; then
  echo 'Error: .gitignore rule not applied'
  exit 1
fi