# Skills — flag 2

## Primary

**`technical-evangelism-for-formal-systems`** — this dive's output is a
positioning claim about a formal result, which is exactly what that skill
governs. Its discipline about not overselling a formal guarantee applies
directly to how the contribution paragraph gets rewritten if priority turns out
to be shared: the honest framing is "independently derived, here is what each
contributes," not a claim of precedence the record does not support.

**`fipa-00037-communicative-act-library`** — relevant more than it looks. Its
core distinction between what an agent can be *made* to do and what it can only
be *asked* to do, and its feasibility-precondition / rational-effect separation,
is the same structure as Paper 2's controllable/uncontrollable split. If the
FIPA literature already formalizes "which agent behaviors a mediator can
guarantee," that is prior art in a field the sweep has not searched — the
multi-agent-systems community, as distinct from the control-theory and
runtime-verification communities the paper already cites. Worth one search pass.

## Secondary

**`game-theoretic-agent-incentives`** — bears on Q4. Paper 2 hands detect-only
policies to the economic machinery of Paper 3 (audit, reputation, slashing).
Whether "detect-and-compensate" is a mechanism in the edit-automata taxonomy or
a category outside it turns on whether the compensation is trace-transforming or
economic. This skill's framing of enforcement-by-incentive versus
enforcement-by-prevention is the vocabulary for stating that cleanly.

**`falsification-first`** — apply to Job 1. The hypothesis under test is "this
preprint exists." Try hardest to confirm it, and treat five independent failures
to resolve as the falsification, not as a reason to keep searching for something
adjacent.

## Note on cross-disciplinary search

The user's original instruction for this whole program was to look for analogous
ideas in other fields *before* searching with our own terminology. For this
paper the fields to sweep, with their native vocabulary, are:

- **Control theory**: controllability, supervisory control, supremal
  controllable sublanguage. Already cited.
- **Runtime verification**: enforceable properties, monitorability, edit
  automata, safety-progress hierarchy. **Not cited — this is Job 2.**
- **Security**: reference monitor, complete mediation, noninterference. Cited.
- **Multi-agent systems / FIPA**: normative systems, regimentation vs.
  enforcement. **Note**: "regimentation" is an established term of art in the
  normative-multi-agent-systems literature, where it means precisely
  prevention-by-design as opposed to enforcement-by-sanction. Paper 2 uses the
  word "regiment" throughout, apparently independently. If that community has
  already drawn this boundary, it is the most likely place for genuine prior art
  and the least likely place this program has looked. **Search it.**
