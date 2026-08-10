# Archive — history, not plans

Everything in this folder is **superseded**. It is kept because it records how decisions
were reached, and because removals should be recoverable rather than forgotten.

**Do not work from anything here.** The only planning document is
[`../STATE.md`](../STATE.md). If a file here disagrees with STATE.md, STATE.md wins.

Archived 2026-08-10, when six competing "what to do next" documents were collapsed into
one: COMPLETION-PLAN, NEXT-SESSION, RESUME-HERE, INGEST-BUILD-PLAN, INGEST-REBUILD,
COMMERCIAL-READINESS, RECONCILIATION, deploy-0096-0101-trips, and the phase plans.

`INGEST-REBUILD.md` and `COMMERCIAL-READINESS.md` are worth reading for their reasoning
— the route-scoring measurements and the Google/Strava constraints respectively — but
their status lives in STATE.md now.


---

## Previous archive note

# Archived / historical documents — DEPRECATED

These files describe the original phased build-out (Phases 1–7) and the one-off
"UNFUCK-PLAN". They are **historical context only** and are **no longer accurate
operating instructions**. The phase-per-session workflow they describe is
retired.

**Do not follow setup, deployment, or architecture steps from these files.**
The current source of truth is:

- [`../../README.md`](../../README.md) — product, architecture, setup, commands, deploy, rollback, backup, incident response.
- [`../../CLAUDE.md`](../../CLAUDE.md) — working rules and current backlog.
- [`../adr/`](../adr) — architecture decisions (canonical Place/Visit/Entry/Trip model).

Kept in git for provenance; safe to delete once no one references them.
