# The Scope Ladder, Tenancy Roles, and Export/Delete Controls

Use this when you need the private/repo/team/public scope tiers themselves, how roles attach to them, or what
"export/delete controls per tier" has to cover before `exportDelete.perTierSupported` can honestly be `true`.

## The scope ladder

The Agent Harbor binder's README defines four skill scopes: **private, repo, team, public**. Treat this as a
ladder, not an unordered set — each rung is strictly wider than the one before it:

```
private  ->  repo  ->  team  ->  public
(device)     (one repo)   (a group of   (anyone can
              /project     identified    discover and
                           members)      use it)
```

- **private**: never leaves the device. No account required to create or use it. This is the tier `00-prd`
  means by "local transcripts saved by default."
- **repo**: scoped to a single repository/project; visible to anyone with access to that repo.
- **team**: scoped to a named group of identified members (M10: "team harbor roles") — wider than one repo,
  narrower than the public internet.
- **public**: discoverable and usable by anyone, inside or outside the org.

### Why ordering matters mechanically

`scopeLadderOrdered: true` is not decorative. Role and consent logic that re-derives "is X wider than Y" ad
hoc, per feature, is exactly how a repo-scoped feature ends up accidentally granting team-wide visibility (or
vice versa) — two different code paths disagree about the ordering and nobody notices until a support ticket.
The fix is one declared ordering (an enum, a lookup table, whatever the language affords) that every
tier-crossing and role check imports rather than reimplements.

## Roles per tier (M10: "team harbor roles")

Once a tenant exists at `team` scope, the binder calls for real roles — not everyone-is-admin. At minimum,
distinguish:

- **Owner/admin**: can invite, remove members, change tier visibility, and — critically — export or delete
  the team's data.
- **Member**: can use and contribute within the team's scope, cannot change who else has access.
- **Viewer** (if the product needs it): read-only within the team's scope.

Roles are a `team`/`public` concept; `private` and (usually) `repo` scope don't need a role system because
there's nothing to arbitrate between — a single device or a repo's existing access control already does it.
Don't invent role machinery at a tier that doesn't need it; that's scope creep in the literal sense.

## Export and delete controls per tier (M10)

M10 calls out "export and delete controls" as a named milestone item, and `exportDelete.perTierSupported`
only becomes honestly `true` once every tier a user's data can reach has both:

| Tier | Export means | Delete means |
| --- | --- | --- |
| private | A file/data dump the user can pull off their own device — no server round-trip required. | Deleting local state actually deletes it; no orphaned cloud copy exists to delete separately. |
| repo | Exporting the subset of data scoped to that repo (not the user's entire account). | Removing the user's contribution/membership from that repo's scope specifically. |
| team | Exporting what's visible at team scope, respecting the requester's role (a member shouldn't export data they never had visibility into). | Both "leave the team" (delete membership) and "delete the team's data" (owner-only, usually with a confirmation flow) need to exist and be distinguishable. |
| public | Exporting a public listing's own metadata/content. | Delisting/deleting a public listing, plus handling of any cached/mirrored copies the product is responsible for. |

A common way this check fails silently: export/delete gets built for `private` and `team` (the tiers the
launch feature needed) and nobody circles back for `repo` or `public` once those tiers ship later. Treat
`no-export-delete-per-tier` as a prompt to re-audit the full tier list, not just the newest one.
