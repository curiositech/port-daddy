#!/usr/bin/env python3
"""Preserve the scout and check its exhaustive crosswalk; no literature claim is proved here."""
import copy, hashlib, json, pathlib, re, subprocess, sys, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[4]
HERE = pathlib.Path(__file__).resolve().parent
REL = HERE.relative_to(ROOT).as_posix()
LEDGER = ROOT / 'docs/harbor-research/omni-ledger.json'
SOURCE = pathlib.Path('/Users/erichowens/Library/Mobile Documents/com~apple~CloudDocs/phone_outbox/2026-11-06_Governing-AI-Agents_ Literature-Scout-for-Fourteen-Research-Directions.md')
ID = 'LITERATURE-SCOUT-20261106'
CAMPAIGN = 'RESEARCH-WAR-ROOM-20261106'
OLD = 'REVIEW-INTAKE-20261106'
OWNER = 'codex:/root/research_priority_challenge (intake); existing record owners retain research execution'
CAM = 'docs/harbor-research/campaigns/2026-11-06'
# These are annotations on existing canonical tasks, not a parallel task queue.
SPECS = [
('D1',32,54,['NEXT-P2','R5','P2-C1'],['Brief-B','Brief-C'],
 'Delayed observation needs an explicit plant, uncontrollable events and lease semantics before a controllability equivalence can be tested.',
 'Define one delayed plant and prove both directions or retain a counterexample; compare the cited theorem assumptions and a lease-expiry control.',
 'A policy admitted by the proposed criterion has an uncontrollable delayed violation, or the converse excludes an enforceable policy.',
 'Primary validation pending; inspect whether lease expiry is actually controllable and avoid equating a delay bound with complete mediation.'),
('D3',55,77,['PROOF-LIFTS','CREDENTIAL-JUMP'],['Brief-E','Brief-F'],
 'A specified capability order and attenuation operation may support meet and per-hop descent under explicit normalization.',
 'State the order and equivalence classes; check meet laws and delegation descent against primary capability semantics and current code.',
 'A proposed meet fails a lattice law, or a caveat expands rights under the chosen order.',
 'Primary validation pending. Root flags a deflationary idempotent monotone caveat as an interior operator under the standard order, not a closure operator.'),
('D5',78,97,['NEXT-P4','RELEASE-FACTORIZATION','X13'],['Brief-H'],
 'A bounded output alphabet bounds a specified leakage measure but alone does not classify release semantics.',
 'State attacker observations, query adaptivity, leakage metric and release map; prove the selected capacity bound and give a semantic-laundering counterexample.',
 'An allowed observation channel bypasses the counted alphabet, or the asserted semantic conclusion follows only by changing the threat model.',
 'Literature collision and novelty judgments are source assertions; compare primary quantitative-information-flow statements before any theorem claim.'),
('D6',98,117,['R11-A4','X12','NEXT-P4'],['Brief-I'],
 'Canary reliability under dependence needs a joint distribution or a justified extremal bound, not multiplication of marginal misses.',
 'Check a fully correlated negative control, independent control and the hypotheses of any correlation inequality; connect placement objective to observations.',
 'Claimed reliability exceeds an admissible joint-distribution bound or the placement optimum depends on an unmodeled correlation.',
 'Primary validation pending; retain the existing empirical canary-calibration obligation.'),
('D8',118,137,['NEXT-P1','P1-C1','R1','X2'],['Brief-J','Brief-K'],
 'A digest can be sufficient for one opening task without being equivalent to the full experiment for every bounded loss.',
 'Specify experiment, prior, loss class and deficiency convention; reproduce the four-world counterexample and restate any task-restricted comparison.',
 'The claim identifies task-specific zero loss with all-decision zero deficiency; exact guessing has risk 1/2 from the digest and zero from the full observation.',
 'Constructed falsifier independently rerun locally; adversarial mathematical review and primary-source comparison remain open. Scout itself discloses no searches budgeted for this section.'),
('D13',138,157,['NEXT-P3','R7','REVIEW-PILOT'],['Brief-P','Brief-V'],
 'A judging mechanism needs stated information, signal, participation and coalition assumptions before truthful reporting or effort is incentive compatible.',
 'Write the stage mechanism, compare all deviations and participation, test collusion and uninformative-equilibrium controls, and match primary peer-prediction hypotheses.',
 'A permitted uninformative or collusive strategy matches or beats truthful effort, or participation is individually irrational.',
 'Candidate research only; existing bonded audit does not prove peer prediction, finite-bankroll participation or collusion resistance.'),
('D14',158,177,['R12-A6','P5-C1','NEXT-P5'],['Brief-O'],
 'Conserved lineage reputation alone does not prevent additive per-alias payoff gains; the reward function and permitted splits matter.',
 'Reproduce U(x)=min(x,1), initial 2 and child balances .9,.9; distinguish sufficient monotone superadditive rewards from fixed-loss necessity and principal-level accounting.',
 'The proposed no-split rule accepts the conserved 1.8 balance while additive reward increases from 1 to 1.8.',
 'Constructed falsifier independently rerun locally; general correction depends on explicit utility and split assumptions, not a new Sybil-proofness theorem.'),
('D15',178,206,['R13-B5','INSTRUMENTATION'],[],
 'A runtime attestation proves only its bound statement and trusted computing assumptions; model identity and execution correctness are distinct.',
 'Specify the attested input, program/model digest, measurement chain, adversary and verifier; refresh primary hardware/ZK claims and measure costs in the claimed configuration.',
 'An alternative runtime/model produces an accepted receipt, or cost and assurance claims omit a necessary trust assumption.',
 'Primary and cost validation pending; no deployment, hardware guarantee or current vendor claim adopted from the scout.'),
('D20',207,227,['NEXT-P6','P6-C1','P6-OUTPUT','R17-B4'],[],
 'A reduction for a restricted obligation fragment may decide supplied conflicts, while future-safe admission additionally needs the actual reachable family.',
 'State the syntax and reduction, prove soundness/completeness for that fragment and compare primary complexity results; retain provider oracle and real-adapter conformance as separate checks.',
 'A formula outside the declared fragment is treated as decided, the reduction misclassifies a formula, or an omitted adapter transition invalidates admission.',
 'Bounded NEXT-P6 provider evidence exists; the scout difference-logic equivalence and broad complexity claims remain unverified.'),
('D25',228,248,['NEXT-P8','P8-T3','P8-T6','R6-CR2'],[],
 'Localizing faulty edges in a graph code and attributing malicious vertices require different observation and culpability models.',
 'Define code, metric and fault object; check distance/decoding claims against primary coding results; construct a signed equivocation example distinguishing edge error from principal blame.',
 'An edge-level bound is asserted as a vertex-adversary guarantee, or identical observations admit distinct culpable principals.',
 'Primary validation pending; root flags graph-cut versus girth and edge versus vertex semantics for separate checking.'),
('D26',249,268,['G4','G5','RUNTIME-OPEN'],['Brief-S'],
 'Fork accountability needs a specified consistency relation, witness gossip and synchrony assumptions before detection or damage windows are bounded.',
 'Compare primary fork-consistency and transparency definitions, replay split-view and delayed-gossip controls, and distinguish detection from prevention.',
 'A permitted indefinitely isolated witness defeats a claimed finite detection bound, or the claimed consensus necessity changes the uniqueness contract.',
 'Primary validation pending; broad claims that uniqueness requires consensus are not accepted without their failure and progress assumptions.'),
('D29',269,289,['BOOK-KIND','PAPER-A1-A5'],[],
 'Closure of safety properties under conjunction does not prove that independently verified components preserve safety when composed.',
 'Specify environment/interference and assume-guarantee premises; replay six read/grant interleavings and two atomic orders; distinguish trace properties from component composition and hyperproperties.',
 'Four legal interleavings overreserve despite each actor being safe alone, refuting the unqualified component-composition reading.',
 'Constructed falsifier independently rerun locally; source search was explicitly not performed, and no assurance-mode lattice law is accepted yet.'),
('D30',290,328,['TRIAL-BASIN','EVIDENCE-CONTRACT','X24'],[],
 'A governance benchmark should expose a versioned task, authority boundary and detectable failure, with controls proving the checker can fail.',
 'Refresh each benchmark from primary artifacts, verify comparable capabilities and missingness, preregister tasks/metrics/budget and include detection and vacuity controls.',
 'A cited benchmark already measures the supposedly absent capability, or the proposed checker passes its seeded violation.',
 'Gap-confirmed, first and novelty labels remain unsupported search conclusions; no paid trials or human recruitment authorized by this intake.'),
('D28',329,348,['REVIEW-OPS','SUBSTRATE-S2','INSTRUMENTATION'],[],
 'Agent process loss needs operational definitions and attributable incidents before intervention effectiveness can be measured.',
 'Define duplicate repair, lost state and merge-conflict units; obtain consented provenance-bound data and matched controls; separate dataset description from causal intervention claims.',
 'The metric counts planned parallel work as duplicate failure, or an intervention benefit disappears under a matched cost and task comparison.',
 'Research proposal retained under existing instrumentation and review tasks; current dataset/platform claims require primary refresh.')]

