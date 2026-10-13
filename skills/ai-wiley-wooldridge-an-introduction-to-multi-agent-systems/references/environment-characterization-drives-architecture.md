# Characterize the environment before selecting an agent architecture

This reference turns environment characterization into a design worksheet. Wooldridge’s second-edition contents and author lecture 2 provide the taxonomy and abstract model; the service example is constructed, not a claim made by the book. The accessible sources are the author contents page and lecture slides, not the full book.

## Model the interaction surface

For a bounded design question, state: (1) relevant environment states E, (2) actions Act, (3) transition relation T, (4) observations see_i(e), (5) runs admitted by the model, and (6) objective, constraints, and deadline. Use a relation rather than a function when outcomes vary. This small model exposes assumptions; it is not a full simulator or proof of implementation behavior.

## Classify properties as questions, not architecture prescriptions

| Dimension | Ask | Design consequence to investigate |
|---|---|---|
| Accessibility / observability | Which relevant state variables can the agent observe, and with what delay or error? | Whether belief/state tracking, querying, or conservative action is needed |
| Determinism | For a fixed state and action, can more than one outcome occur? | Whether outcome monitoring or contingency handling is needed |
| Episodicity | Does a decision affect later decisions or future state? | Whether history or planning matters |
| Static vs dynamic | Can relevant state change while the agent deliberates? | Whether freshness checks, deadlines, or interrupts matter |
| Discrete vs continuous | Are states, time, and actions naturally finite-valued or continuous? | Whether abstraction is necessary and what error it introduces |

A task may be partly observable in one respect and fully observable in another. Record evidence and uncertainty rather than a single universal label. These dimensions do not mechanically choose reactive, deliberative, or hybrid control: objective, actuators, latency, failure cost, and testability also matter.

## Constructed example: remote price lookup

Relevant state includes product, provider response, response age, and caller deadline. Actions are request, retry, return cached quote, or report unavailable. Provider internals are not observed; prices may change; requests can time out. The goal is to return a sufficiently fresh quote before the deadline or report an explicit stale/unavailable result.

This characterization suggests testable obligations rather than one required architecture: carry timestamp and source with cached data; set a deadline; distinguish timeout from valid empty result; define whether stale data is allowed. If the quote authorizes purchase, re-check at the effect boundary because lookup success does not establish current price or transaction authority.

## Transduction: observation is not the world

An observation function maps environment states to data available to an agent. The mapping can be delayed, lossy, noisy, or too coarse for the intended decision. Make this explicit in the model rather than treating predicates as direct access to reality. A practical review asks: what is sensed, when was it sampled, what precision is lost, which states map to the same observation, and what action is safe when confidence is low? This preserves the original transduction concern without claiming perception is universally unsolved or assigning unsupported latency/fidelity rates.

## Observation equivalence and information gaps

For observation function see_i, define e ~_i e' when see_i(e)=see_i(e'). In a policy that depends only on current observation, states in the same observation class cannot be distinguished. If they require different actions, add an observation, retain history, or choose an action safe across both possibilities.

Example: an API exposes only “request failed.” Timeout and permanent authorization error are indistinguishable under that interface. A retry policy cannot distinguish them without richer status, an additional query, or a conservative common response. This is a property of the modeled interface, not every implementation.

## Characterization worksheet

| Field | Record |
|---|---|
| Decision and success condition | Result plus deadline or terminal condition |
| State subset | Variables that may change the correct action |
| Observations | Source, freshness, errors, authority |
| Actions | Effects, preconditions, reversibility, possible outcomes |
| Other actors | What can change state independently? |
| Information exchange | Sent, received, acknowledged, or inferred? |
| Model gaps | Indistinguishable states and unknown transitions |
| Validation | Scenarios exercising each important assumption |

Repeat at different time scales where appropriate: one request may be static while its service changes continually. Estimates remain tentative and should change when observations contradict them.

## Retained methods and corrections

The source draft’s environment taxonomy, observation-equivalence idea, and goal/reactivity tension are retained as methods. Unsupported vacuum-rule counts, Mars/Steels “radioactive crumb” mechanism, automatic trust depreciation, universal architecture deductions, fixed volatility thresholds, and the claim that environment alone drives design are removed. Tileworld and 180-skill examples are not attributed to Wooldridge absent source support.

## Sources and access

- Michael Wooldridge, An Introduction to MultiAgent Systems, 2e author [contents](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/Contents.html), topic map only.
- Author-hosted [chapter 2 lecture slides](https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/imas/distrib/pdf-slides/lect02.pdf), read as primary teaching source for agent/environment abstraction and properties.
- Full book and Wiley body were not accessed; no page-level book quotation is claimed.

