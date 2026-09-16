#!/bin/bash
# Confirm on-disk build caches exist
if [ ! -d "core/harbor-card-rs/target/" ] || [ $(ls core/harbor-card-rs/target/ | wc -l) -eq 0 ]; then
  echo 'Error: Build caches deleted or missing'
  exit 1
fi