#!/usr/bin/env python3
"""Reproduce this frozen Book's visual inventory in a linked feature worktree."""
import subprocess,sys
from pathlib import Path
here=Path(__file__).resolve().parent;root=here.parents[2]
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert Path(git('rev-parse','--show-toplevel')).resolve()==root
assert (root/'.git').is_file(),'Refusing primary checkout'
assert git('branch','--show-current') not in ('','main','master'),'Feature branch required'
print('Verified',root,git('branch','--show-current'),git('rev-parse','--git-dir'))
def run(script,*args):subprocess.run([sys.executable,str(script),*args],cwd=root,check=True)
run(root/'scripts/book_visual_atlas_inventory.py','--pdf','.scratch/publication-repair/release/governing-ai-agents.pdf','--build','.cache/whitepaper-build/coordination-papers-mega-volume','--output','.scratch/visual-atlas/inventory')
for step in ['bind_caption_sources.py','screen_reviewed_candidates.py','audit_source_candidates.py','make_source_maps.py','add_margin_tables_and_solution_listings.py','add_main_listings_and_diagram_sources.py','crop_shipped_listings.py','crop_layer_ladder.py','bind_raster_sources.py','verify_inventory.py']:run(here/step)