def sha(b): return hashlib.sha256(b).hexdigest()
def dump(p,v): p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n')
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def boundary():
 assert ROOT == pathlib.Path('/Users/erichowens/coding/tmp/research-program-next-result-20261106')
 assert git('rev-parse','--show-toplevel') == str(ROOT)
 assert git('branch','--show-current') == 'codex/research-program-next-result-20261106'
 assert '/worktrees/' in git('rev-parse','--absolute-git-dir')

def build(data,raw):
 lines=raw.decode().splitlines(); byid={x['id']:x for x in data['records']}
 previous=byid[OLD]['review_intake']['items']; aliases={x['source_alias']:x['id'] for x in previous if x.get('source_alias')}
 directions=[]
 for key,start,end,targets,briefs,hyp,accept,falsifier,disposition in SPECS:
  assert all(t in byid for t in targets)
  directions.append(dict(id=key,source_lines=[start,end],existing_tasks=targets,prior_source_units=[aliases[key]]+[aliases[b] for b in briefs],owner=dict(coordinator='codex:/root',execution={t:byid[t].get('owner','unassigned') for t in targets},assignment_rule='Unassigned research requires coordinator assignment before execution; intake ownership is not a promise to run every task.'),disposition=disposition,status='open research obligations; source intake complete',hypothesis=hyp,dependencies=targets,acceptance=accept,falsifier=falsifier,next_action='Existing task owner: '+accept,source_claim_status='Attributed scouting advice, not independently verified literature or novelty.',queue_authority='Existing canonical tasks only; this annotation creates no separately scheduled research job.'))
 bydir={d['id']:d for d in directions}
 def containing(n): return [d['id'] for d in directions if d['source_lines'][0]<=n<=d['source_lines'][1]]
 citations={}
 for n,line in enumerate(lines,1):
  if n>=369:continue
  for ref in re.findall(r'\\\[(\d+)\\\]',line): citations.setdefault(int(ref),set()).update(containing(n))
 # These three uncited terminal notes concern model/TEE measurement; the mapping is editorial, not a source citation claim.
 citations.update({72:{'D15'},73:{'D15'},74:{'D15'}})
 units=[];footnotes=0
 for n,line in enumerate(lines,1):
  if not line.strip():continue
  dirs=containing(n); note=re.match(r'^(\d+)\.\s+\[',line)
  if note:
   footnotes+=1;dirs=sorted(citations.get(int(note[1]),set()),key=lambda x:int(x[1:]));kind='source citation lead; primary identity and claim verification pending'
  elif not dirs:
   dirs=[k for k in bydir if re.search(r'(?<![A-Za-z0-9])'+k+r'(?!\d)',line)]
   kind='source overview, comparison or caveat; judgments attributed'
  else:kind='source-asserted recommendation or literature statement; adjudication in direction disposition'
  targets=sorted({t for k in dirs for t in bydir[k]['existing_tasks']}) or [OLD]
  units.append(dict(id=f'SCOUT-L{n:03}',source=dict(member='literature-scout.md',line_start=n,line_end=n,document_sha256=sha(raw),line_sha256=sha(line.encode())),classification=kind,directions=dirs,targets=targets,prior_source_units=sorted({u for k in dirs for u in bydir[k]['prior_source_units']}),disposition='Retain exact source; use linked direction obligations and existing task status. No assertion is promoted by intake.',source_note=int(note[1]) if note else None,route_basis=('intake editorial topic mapping; uncited terminal note' if note and int(note[1]) in [72,73,74] else 'source section, explicit direction name or numbered citation')))
 assert len(directions)==14 and len(units)==331 and footnotes==74
 return dict(version=1,coverage=dict(lines=len(lines),nonblank_units=len(units),directions=len(directions),source_notes=footnotes,prior_units=len(previous),combined_nonblank_units=len(previous)+len(units)),directions=directions,items=units)

