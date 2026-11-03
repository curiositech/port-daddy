#!/usr/bin/env bash
# Local absolute-path recipe for the verified linked worktree below.
# Cache-only Book build. No tracked PDF or publication metadata writes.
set -euo pipefail
cd /Users/erichowens/coding/tmp/book-textbook-craft-20261103
[[ "$(git rev-parse --show-toplevel)" == "$PWD" ]]
[[ "$(git branch --show-current)" == codex/book-textbook-craft-20261103 ]]
[[ "$(git rev-parse --git-dir)" == */worktrees/book-textbook-craft-20261103 ]]
source scripts/build-whitepapers.sh
outdir="$BUILD_DIR/coordination-papers-mega-volume"
# Hash direct generator inputs and the build/font helpers before generation.
# TeX trees cover chapter/root/figure and local citation-shortform inputs.
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess
root=Path.cwd();paths=set()
archived=root/'docs/harbor-research/exposition/book-reading-20261103/render-proof/build-recipe.sh'
assert (root/'.scratch/textbook-craft-20261103/build-candidate.sh').read_bytes()==archived.read_bytes(), 'Scratch build helper differs from archived recipe'
for directory in ('whitepaper','website-v2/public/whitepaper'):
    paths.update(root.glob(directory+'/**/*.tex'))
direct_inputs=(
    'whitepaper/textbook.json',
    'whitepaper/corpus.json',
    'whitepaper/citation-margin-entries.json',
    'scripts/generate-mega-whitepaper.mjs',
    'scripts/build-whitepapers.sh',
    'scripts/prepare-book-fonts.py',
    'docs/harbor-research/exposition/book-reading-20261103/render-proof/build-recipe.sh',
)
paths.update(root/p for p in direct_inputs)
facts={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
       'scope':'All two-tree TeX inputs plus explicit direct generator JSON and generation/build/font helpers; private font hashes are recorded separately. Not a complete transitive image-asset or toolchain inventory.',
       'direct_inputs':list(direct_inputs),
       'files':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}}
(root/'.scratch/textbook-craft-20261103/candidate-source-snapshot.json').write_text(json.dumps(facts,indent=2)+'\n')
PY
node scripts/generate-mega-whitepaper.mjs "$outdir"
python3 scripts/prepare-book-fonts.py "$outdir"
python3 - <<'PY'
from pathlib import Path
import hashlib,json
root=Path.cwd();path=root/'.scratch/textbook-craft-20261103/candidate-source-snapshot.json'
facts=json.loads(path.read_text())
drift=[p for p,h in facts['files'].items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
assert not drift, ('Source changed during generation',drift)
facts['font_profile']=json.loads((root/'.cache/whitepaper-build/coordination-papers-mega-volume/book-font-profile.json').read_text())
path.write_text(json.dumps(facts,indent=2)+'\n')
PY
epoch="$(paper_epoch website-v2/public/whitepaper coordination-papers-mega-volume.tex)"
export SOURCE_DATE_EPOCH="$epoch" FORCE_SOURCE_DATE=1
export TEXINPUTS="$outdir:${TEXINPUTS:-}:"
cd "$REPO_ROOT/website-v2/public/whitepaper"
run_tex_passes xelatex coordination-papers-mega-volume.tex "$outdir" coordination-papers-mega-volume
