import json
from pathlib import Path
R=Path(__file__).resolve().parent
rows={x["name"]:x for x in map(json.loads,(R/"transcript.jsonl").read_text().splitlines()) if x["kind"]=="command-end"}
for row in rows.values():assert row["exit_code"]==0 and not row["stderr"] and not row["timed_out"]
def results(name):return [x for x in rows[name]["stdout"].splitlines() if x.startswith("RESULT ")]
def section(name,prefix):
 matches=[x for x in rows[name]["stdout"].split("-- Query ")[1:] if x.splitlines()[0].startswith(prefix)]
 assert len(matches)==1,(name,prefix)
 return matches[0]
def trace(name,prefix):
 s=section(name,prefix);assert " is false." in s and "A trace has been found." in s
 return s.split("A more detailed output of the traces is available with")[-1]
base=results("repaired-independent");assert len(base)==10
assert all(x.endswith(" is true.") for x in base[:6])
assert all(x.endswith(" is false.") for x in base[6:])
assert "cannot be proved" not in rows["repaired-independent"]["stdout"]
joint=trace("repaired-independent","not event(JointRoles(")
for event in ["RedWrites(red_msg)","DefenseWrites(def_msg)","AttackManifestSealed(manifest_id,red_msg)","GateBRelease(manifest_id,red_msg)","LeadEmitsToDefense(manifest_id,red_msg)","DefenseLearnsRed(manifest_id,red_msg)","JointRoles(manifest_id,red_msg,def_msg)"]:
 assert "event "+event in joint,event
assert joint.index("event AttackManifestSealed(")<joint.index("event GateBRelease(")<joint.index("event DefenseLearnsRed(")
replay=trace("duplicate-receiver","inj-event(")
assert replay.count("event DefenseLearnsRed(manifest_id,red_msg) at")==2
assert replay.count("event LeadEmitsToDefense(manifest_id,red_msg) at")==1
for name in ["late-seal-event","public-id-undomain-separated-seal","white-early-release"]:
 for prefix in ["event(GateBRelease(","event(DefenseLearnsRed("]:
  matches=[x for x in rows[name]["stdout"].split("-- Query ")[1:] if x.splitlines()[0].startswith(prefix) and "==> event(AttackManifestSealed(" in x.splitlines()[0]]
  assert len(matches)==1
  sec=matches[0];assert " is false." in sec and "A trace has been found." in sec
  concrete=sec.split("A more detailed output of the traces is available with")[-1]
  assert "event AttackManifestSealed(" not in concrete
for name in ["public-manifest-id","undomain-separated-seal"]:
 assert results(name)==base,name
for name,secret in [("white-leak-red","red_msg"),("white-leak-defense","def_msg")]:
 assert "The attacker has the message" in trace(name,"not attacker("+secret)
auth=trace("white-unauthenticated-receiver","inj-event(")
assert "event DefenseLearnsRed(manifest_id,def_msg)" in auth and "event LeadEmitsToDefense(manifest_id,def_msg)" not in auth
print(json.dumps({"status":"PASS","findings":{"R1-RED-001":"closed-in-model","R1-RED-002":"closed-in-model","R1-RED-003":"closed-in-model"},"independent_new_mutants":5,"new_mutant_observations":{"duplicate_receiver":"concrete two-learns/one-emission injectivity violation","late_seal":"two concrete early-event counterexamples","remove_domain_separation_only":"survives due to private identifier release gate","public_identifier_only":"all baseline properties preserved","public_identifier_and_remove_domain_separation":"two concrete early-event counterexamples"},"scope":"one session, one receiver, one complete manifest; honest roles and private key provisioning; no host privacy"},indent=2))