def campaign():
 paths=['red/report.md','red/seal.json','white/report.md','blue/verification-summary.json','isolation/verdict.json','coordinator/evidence-r1/root.jsonl','transcripts/manifest.json']
 snapshot=[dict(path=f'{CAM}/{p}',sha256=sha((ROOT/CAM/p).read_bytes())) for p in paths]
 return dict(id=CAMPAIGN,title='November 6 staged research verification campaign',papers=['research portfolio'],kind='bounded evidence campaign',status='local bounded checks recorded; independent repair retest and guest proof execution remain open',result='RED sealed three concrete vacuity/gate findings. WHITE proposed repairs with six true security queries and four false negated-reachability queries with concrete traces. BLUE checked five Kani harnesses, 17 covers and two mutants. The logic-only 90-second timeout is incomplete. Three fixed VM probes pass only their declared probe scope.',assumptions='Host-reviewed proof processes have procedural blindness, not operating-system privacy. VM probes do not establish that proof runtimes or agents ran inside guests. Hash seals bind retained bytes, not completeness or actor identity. Model results do not establish deployed conformance.',evidence=['RED: R1-RED-001 initialization, R1-RED-002 key fanout, R1-RED-003 missing sealed-manifest gate.','WHITE: 6 security queries true; 4 negated reachability queries false with concrete traces; 4 seeded mutants produce intended failures. Independent Gate C retest pending.','TLC: final evidence-r1 records all four expected outcomes; bound model has 12 distinct states. Unbound mutant violates; acceptance and stale-rejection controls have witnesses. Earlier preparation parser failures are retained.','BLUE: 5/5 Kani harnesses; 17/17 covers; expiry and ceiling mutants detected; logic-only run INCOMPLETE_TIMEOUT after 90 seconds.','VM: 3 sequential fixed probes PASS with zero NIC, shared-directory or vsock devices; controller DEV_UNTRUSTED. Actual proof runtimes and agent privacy are not established inside guests.','Visible transcript prefix export has a manifest; it omits hidden/internal material and declares capture/exclusion limits. It is not a complete raw conversation archive.'],next='Coordinator: obtain independent Gate C retest, finalize prefix export and hash receipts; port actual proof runtimes into guest before any guest-execution claim. Keep logic-only timeout explicitly incomplete.',acceptance='Each claim points to immutable input identities, raw outputs, positive reachability and seeded failure controls; independent retest closes only its assigned finding; model, host, guest, provenance and publication claims stay separate.',depends_on=['NEXT-P6','REVIEW-MATH-20261106',ID],sources=[dict(path=x['path'],locator='Snapshot observed during scout intake; see claim-specific evidence and scope') for x in snapshot],owner='codex:/root (coordinator); red/white/blue/isolation/export lane owners in campaign receipts',hypothesis='Versioned inputs, adversarial controls and explicit scopes reveal vacuous or overstated assurances before they become research claims.',falsifier='A supposed successful check cannot execute its success path or detect its seeded violation; a claimed isolated proof ran only on the host.',verification=dict(basis='Current report and machine receipt inspection; proof tools were not rerun by intake lane.',snapshots=snapshot),campaign_scope=dict(next_p6='Bounded supplied transition-family provider; real adapter conformance remains open.',review_math='Three explicit sanction conventions and exact bounded deviation checks; no participation, finite-bankroll or coalition guarantee.',publication='No merge, hosted-CI, deployment, field efficacy or novelty claim follows from local checks.'))

