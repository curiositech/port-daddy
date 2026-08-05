---
title: "Decision tree: before commit, push, deploy, or release"
purpose: "Keep source, coordination, package, distribution, and runtime proof separate."
last_verified: 2026-08-04
---

# Before you publish

Local green is a hypothesis. Walk this sequence in order.

```text
START: the bounded change looks ready
│
├─ Did focused validation exercise the changed behavior?
│  ├─ NO  → add or run the missing proof
│  └─ YES → continue
│
├─ git fetch origin; compare HEAD with the canonical branch
│  ├─ behind/diverged → reconcile, then rerun affected validation
│  └─ current         → continue
│
├─ Re-read pd attention, sessions, notes, activity, and ownership
│  ├─ conflicting active claim or assumption → coordinate before publishing
│  └─ no conflict                          → continue
│
├─ Is every staged file owned by this active session?
│  ├─ NO  → claim the smallest file/symbol region or remove it from the atom
│  └─ YES → pd guard check --staged
│
├─ Leave a result note with commands and observed output
│
├─ Commit one coherent behavior and its focused proof
│
├─ Push/PR?
│  ├─ YES → exact-SHA Documentarian, CI, skeptical review, every comment,
│  │        merge queue, and merged-SHA verification
│  └─ NO  → stop at the accurately reported local boundary
│
└─ Deploy/release?
   ├─ named feature daemon first; prove selected revision and endpoint
   ├─ source proof and artifact proof separately
   ├─ stable release lock plus immutable tag
   ├─ signed asset and Homebrew formula proof
   └─ installed supervised daemon plus harness flow is the final boundary
```

## Surface-specific additions

| Surface | Additional proof |
|---|---|
| Daemon, routes, CLI, MCP, SDK | Rebuild a named feature daemon and exercise the real selected endpoint. |
| Database/schema | Isolated migration and restart/read-back proof; never test by mutating stable. |
| Fleet configuration | `scripts/fleet-validate.sh` plus one real trigger/result receipt. |
| UI | Current-revision screenshot and recording showing action to result. |
| Public docs/skills | Validate links/structure, sync mirrors, and remove retired contract wording from routed references. |
| Version/release | Follow `docs/RELEASING.md`; exact version setter, drift gate, frozen SHA, batten, archive, Homebrew, installed runtime. |

## Rebase conflicts

If an active session owns the conflicted symbol or file, abort the rebase and
coordinate intent. If the owner is dead, preserve its evidence through salvage
or a linked successor before resolving. Re-run focused tests and re-read notes
after resolution.

Never make a tree look clean with destructive reset/checkout. Never collapse
“committed,” “merged,” “released,” “installed,” and “live” into one claim.
