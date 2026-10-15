# Graph Coach

A study coach whose memory is a FalkorDB knowledge graph: learners play fill-in-the-blank puzzles built from a prompt or from their own material, and agents decide what to practise next and show the path behind every decision.

Track: **Agent Memory and Coordination**. Live site: not deployed yet. Demo video: not recorded yet. Read [Provenance](#16-provenance) before judging this entry.

## 1a. Live site

Not deployed yet.

## 2. Overview

Not yet written.

## 2a. Two ways to create a puzzle

Not yet written.

## 3. Architecture

Not yet written.

## 4. Setup (local fallback and development)

Prerequisites: Node.js 20 or later (24 recommended, see `.nvmrc`), pnpm 9 or later, Docker with Compose v2, and make.

Available so far:

```bash
make setup    # checks prerequisites, installs dependencies, creates .env from .env.example
make up       # starts FalkorDB (6379, browser UI on 3002) and Postgres (5432), waits until healthy
make doctor   # checks tools, ports, and .env keys
make down     # stops the stores, keeps their data
```

`make migrate`, `make seed`, and `make dev` exist but report "not available yet" until the API package is built. Image versions: `falkordb/falkordb:6.0.2`, `postgres:16.15-alpine`.

## 5. Graph data model

Not yet written. The design is in [the design documents](the design documents).

## 5a. Privacy model

Not yet written.

## 5b. Observability and privacy

Not yet written.

## 6. Named queries

Not yet written.

## 7. The five graph jobs

Not yet written.

## 8. Agents

Not yet written.

## 9. Tests

Not yet run.

## 10. Remove the graph check

Not yet run.

## 11. Demo

Not yet recorded.

## 12. Seed data and licences

Not yet written.

## 13. Security

Not yet run.

## 14. Deployment

Not yet deployed.

## 15. Challenge compliance

Not yet written.

## 16. Provenance

Specification and design documents (`specs/`, `docs/adaptation-plan.md`, the constitution) were started on 2026-10-11, before the hackathon began on 14 Oct 2026 at 18:31 UTC. Work on the application itself also began before that time, on 2026-10-14. Rule 8 requires the main coding and design work to begin after the start; this must be disclosed to the organisers.

The rest of this section (the dated record of the work, the disclosure and its answer, the earlier projects that inspired the design, and the state of the history) is not yet written.

## 17. AI-assistant disclosure

Not yet written.

## 18. Repository layout and licence

Not yet written.
