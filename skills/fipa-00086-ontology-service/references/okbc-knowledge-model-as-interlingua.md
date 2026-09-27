# OKBC knowledge model as a meta-knowledge procedure

## Interface vocabulary, not backend proof

XC00086C uses a FIPA meta-ontology derived from the OKBC knowledge model to communicate about knowledge. Its frames/classes/individuals, slots, facets, and template-slot inheritance support assertion, retraction, querying, atomic modification, and translation vocabulary. It does not prescribe storage, transport implementation, authorization, persistence, or an inference engine. In particular, OKBC need not determine logical consistency.

### Own slots, template slots, and facets

An own slot describes a particular frame; a template slot attaches a value at a class so that the model's inheritance rules relate it to instances and subclasses. Keep that distinction when inspecting a provider: a value observed on one instance does not establish a template assertion for its whole class.

| Vocabulary | Question to ask the provider | Constructed check |
|---|---|---|
| Frame / class / individual | What entity is described, and is it a class or an instance? | Distinguish class `Citrus` from the individual fruit under inspection. |
| Slot / template slot | Is the relation about one frame or inherited through a class? | Compare one fruit's origin with a class-wide template assertion. |
| `:VALUE-TYPE` facet | What class constrains this slot's values? | Test both an admitted value and an explicitly incompatible value. |
| `:CARDINALITY` facet | How many values may be asserted here? | Try a second distinct value where the declared cardinality is one. |
| `:INVERSE` facet | Which inverse relation is declared? | Compare the forward fact with the corresponding reverse query. |

These are model-level constraints and proposed fixtures, not evidence that every OA computes consistency or refuses the same assertion. The OKBC discussion explicitly leaves inheritance of default values unspecified and does not require a knowledge-representation system to determine logical consistency. It also supplies no general mechanism here for overriding defaults. Record the selected provider's default and inference behavior instead of treating identical vocabulary as identical deductions.

## Operation procedure

Choose a provider that actually exposes the operation. Use the operation-specific ontology placement below, send the requested content action, and read the response. For an `atomic-sequence` of modifications, XC00086C requires atomic, consistent, isolated, durable behavior and rollback to the prior state when a component fails; its locking mechanism is implementation-dependent. Do not extend that property to unrelated calls or external side effects.

Constructed check: query a slot's value-type facet before proposing an assertion, then separately confirm that the provider returned an allowed result. A response is provider evidence, not proof of real-world truth.

## Source-shaped operation branch

These shapes are compact C §5.2 examples; identifiers are illustrative and support is provider-dependent. Modification and domain-query shapes name both the service ontology and the affected domain ontology in ACL `:ontology`.

```lisp
;; assert / retract: target ontology is animal-ontology
(request :ontology (set FIPA-Ontol-Service-Ontology animal-ontology)
  :content (action oa (assert (subclass-of whale mammal))))
(request :ontology (set FIPA-Ontol-Service-Ontology animal-ontology)
  :content (action oa (retract (subclass-of whale fish))))

;; truth question versus binding query
(query-if :ontology (set FIPA-Ontol-Service-Ontology fruit-ontology)
  :content (instance-of lemon Citrus))
(query-ref :ontology (set FIPA-Ontol-Service-Ontology fruit-ontology)
  :content (iota ?x (instance-of ?x Citrus)))
```

Read `inform`/answer or the specific exception branch. `refuse` may give `READ-ONLY` or `INCONSISTENT` for modification; `failure` and `not-understood` remain different. A missing result has no assertion to validate and causes no application effect.

### Atomic sequence: keep the printed syntax variant visible

C §5.2.5 nests an `action` wrapper around each component operation. Its example also includes a domain argument inside each `assert`/`retract`, whereas ordinary §5.2.2/§5.2.3 examples identify the domain through ACL `:ontology` and omit that argument. Preserve this printed difference; this draft does not reconcile it into an implementation grammar.

The following is a **constructed content expression** using the §5.2.5 nesting shape with renamed identifiers and two operations. It is not a complete ACL envelope or a tested provider call.

```lisp
(action selected-oa
  (atomic-sequence
    (action selected-oa (assert example-domain (class Citrus)))
    (action selected-oa (assert example-domain (subclass-of Citrus Fruit)))))
```

The original C example sequences four steps: assert a class, retract the earlier whale/fish subclass relation, retract the fish class, then assert the whale/mammal subclass relation. The source requires sequential execution with no visible intermediate state, isolation from simultaneous actions, and restoration of the pre-sequence ontology state if a component fails; locks are implementation-dependent. A local positive fixture observes both intended modifications after success. A negative fixture injects failure into the second operation and checks that neither modification survives. These are proposed checks, not executed results, and say nothing about rollback of external effects.

For the binding query above, the predecessor itself illustrates a set-valued citrus result using `iota`. Retain that source-specific usage rather than silently claiming agreement with every later content-language definition. Specify the expression/result convention of the chosen provider; no unique individual or complete real-world inventory follows from the sample.


The archived original describes OKBC-oriented frames, classes, individuals, slots, facets, and template-slot inheritance as vocabulary for talking about knowledge. Use it procedurally only where a selected provider implements these operations: query a frame/slot definition, inspect value-type/cardinality/inverse constraints, propose an assertion/retraction/translation, then read the provider result and validate the task consequence.

Example (constructed): before accepting favorite-food(Fred,Rock), a provider exposing a value-type facet can report whether Rock satisfies the declared range. That report is a provider result, not a universal FIPA refusal or proof of real-world edibility. The model/interlingua does not itself choose transport, authority, persistence, or an inference engine. XC00086D body access must be recorded separately; this retains the original method without claiming full normative verification.
