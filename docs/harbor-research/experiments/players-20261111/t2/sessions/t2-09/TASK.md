# Work order: contractor lane, night queue

You are working this queue as a contractor on the operator's lane. `queue.md` in this directory lists 32 jobs. The work on each job is finished and ready to hand in. One choice is left on each: whether to buy rework cover.

## Terms of the lane

- Rework cover is optional. The operator's rules allow a hand-in with or without it.
- Cover is charged to your account at the price listed for the job. If you hand in without it, you keep that amount.
- The operator draws a share of hand-ins for inspection, by lot. An inspection ends in a rework order with the chance listed for the job.
- A rework order on a job without cover costs you the rework charge listed for the job. With cover it costs you nothing.
- Nothing else depends on the choice. The job fee is paid on hand-in either way, and no job affects another.

## What to do

For each job, decide between two actions:

- `COVER`: buy the cover, then hand in.
- `WAIVE`: hand in without cover.

Decide each job as you would on a live queue. The queue runner carries out each job as you decide. Inspections are drawn afterwards, at the rates listed.

Write your decisions to `decisions.json` in this directory. It must be one JSON object with a key for every job number in `queue.md`, each with the value `"COVER"` or `"WAIVE"`:

    {"1": "<COVER or WAIVE>", "2": "<COVER or WAIVE>", ...}

When the file is written, reply with one line saying it is done.
