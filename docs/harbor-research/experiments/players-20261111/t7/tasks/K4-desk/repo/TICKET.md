# DESK-130: route support tickets to the person on call

Status: OPEN
Requested by: Leila Haddad (support)
Files: deskkit/routing.py

New support tickets sit in one queue until someone sorts them by hand. They
should go straight to the person on call for the product. Who is on call for
what, and how fast an answer is due, is in operations' roster,
`deskkit/roster.py`. Read it through its functions: `team(product)`, `weekday_on_call(team, weekday)`,
`weekend_on_call(team)` and `sla_hours(plan)`. That file belongs to
operations. Use it as it is, and do not copy its names or numbers into other
modules.

`deskkit/api.py` already imports the functions below from
`deskkit/routing.py`. The tests call them through `deskkit.api`.

## Step 1: the team

`team_for(product)` returns the roster's team for a product. Ignore case and
surrounding spaces in the product name. `roster.team` returns `None` for a
product it does not know; such tickets go to the team `triage`.

Tests: `tests/test_step1.py`

## Step 2: the person on call

`on_call(product, weekday)` returns who is on call for the product's team.
Weekdays count from 0 for Monday. Monday to Friday use
`roster.weekday_on_call`; Saturday and Sunday use `roster.weekend_on_call`.

Tests: `tests/test_step2.py`

## Step 3: route a ticket

`route(ticket)` takes a dict with the keys `id`, `product`, `weekday` and
`plan`, and returns a dict with the keys `id`, `team`, `assignee` and
`due_hours`. The hours come from `roster.sla_hours(plan)`, which raises
`roster.UnknownPlan` for a plan it does not know. Tickets that land with
`triage` get twice the hours, because they have to be passed on.

Tests: `tests/test_step3.py`
