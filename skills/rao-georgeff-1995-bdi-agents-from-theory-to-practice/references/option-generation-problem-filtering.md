# Option generation and plan filtering

## Paper method

A practical plan contains an **invocation condition** (the triggering event required to invoke it), a **precondition** (the situation that must hold for execution), and a body of primitive actions or subgoals. In each cycle the option generator reads the event queue and returns options; deliberation selects a subset.

Use a two-stage trace:

1. dequeue a bounded, locally scheduled event batch;
2. match invocation conditions and record matches;
3. evaluate preconditions against the declared current beliefs;
4. preserve rejected candidates with the failed condition;
5. deliberate over the applicable set;
6. push selected plans to intention stacks; and
7. measure queue, matching, precondition, deliberation, update, and action-gate durations separately.

**Positive fixture.** Event achieve(reach(cp)) matches short_route and detour; path_clear rejects the former after a declared belief update, while detour_open admits the latter.

**Negative fixture.** First action arrives after a change period, therefore option generation is the bottleneck. The delay can instead be queueing, preconditions, deliberation, action authorization, logging, or input delay; profile the stages.

## Filtering limits

The paper says the practical procedures must be fast enough for the application’s real-time demands and gives no indexing algorithm, universal cost ordering, queue discipline, or latency bound. Event-driven indexing, batching, caching, and fallback polling are implementation candidates. Define their coverage, delayed/lost-event behavior, and measured cost before adopting them.

## Source boundary

Official paper, abstract architecture and practical representation sections, read 2026-09-24. It does not provide a benchmark or prove matching faster than search in every library.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
