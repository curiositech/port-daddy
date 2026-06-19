#!/bin/bash
echo "# Port Daddy Divergent Universe Manifest" > docs/HARVEST_MANIFEST.md
echo "Scanning .claude/worktrees for unique features..." >> docs/HARVEST_MANIFEST.md

for wt in .claude/worktrees/agent-*; do
  if [ -d "$wt" ]; then
    echo "## Universe: $(basename $wt)" >> docs/HARVEST_MANIFEST.md
    echo "\`\`\`" >> docs/HARVEST_MANIFEST.md
    cd "$wt"
    git log --oneline -n 3 2>/dev/null >> ../../../docs/HARVEST_MANIFEST.md || echo "No git history found." >> ../../../docs/HARVEST_MANIFEST.md
    git diff --stat HEAD~1 2>/dev/null >> ../../../docs/HARVEST_MANIFEST.md || echo "No recent diffs." >> ../../../docs/HARVEST_MANIFEST.md
    cd ../../../
    echo "\`\`\`" >> docs/HARVEST_MANIFEST.md
  fi
done
echo "Harvesting complete!"
