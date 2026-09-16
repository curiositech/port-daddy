# Example: static Drydock architecture verdict

**Proposition:** Exact source tree `S`, controller build `C`, guest image `G`,
scenario `Q`, and policy `P` are specified for a zero-network deterministic
guest, with one externally reserved body and no provider authority.

**State:** PARTIAL. Static contracts and the implementation DAG validate. The
local runtime is halted, so VM containment, process witnesses, teardown, and
operator pixel evidence are `NOT_PROVISIONED`.

**Focused contracts:** Capacity returns a zero-provider fake reservation;
resurrection permits cold birth only and forbids successor authority; containment
permits T0 review only while the halt remains active.

**Critical blocker:** No dynamic witness exists for the selected hypervisor and
broker channel. Do not upgrade the verdict from PARTIAL because schemas pass.

**Next permitted action:** Review the static packet and prepare inert hostile
fixtures. A later explicit run grant must name the exact controller, image,
scenario, effect set, capacity reservation, and teardown witness.
