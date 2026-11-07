import sys,json,itertools
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"inputs"))
import future_fact_reachability as f
import b4_deontic_fragment as r
policy={"facts":[],"horn":[],"deontic":[[["p"],"O","write",["db"],[0,1],"o"],[["q"],"F","write",["db"],[0,1],"f"]],"claims":[],"nvars":0,"cons":[]}
labels=[[],["p"],["q"],["p","q"]]
total=0;budgeted=0
for labs in itertools.product(labels,repeat=3):
 for edge_bits in range(512):
  model={"schema_version":1,"model_id":"red-sweep","authority":"declared finite fixture","initial":["s0"],"states":[{"id":f"s{i}","facts":lab} for i,lab in enumerate(labs)],"transitions":[{"id":f"e{i}{j}","source":f"s{i}","target":f"s{j}"} for i in range(3) for j in range(3) if edge_bits & (1<<(3*i+j))]}
  reachable={"s0"}
  while True:
   nxt=reachable|{e["target"] for e in model["transitions"] if e["source"] in reachable}
   if nxt==reachable:break
   reachable=nxt
  bad=any(r.check(dict(policy,facts=row["facts"]))["conflict"] for row in model["states"] if row["id"] in reachable)
  result=f.analyze(model,policy)
  assert result["status"]==("unsafe" if bad else "safe"),(model,result,bad)
  assert result["complete"] and set(result["reachable_states"])==reachable
  if bad:assert f.replay_witness(model,policy,result["witness"])
  total+=1
  if edge_bits%32==0:
   bounded=f.analyze(model,policy,max_states=2,max_transitions=1);budgeted+=1
   if bounded["status"]=="safe":assert not bad and bounded["complete"]
   if bounded["status"]=="unsafe":assert bad and f.replay_witness(model,policy,bounded["witness"])
print(json.dumps({"complete_graph_cases":total,"budget_cases":budgeted,"mismatches":0,"oracle":"independent graph reachability plus same R17 checker; not an independent R17 correctness proof","bounds":"three labeled states, two positive facts, all 512 directed graphs, fixed overlapping O/F policy"}))
