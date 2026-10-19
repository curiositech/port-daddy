# Market Formulation and Mechanism Boundaries

Use this reference when a pricing memo invokes truthfulness, stability, approximation, auctions, or mechanism design. Start with a market, then identify whether the cited result applies.

| Required element | Write it explicitly |
| --- | --- |
| Agents | buyers, sellers/workers, platform, and verifier by name |
| Private types | values, costs, skills, quality, availability, or budget that each party privately knows |
| Allocation and payment | who receives which task, what is paid, and when |
| Feasibility | capacity, skill threshold, exclusivity, time, budget, or verification constraints |
| Objective | revenue, welfare, completion, platform contribution, stability, or another named objective |
| Outcome policy | what happens for failure, reversal, dispute, and unknown verification |

Xia and Muthukrishnan, “Revenue-Maximizing Stable Pricing in Online Labor Markets” (HCOMP 2017), model workers with skill vectors and tasks with a required skill, minimum level, and maximum payment. Their feasibility, stability, truthfulness, and SMUP/SMNP approximation results are scoped to that market and its stated assumptions. Source: <https://cdn.aaai.org/ojs/13299/13299-64-16816-1-2-20201228.pdf>.

Myerson, “Optimal Auction Design” (1981), concerns a seller allocating a single object with private buyer valuations; it does not establish a pricing rule for multi-step agent work, support allocation, or SaaS margin. Source: <https://doi.org/10.1287/moor.6.1.58>.

A product plan that lacks these objects should say “pricing heuristic” or “offline margin analysis.” Do not claim truthfulness, stability, welfare optimality, or a mechanism-design result from the stress report.

## Constructed boundary example

A platform sells a $5 “verified repair” to a buyer. The executor knows its expected tool cost; the buyer knows urgency; a verifier decides whether the repair is accepted. Feasibility might require one executor, a budget cap, and a passing verifier. The product objective may be nonnegative contribution after review, while a mechanism objective might be welfare or truthful reporting. Unless an allocation/payment rule and private-type model are defined, this is a product-pricing scenario, not a theorem instance.
