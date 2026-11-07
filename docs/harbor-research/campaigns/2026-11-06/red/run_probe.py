#!/usr/bin/env python3
import sys,json,datetime,importlib.util
from pathlib import Path
RED=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("war_room",RED/"inputs/war_room.py")
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
ledger=RED/"evidence"
def event(kind,data):
 with (RED/"transcript.jsonl").open("a") as out: out.write(json.dumps({"timestamp":datetime.datetime.now(datetime.timezone.utc).isoformat(),"kind":kind,**data})+"\n")
if not ledger.exists():
 w.record_event(ledger,"red","assignment",{"round":"2026-11-06-R1","privacy_enforced":False,"scope":"RED-owned snapshots and symbolic probes"})
 w.freeze(ledger,sorted((RED/"inputs").iterdir()))
name=sys.argv[1];argv=sys.argv[2:]
event("command-start",{"name":name,"argv":argv,"cwd":str(RED/".cache")})
r=w.run(ledger,"red",RED/".cache",argv,timeout=60,reviewed=True)
streams={a["name"].split(".")[-1]:(ledger/a["name"]).read_text() for a in r["artifacts"]}
event("command-end",{"name":name,**r,**streams})
print(json.dumps({"name":name,**r,"results":[line for line in streams["stdout"].splitlines() if line.startswith("RESULT") or "Error:" in line or "states generated" in line or "distinct states" in line or "No error" in line]},indent=2))
