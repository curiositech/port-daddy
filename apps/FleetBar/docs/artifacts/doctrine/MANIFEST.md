# CASE-13 doctrine operator evidence

| Artifact | What it proves | Provenance |
| --- | --- | --- |
| `fleetbar-doctrine-case13-fixture.png` | The native FleetBar Doctrine surface renders candidate/advisory state, episode provenance, factual-control fidelity, and the contradiction affordance. | Labeled synthetic fixture rendered by `DoctrineSectionSnapshotTests`; it is explicitly not a live doctrine claim. |
| `fleetbar-doctrine-case13-fixture-walkthrough.gif` | A short, labeled fixture walkthrough of the rendered operator evidence state. It is a camera pan over the exact screenshot, not a recording of a live daemon or a claim that a decision was taken. | Derived only from the PNG above; regenerate after running the snapshot test. |

Regenerate the source screenshot from the repository root:

```sh
FLEETBAR_DOCTRINE_SNAPSHOT_OUT="$PWD/apps/FleetBar/docs/artifacts/doctrine/fleetbar-doctrine-case13-fixture.png" \
  swift test --package-path apps/FleetBar --filter DoctrineSectionSnapshotTests
```

The fixture uses synthetic CASE-13 evidence and a visible `FIXTURE` banner so
it cannot be mistaken for live Fleet doctrine. A live recording remains a
separate release gate: run the same UI against a named development daemon with
real receipts, then retain the recording and its runtime provenance with the
PR.
