# Coordinated Edit Example

```bash
pd status
pd briefing
pd begin "add route-level validation copy" --lifecycle durable --roadmap <slug>
pd advise website-v2/src/pages/AgentsPage.tsx --task "add unique agent subpage examples"
pd note "Scope: AgentsPage only. Validation: website build and route smoke check."
pd session files add website-v2/src/pages/AgentsPage.tsx
```

Edit the smallest real surface. If another session owns the same product story,
read its notes before changing the shape.

Close with:

```bash
pd guard check --staged
pd note "Result: unique subpage examples added. Validation: npm -C website-v2 run build."
pd done "Agents page slice complete"
```
