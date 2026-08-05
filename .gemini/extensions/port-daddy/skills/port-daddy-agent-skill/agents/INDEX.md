# Agent metadata

`openai.yaml` is distribution metadata for the skill package. This directory
does not define a second Port Daddy persona runtime.

Launch work through supported receipt-backed surfaces:

- `pd agent "<bounded task>"` for a one-shot delegated task;
- `pd sortie ...` for a bounded planned sortie;
- `pd session continue <id> "<direction>" --backend <id> --budget <usd>` for a
  linked successor;
- `pd dispatch` for queued isolated feature work;
- `pd-fleet.yml` with fields implemented by the live fleet schema for durable
  role automation.

Do not invent persona or parent-session flags on `pd spawn`. Put the task,
lineage, and authority in a supported launch request, then verify the returned
session, agent, receipt, transcript, budget, worktree, and control-center URL.

Durable roles such as Lookout/Documentarian and Quartermaster live in the
repository fleet/actor definitions. Notes and exact-SHA statuses are their
evidence, not an unexecuted YAML persona file.
