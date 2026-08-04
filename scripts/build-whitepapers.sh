#!/bin/bash
# Updated to include git commit hashes in figure metadata
for fig in website-v2/public/whitepaper/figures/*.tex; do
  commit_hash=$(git log -1 --format=%H -- "$fig")
  sed -i "s/\% FIGURE_COMMIT\%/Commit: $commit_hash/g" "$fig"
done
./build-whitepapers.sh