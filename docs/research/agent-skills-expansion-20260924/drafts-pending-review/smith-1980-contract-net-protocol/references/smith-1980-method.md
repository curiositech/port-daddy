# Smith 1980 Contract Net method

A manager announces a contract ID, task abstraction, eligibility specification, bid specification, and expiration. Contractors locally decide whether and how to bid; the manager locally selects awards. A contractor can partition an awarded task and become manager of subcontracts. The source's sensing example uses position and sensor type as requested bid fields; its manager selects a set covering its area. Deadlines assume synchronized clocks and the paper assumes lower-level reliable bit-stream transport.

The paper leaves task/bid evaluations domain-specific and does not confer authorization, exactly-once effects, or modern FIPA semantics. Source directly read: <https://www.reidgsmith.com/The_Contract_Net_Protocol_Dec-1980.pdf>. FIPA Contract Net is distinct: <http://www.fipa.org/specs/fipa00029/SC00029H.html>.
