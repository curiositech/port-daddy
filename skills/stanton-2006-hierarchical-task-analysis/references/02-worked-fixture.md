# Constructed HTA fixture and review

This is a constructed documentation-review fixture; no source claims Stanton analyzed this system.

| ID | Goal/subgoal | Criterion | Plan/evidence | Status |
|---|---|---|---|---|
| 0 | Close a controlled change request with an auditable decision | decision and reason are recorded | Plan 0; two walkthroughs; approved policy | active |
| 1 | Establish request evidence | request, owner, and change are identifiable | intake record | active |
| 2 | Assess request against stated criterion | criterion result has source | Plan 2; reviewer notes | active |
| 2.1 | Compare evidence to criterion | comparison record exists | manual + walkthrough | active |
| 2.2 | Resolve exception path | exception condition has a rule | two sources disagree | requires decomposition |
| 3 | Record and communicate decision | record and approved message exist | template contract | `//` for template review |

**Plan 0.** Do 1, then 2. If the assessment is unresolved, hold and redescribe the unresolved subgoal. Otherwise do 3, which records either acceptance or rejection with its reason, then exit.

**Plan 2.** Do 2.1. If an exception condition is present, do 2.2 before recording the assessment.

**Negative review.** A reviewer finds that 2.2 says only “handle exception.” It has no condition, rule, or evidence. The assessment is unresolved; the fixture holds and redescribes 2.2 rather than treating it as rejection. Once the assessment resolves, goal 3 records acceptance or rejection with the reason. Goal 3 can be terminal only for the declared communication-template review; an interface redesign could require a lower level.
