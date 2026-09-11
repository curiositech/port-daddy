#!/bin/bash
# Validates that the Swiss-modern skill package is structurally intact.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_files=(
  "$ROOT/SKILL.md"
  "$ROOT/references/swiss-modern-principles.md"
  "$ROOT/references/typography-and-grids.md"
  "$ROOT/references/component-patterns.md"
  "$ROOT/references/frontend-implementation.md"
  "$ROOT/references/research-notes.md"
  "$ROOT/templates/swiss-modern-design-brief.md"
  "$ROOT/templates/swiss-modern-layout.tsx"
  "$ROOT/templates/swiss-modern-tokens.css"
  "$ROOT/scripts/audit_frontend_for_swiss.sh"
  "$ROOT/scripts/validate_swiss_modern_brief.sh"
  "$ROOT/diagrams/INDEX.md"
  "$ROOT/agents/openai.yaml"
)

echo "Validating Swiss-modern skill bundle"

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: missing required file: $file"
    exit 1
  fi
done

bash -n "$ROOT/scripts/audit_frontend_for_swiss.sh"
bash -n "$ROOT/scripts/validate_swiss_modern_brief.sh"
bash -n "$ROOT/scripts/validate_skill_bundle.sh"

if command -v node >/dev/null 2>&1; then
  node - "$ROOT/SKILL.md" "$ROOT/agents/openai.yaml" <<'NODE'
const fs = require('fs');
const YAML = require('yaml');

const [skillPath, openaiPath] = process.argv.slice(2);
const skillText = fs.readFileSync(skillPath, 'utf8');
const match = skillText.match(/^---\n([\s\S]*?)\n---/);
if (!match) {
  throw new Error('SKILL.md is missing YAML frontmatter');
}

const frontmatter = YAML.parse(match[1]);
if (!frontmatter || frontmatter.name !== 'swiss-modern-website-design') {
  throw new Error('SKILL.md frontmatter name is missing or incorrect');
}
if (typeof frontmatter.description !== 'string' || frontmatter.description.trim().length < 80) {
  throw new Error('SKILL.md frontmatter description is missing or too short');
}

const ui = YAML.parse(fs.readFileSync(openaiPath, 'utf8'));
if (!ui?.interface?.display_name || !ui?.interface?.short_description || !ui?.interface?.default_prompt) {
  throw new Error('agents/openai.yaml is missing interface metadata');
}
if (!ui.interface.default_prompt.includes('$swiss-modern-website-design')) {
  throw new Error('agents/openai.yaml default_prompt must mention $swiss-modern-website-design');
}
NODE
else
  echo "ERROR: node is required to parse and validate skill YAML"
  exit 1
fi

if ! rg -q '^name:\s+swiss-modern-website-design$' "$ROOT/SKILL.md"; then
  echo "ERROR: SKILL.md frontmatter name is missing or incorrect"
  exit 1
fi

skill_lines=$(wc -l < "$ROOT/SKILL.md" | tr -d ' ')
echo "SKILL.md lines: $skill_lines"

if [ "$skill_lines" -gt 500 ]; then
  echo "ERROR: SKILL.md exceeds the 500-line target"
  exit 1
fi

echo "Skill bundle looks structurally valid"
