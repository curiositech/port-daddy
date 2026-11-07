#!/usr/bin/env python3
"""Reviewed blue lane: fresh commands, raw evidence, bounded parser attempt."""
import importlib.util,json,sys
from pathlib import Path
blue=Path(__file__).resolve().parent
root=blue.parents[4]
spec=importlib.util.spec_from_file_location('war_room',root/'scripts/harbor-research/war_room.py')
room=importlib.util.module_from_spec(spec);spec.loader.exec_module(room)
campaign=blue/'evidence'
crate=blue/'.cache/crate'
room.record_event(campaign,'blue','assignment',{'task':'Rerun current-source five Kani harnesses, two negative controls and bounded logic-only harness; capture actual evidence.', 'privacy_enforced':False,'tool_path_correction':'Requested cargo-kani0.67.0 path absent; installed cargo-kani --version reports 0.67.0.','prior_receipt':'Nov5 used for invocation context only; not copied as fresh evidence.'})
inputs=[blue/'source-manifest.json',blue/'tool_environment.py',Path(__file__),root/'scripts/harbor-research/war_room.py',crate/'Cargo.toml',crate/'Cargo.lock',*sorted((crate/'src').glob('*.rs')),*sorted((crate/'scripts').glob('*.py'))]
room.freeze(campaign,inputs)
wrapper=[sys.executable,'-B',str(blue/'tool_environment.py')]
results={}
def execute(label,args,timeout):
    print('START '+label,flush=True)
    result=room.run(campaign,'blue',crate,wrapper+args,timeout=timeout,reviewed=True)
    results[label]=result
    (blue/'run-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print('DONE '+label+' '+json.dumps({key:result[key] for key in ['exit_code','timed_out','elapsed_seconds']}),flush=True)
    return result
execute('tool-version',['/Users/erichowens/.cargo/bin/cargo-kani','--version'],15)
args=['/Users/erichowens/.cargo/bin/cargo','kani']
for name in ['proof_constant_time_behavior','proof_decoded_claims_policy','proof_decoded_channel_authority','proof_decoded_delegation_two_hops','proof_capability_attenuation']:
    args+=['--harness',name]
main=execute('five-harnesses',args,300)
if main['exit_code']==0:
    execute('evidence-gate',[sys.executable,'-B',str(crate/'scripts/check-kani-log.py'),str(campaign/main['artifacts'][0]['name'])],15)
execute('negative-controls',[sys.executable,'-B',str(crate/'scripts/check-kani-negative-controls.py')],180)
execute('logic-only-bounded',['/Users/erichowens/.cargo/bin/cargo','kani','-Z','stubbing','--harness','proof_verify_logic_only'],90)
room.record_event(campaign,'blue','results',{'results':{name:{key:item[key] for key in ['exit_code','timed_out','elapsed_seconds']} for name,item in results.items()},'scope':'Finite supplied harnesses only; timeout is incomplete, never proof.'})
sealed=room.seal(campaign)
(blue/'seal-anchor.json').write_text(json.dumps(sealed,indent=2)+'\n')
print(json.dumps(sealed),flush=True)
