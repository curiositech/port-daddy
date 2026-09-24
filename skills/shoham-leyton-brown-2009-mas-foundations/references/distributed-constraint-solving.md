# Distributed Constraint Satisfaction: From Local Decisions to Global Solutions

## Source and model boundary

This reference follows Chapter 1 of Shoham and Leyton-Brown's [Revision 1.1 manuscript](https://www.masfoundations.org/mas.pdf). A distributed CSP has variables with finite domains, constraints, an ownership/distribution arrangement, and messages between agents. It is a feasibility protocol, not a strategic authority, blame, authentication, or effect-execution system.

## Local filtering: sound pruning, incomplete search

For a binary constraint between \(x_i\) and \(x_j\), revision deletes \(v_i\in D_i\) when no \(v_j\in D_j\) is compatible:

    REVISE(i, j):
      for each vi in Di:
        if no vj in Dj satisfies Cij(vi, vj):
          delete vi

If a domain becomes empty, the current CSP is infeasible. Nonempty domains do not by themselves establish a solution: local consistency can leave a globally infeasible instance. This makes filtering useful as preprocessing and diagnosis, while preserving the need for a complete method when a solution/infeasibility certificate is required.

## Nogoods: complete reasoning can be expensive

A nogood is a partial assignment that cannot extend to a solution. Hyper-resolution-style distributed reasoning can derive new nogoods and eventually derive the empty nogood for infeasibility. It is sound and complete in the stated finite propositional/CSP setting, but may generate exponentially many nogoods in the worst case. The lesson is not “always escalate”; it is to choose the required completeness and retain the derived conflict clauses that explain a result.

Example shape: if \(x_2=red,x_3=blue\) is incompatible with all values of \(x_1\), communicate that partial assignment as a nogood. A recipient can combine it with other constraints. The exact clause, rather than a vague “failure,” is the reusable diagnostic.

## Asynchronous backtracking (ABT)

ABT uses a total priority ordering. Each agent maintains:
- an **agent_view** of higher-priority assignments it knows;
- a current value consistent with that view when one exists;
- a nogood store;
- incoming/outgoing links required by the protocol.

Higher-priority assignments travel in OK messages. When an agent has no value consistent with its view, it derives a nogood and sends it to an appropriate higher-priority agent. If the learned nogood mentions an assignment owned by a previously non-neighbor agent, ABT adds the required link so that agent's assignment can enter the view. This is a precise protocol consequence; an arbitrary observed failure does not create a semantic dependency.

### Four-queens trace (finite-domain teaching fixture)

Let \(A_1>A_2>A_3>A_4\) own columns and choose rows 1..4. Initially each can choose row 1 from its partial view. \(A_4\), after receiving conflicting higher-priority assignments, finds no permitted row and returns a nogood such as \(\{A_1=1,A_2=1,A_3=1\}\) to the relevant higher-priority recipient. That agent changes assignment, sends a fresh OK message, and the change propagates. Messages can be stale because agents run asynchronously; correctness is from the protocol/model conditions, not from an implicit global clock.

A correct operational trace records message identifier, sender, recipient, referenced assignments, local view version, derived nogood, and replacement assignment. It must also state delivery/fairness/crash assumptions; the textbook protocol does not prove liveness for an arbitrary unreliable service.

## Nogood storage and ordering

Minimal nogood derivation can be expensive. Retaining all nogoods preserves diagnostic information but can consume substantial space; discarding clauses requires the chosen protocol’s correctness conditions. In particular, do not infer that every policy retaining only currently relevant nogoods preserves completeness; distinguish a proven ABT storage rule from an arbitrary memory cap. The priority order affects message pattern and search effort, but it is an algorithmic order, not an organizational permission or accountability hierarchy.

A “skill” may act as a CSP variable owner only if it has an explicit finite decision domain and constraints. A skill catalog, capability label, or free-form task description does not supply those objects.

## A safe transfer procedure

1. Write variables, finite domains, hard constraints and ownership.
2. State the priority order and reliable/fair message assumptions.
3. Use filtering for early pruning; use ABT/nogoods when the problem demands a distributed complete protocol.
4. Keep semantic authorization, identity verification and side-effect approval in separate mechanisms.
5. Treat a nogood as an explanation of modeled assignments, not proof of a real-world cause.

This preserves the original local-view, dynamic-link and conflict-analysis methods while retaining their finite-CSP conditions.
