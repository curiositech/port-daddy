# Figure brief — II.3 Single-writer discipline

- **Reader question:** Can many clients mutate the same local state without a
  distributed agreement protocol?
- **Claim:** Requests may overlap at arrival, but one daemon gives them a single
  admission order and commits that order to one SQLite WAL ledger.
- **Objects:** five simultaneous request sources; an ordered daemon queue; one
  write connection; five ordered commits; a file-lock backstop.
- **Reader action:** compare concurrent arrival lanes with the serial commit
  sequence, then trace the queue between them.
- **Must distinguish:** arrival concurrency from commit seriality; the daemon's
  queue from the SQLite file-lock backstop; one local decider from a distributed
  consensus system.
- **Chosen grammar:** aligned Gantt-style arrival lanes, a vertical FIFO queue,
  and a horizontal commit ledger.
- **Rejected grammar:** a hub-and-spoke/node diagram would make every component
  look equivalent and conceal the timing and order that are the claim.
- **Five-second acceptance test:** a reader can say “many arrive together; this
  queue chooses one order; the WAL records that order one commit at a time.”
