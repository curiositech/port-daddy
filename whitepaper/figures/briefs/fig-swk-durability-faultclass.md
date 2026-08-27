# Figure brief — II.4 Durability by fault class

- **Reader question:** When a successful write is followed by a fault, which
  fault classes preserve it and when does that answer change?
- **Claim:** I1a survives a daemon-process crash from acknowledgement onward;
  I1b is not guaranteed through power loss until the next WAL checkpoint.
- **Objects:** one acknowledged write, one checkpoint boundary, two fault-class
  lanes, and one explicitly bounded loss interval.
- **Reader action:** trace either fault class across the same time axis and name
  the guarantee that applies on either side of the checkpoint.
- **Must distinguish:** daemon death from OS/power failure; acknowledgement
  from durable-media completion; an explicit non-guarantee from a failure claim.
- **Chosen grammar:** two-lane guarantee-boundary plot sharing one temporal
  axis.
- **Rejected grammar:** storage-component flow boxes explain implementation but
  bury the condition that changes the truth of the durability claim.
- **Five-second acceptance test:** a reader can point to the amber interval and
  say that only a power-loss fault makes it a loss window.