def skill_receipt():
 paths=['skills/research-prior-art/SKILL.md','skills/research-prior-art/references/finding-prior-art.md']
 return dict(prior_editorial_grafts='docs/harbor-research/exposition/review-intake-20261106/skill-grafts.json',prior_source_acceptance=f'{OLD}.review_intake.source_skill_acceptance',additional_read_sources=[dict(path=p,sha256=sha((ROOT/p).read_bytes())) for p in paths],mappings=[dict(source='SCOUT-L118..137 and SCOUT-L158..177',skill='research-prior-art + textbook-craft premise correction',decision='Does the proposed theorem retain the primary statement hypotheses and decision class?',worked_example='Four-world digest solves opening but loses exact guessing; conserved .9+.9 balances increase capped additive reward.',acceptance='State the corrected hypothesis or retain the falsifier, identify primary statements and compare theorem-level quantifiers; no novelty claim from a search miss.'),dict(source='SCOUT-L269..289',skill='cambridge expertise three-level knowledge + expository writer',decision='Is this property intersection, component composition, or environment interference?',worked_example='Two individually safe read/grant actors overreserve in four of six interleavings.',acceptance='Present prerequisite shared-state semantics, the trace, failed misconception and reusable atomicity/assume-guarantee check; do not turn an ordering of labels into a theorem.'),dict(source='SCOUT-L290..328 and all 74 source notes',skill='research-prior-art primary-source verification + technical writer claim/evidence separation',decision='Does a checked primary artifact support each benchmark absence or novelty statement?',worked_example='A missing benchmark column is unknown until task definition and current artifact are checked.',acceptance='Record structural search strings, adjacent vocabulary, verified primary text and two-round citation neighbors; label no-hit results unresolved and maintain versioned task/metric controls.'),dict(source='All 14 directions',skill='technical evangelism reader payoff + AI educator worked-example ladder + textbook craft reuse',decision='What operational decision changes if this claim survives?',worked_example='D20: compare separate reachable futures with a joint activating future before defining a general admission reduction.',acceptance='Each existing-task annotation names hypothesis, prerequisite dependencies, operational example or falsifier, owner, acceptance and next action; no arbitrary page/theorem/exercise quota.')])

