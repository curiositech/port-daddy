#!/usr/bin/env python3
import sys,json,datetime,importlib.util
from pathlib import Path
R=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("war_room",R/"inputs/war_room.py")
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
def log(event):
 with (R/"transcript.jsonl").open("a") as out:out.write(json.dumps({"timestamp":datetime.datetime.now(datetime.timezone.utc).isoformat(),**event})+"\n")
ledger=R/"evidence"
if not ledger.exists():
 w.record_event(ledger,"red","assignment",{"round":"2026-11-06-R1-GateC","privacy_enforced":False,"mode":"host-reviewed-process"})
 w.freeze(ledger,sorted((R/"inputs").iterdir())+sorted((R/"probes").iterdir()))
name=sys.argv[1];argv=sys.argv[2:]
log({"kind":"command-start","name":name,"argv":argv,"cwd":str(R/".cache")})
result=w.run(ledger,"red",R/".cache",argv,timeout=60,reviewed=True)
streams={a["name"].split(".")[-1]:(ledger/a["name"]).read_text() for a in result["artifacts"]}
log({"kind":"command-end","name":name,**result,**streams})
print(json.dumps({"name":name,**result,"results":[x for x in streams["stdout"].splitlines() if x.startswith("RESULT ") or x.startswith("PASS:")]},indent=2))
