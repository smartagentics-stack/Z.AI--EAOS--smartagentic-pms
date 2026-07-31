# ADR-003: pnpm as Package Manager
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
pnpm v9+ with workspaces.
## Alternatives Rejected
npm (slower, no workspace support), yarn classic (phantom deps), yarn berry (PnP incompat)
## Consequences
Disk efficient, strict deps, fast. Negative: less ubiquitous than npm.