def read_archive():
 with zipfile.ZipFile(HERE/'literature-scout.zip') as z:
  assert z.namelist()==['literature-scout.md'];return z.read('literature-scout.md')

def apply():
 boundary();data=json.loads(LEDGER.read_text());assert not any(x['id'] in [ID,CAMPAIGN] for x in data['records'])
 baseline=copy.deepcopy(data);raw=SOURCE.read_bytes()
 zi=zipfile.ZipInfo('literature-scout.md',(2026,11,6,0,0,0));zi.external_attr=0o100444<<16;zi.compress_type=zipfile.ZIP_DEFLATED
 with zipfile.ZipFile(HERE/'literature-scout.zip','x') as z:z.writestr(zi,raw)
 archivehash=sha((HERE/'literature-scout.zip').read_bytes())
 oldarchive=ROOT/'docs/harbor-research/omni-sources.zip';priorarchive=ROOT/'docs/harbor-research/exposition/review-intake-20261106/review-sources.zip'
 manifest=dict(schema=1,source_original_name=SOURCE.name,member='literature-scout.md',bytes=len(raw),lines=len(raw.decode().splitlines()),sha256=sha(raw),archive_sha256=archivehash,archive_contract='Append-only evidence. Do not replace this archive or user original; a revised source requires a new versioned intake.',old_omni_archive_sha256=sha(oldarchive.read_bytes()),prior_review_archive_sha256=sha(priorarchive.read_bytes()),captured_head=git('rev-parse','HEAD'),branch=git('branch','--show-current'),linked_gitdir=git('rev-parse','--absolute-git-dir'))
 dump(HERE/'source-manifest.json',manifest);grafts=skill_receipt();dump(HERE/'skill-grafts.json',grafts)
 intake=build(data,raw);intake.update(archive=f'{REL}/literature-scout.zip',manifest=f'{REL}/source-manifest.json',skill_grafts=f'{REL}/skill-grafts.json',independent_constructed_falsifiers=dict(command='python3 -B skills/harbor-results/scripts/scout_claim_counterexamples.py',observed=dict(D14=dict(positive_bounded_cases=2168,initial_payoff='1',split_payoff='9/5',conserved_balance='9/5'),D8=dict(worlds=4,digest_cells=2,opening_loss='0',full_guess_risk='0',digest_guess_risk='1/2'),D29=dict(legal_schedules=6,violations=4,atomic_orders=2)),scope='Locally reproduced constructed falsifiers for scout formulations; not findings against cited primary papers, field measurements or a completed independent adversarial review.',sources=['skills/harbor-results/scripts/scout_claim_counterexamples.py','docs/harbor-research/research/scout-claim-counterexamples.md']))
 record=dict(id=ID,title='Literature scout reconciled with the existing review and research tasks',papers=['Book','research portfolio'],kind='source intake and prior-art obligations',status='complete source intake; literature assertions and research obligations remain open',result='Preserved the complete 444-line scout and routed all 331 nonblank units, 14 direction sections and 74 source notes into existing canonical tasks and the prior 668-unit review intake. Three exact constructed falsifiers reproduce locally; primary-source and novelty judgments remain unverified.',assumptions='This document is advice, not instructions. Scout labels such as verified, known, open and gap confirmed remain source assertions. A citation lead does not authenticate a paper or support its attributed theorem. Existing task owners and statuses remain authoritative; no duplicate research queue or blanket completion claim.',evidence=['331 nonblank units plus prior 668 = 999 traceable units across three supplied documents.','All 14 directions link previous D aliases and relevant A-V briefs; the previous 30 directions and 22 briefs remain intact.','D14 split reward 9/5 > 1 despite conservation; D8 exact-guess risk 1/2 versus 0 despite zero-miss opening; D29 four of six non-atomic schedules overreserve, both atomic orders safe.','D3 order/closure terminology, D1 controllability and D25 edge/vertex attribution remain pending primary checks.'],next='Use existing task owners to check primary theorem statements and explicit falsifiers; prioritize NEXT-P6 real-adapter conformance and independent campaign retests. Preserve every source assertion with its evidence status.',acceptance='Every nonblank source unit and numbered note has a source hash and line locator, an existing task route and direction disposition; meaningful direction annotations name hypothesis, owner, dependencies, acceptance, falsifier and next action. Prior records and archives are preserved.',depends_on=[OLD,'SOURCE-RETENTION'],sources=[dict(path=f'{REL}/{p}',locator=loc) for p,loc in [('source-manifest.json','Source and archive hashes'),('literature-scout.zip','literature-scout.md lines 1-444'),('README.md','Unified crosswalk and scope'),('skill-grafts.json','Source-to-skill-to-acceptance mappings')]],owner=OWNER,literature_scout=intake)
 data['records'].extend([record,campaign()]);byid={x['id']:x for x in data['records']};targetcount=0
 for old in baseline['records']:
  units=[u['id'] for u in intake['items'] if old['id'] in u['targets']]
  if units:
   targetcount+=1;byid[old['id']].setdefault('literature_scout_refs',{})[ID]=dict(source_units=units,disposition='Supplemental evidence only; preserve existing status and owner. See unified direction annotations for primary-validation and falsifier obligations.')
 # Demonstrate exact preservation of every pre-existing record apart from the explicit backlink namespace.
 for old in baseline['records']:
  new=copy.deepcopy(byid[old['id']]);refs=new.get('literature_scout_refs',{});refs.pop(ID,None)
  if not refs:new.pop('literature_scout_refs',None)
  assert new==old,old['id']
 for key in baseline:
  if key!='records':assert baseline[key]==data[key],key
 dump(LEDGER,data)
 receipt=dict(preexisting_records_preserved=len(baseline['records']),new_records=[ID,CAMPAIGN],existing_records_with_backlinks=targetcount,top_level_nonrecord_fields_preserved=True,coverage=intake['coverage'],archive_sha256=archivehash,old_omni_archive_unchanged=True,prior_review_archive_unchanged=True,original_user_source_unchanged=SOURCE.read_bytes()==raw,verification='Exact in-memory comparison before and after mutation; only literature_scout_refs[LITERATURE-SCOUT-20261106] added to old records.')
 dump(HERE/'preservation-receipt.json',receipt)
 rows=['| Direction | Existing task routes | Prior source units | Disposition |','|---|---|---|---|']
 for d in intake['directions']:rows.append('| '+d['id']+' | '+', '.join(d['existing_tasks'])+' | '+', '.join(d['prior_source_units'])+' | '+d['disposition']+' |')
 text='''# Literature scout intake, 6 November 2026

The reader needs the existing Omni task IDs and the distinction between a proposed theorem, a checked finite example and a primary literature result. This intake preserves advice and routes it into those tasks. It does not accept the scout's novelty or completeness judgments.

The portable archive contains the exact 444-line source. All 331 nonblank lines have document and line hashes, including all 74 numbered source notes. Together with the previous 668 review units, the canonical ledger now traces 999 units from three supplied documents. Blank lines carry no omitted recommendations. Numbered source notes link the direction sections that cite them; three uncited terminal model/GPU notes are explicitly marked as editorial topic routes to D15. The JSON source units and direction annotations live only in `LITERATURE-SCOUT-20261106.literature_scout` in `omni-ledger.json`; this receipt is not another work queue.

## Unified crosswalk

'''+ '\n'.join(rows)+'''

## What changed after checking

The locally rerun constructed falsifiers address the scout's formulations, not its cited primary authors. For D14, U(x)=min(x,1) gives reward 1 from an initial balance 2 and reward 1.8 from two .9 children, despite conservation. Monotone superadditive reward is sufficient under additive per-alias payoffs; the precise necessity depends on permitted splits. For D8, the pair digest solves opening with zero misses but exact guessing still has error 1/2 rather than zero. For D29, four of six legal read/grant schedules overreserve; both atomic orders are safe. These examples expose missing hypotheses. They do not establish a new general theorem, runtime defect or citation error.

D3's order and interior/closure terminology, D1's controllability and D25's edge/vertex attribution are explicit pending checks. The scout admits no searches for D8 and D29. No line marked “verified,” “known,” “open,” “gap confirmed” or “novel” becomes independently verified by preservation.

## Skills applied to decisions

The existing six editorial grafts remain in the previous intake receipt. The additional prior-art skill was read together with its detailed reference. `skill-grafts.json` maps source units to concrete decision points, examples and acceptance. Start with a structural mathematical statement; translate its vocabulary into adjacent fields; read primary theorem statements and assumptions; compare conclusions and quantifiers; inspect two rounds of citation neighbors; classify the surviving difference. An absent search hit is unresolved evidence. A reference-list appearance is only a lead. Full external citation validation is future work under the existing tasks.

For teaching/reuse, begin with the decision the claim would change: which future to admit, what a digest lets the reader decide, or whether splitting raises reward. Show the counterexample before the repaired hypotheses. Distinguish domain constraints, concepts and decision cues. Fade only a valid worked example into a check; never ask a reader to prove a false premise. The source-to-skill mappings make these requirements testable without page, theorem or exercise quotas.

## Campaign evidence

`RESEARCH-WAR-ROOM-20261106` links NEXT-P6 and REVIEW-MATH with the actual report and receipt paths. RED's three findings concern vacuous initialization, insufficient key fanout and a missing sealed-manifest gate. WHITE's six true security queries and four concrete participation traces are proposed repairs pending independent retest. The final TLC receipt checks a 12-state model and its mutation/reachability controls; earlier preparation parse failures remain retained. BLUE has five passing Kani harnesses, 17 covers and two detected mutants, while its logic-only 90-second timeout is incomplete.

Three fixed VM probes passed without NIC, shared-directory or vsock devices; this does not place actual proof runtimes or agents inside the guest. Host procedural blindness is not OS privacy. The visible transcript manifest describes prefix exports and exclusions, not a complete raw conversation archive. Hash seals bind retained bytes, not completeness or actor identity. These are local results, separate from hosted CI, merge, publication, field efficacy and novelty.

## Reproduce the intake checks

From the verified linked feature worktree:

```sh
python3 -B docs/harbor-research/exposition/literature-scout-20261106/intake.py check
python3 -B docs/harbor-research/exposition/review-intake-20261106/intake.py check
python3 -B scripts/harbor-research/omni_ledger.py check
python3 -B skills/harbor-results/scripts/scout_claim_counterexamples.py
```

`apply` is a one-time guarded constructor and refuses an existing intake. Archives and original user files are never rewritten by `check`. The original omni archive and its exact membership are unchanged. Tool-native ownership is declared here; the unavailable Register authorization is not claimed. Local Port Daddy remains halted.
'''
 (HERE/'README.md').write_text(text)
 print(json.dumps(receipt,indent=2))

def check():
 data=json.loads(LEDGER.read_text());byid={x['id']:x for x in data['records']};raw=read_archive();m=json.loads((HERE/'source-manifest.json').read_text());r=byid[ID]['literature_scout'];expected=build(data,raw)
 assert sha(raw)==m['sha256'];assert sha((HERE/'literature-scout.zip').read_bytes())==m['archive_sha256']
 assert sha((ROOT/'docs/harbor-research/omni-sources.zip').read_bytes())==m['old_omni_archive_sha256']
 assert sha((ROOT/'docs/harbor-research/exposition/review-intake-20261106/review-sources.zip').read_bytes())==m['prior_review_archive_sha256']
 if SOURCE.exists():assert SOURCE.read_bytes()==raw
 for key in ['coverage','directions','items']:assert r[key]==expected[key],key
 for direction in r['directions']:
  for field in ['owner','disposition','status','hypothesis','dependencies','acceptance','falsifier','next_action']:assert direction[field]
  assert all(x in byid for x in direction['existing_tasks'])
 for unit in r['items']:
  assert all(t in byid and unit['id'] in byid[t]['literature_scout_refs'][ID]['source_units'] for t in unit['targets'])
 assert byid[CAMPAIGN]['depends_on']==['NEXT-P6','REVIEW-MATH-20261106',ID]
 for p in byid[CAMPAIGN]['sources']:assert (ROOT/p['path']).is_file()
 assert len(r['items'])==len({u['id'] for u in r['items']})
 print(json.dumps(dict(check='PASS',coverage=r['coverage'],archive_sha256=m['archive_sha256'],canonical_records=len(data['records'])),indent=2))

if __name__=='__main__':
 assert len(sys.argv)==2 and sys.argv[1] in ['apply','check']
 (apply if sys.argv[1]=='apply' else check)()
