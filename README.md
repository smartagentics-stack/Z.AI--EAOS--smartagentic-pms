# SmartAgentics

> Enterprise AI Platform — Hotel PMS (Phase 1)

## Quick Start

```bash
pnpm bootstrap   # install + generate + test
pnpm dev         # start dev
pnpm test        # all tests
pnpm test:fitness # architecture fitness
pnpm lint
pnpm format
```

## Prerequisites

- Node.js >= 20, pnpm >= 9, Docker (for Restate)

## Structure

```
apps/web          # Next.js frontend (PMS UI)
apps/worker       # Restate worker (workflow handlers)
packages/sdk      # Framework-agnostic platform interfaces (ADR-009)
packages/dev-config # Consolidated ESLint, Prettier, TS, Vitest config
packages/db       # Prisma schema and migrations
packages/ai       # AI assistant prompts and evaluation
packages/shared   # Shared types and utilities
tests/fitness     # Architecture Fitness Functions
docs/adr/         # Architecture Decision Records (ADR-001 through ADR-011)
docs/governance/  # Governance documents (00-15)
spikes/SPIKE-01/  # Offline LAN Synchronization experiment
```

## Architecture

See `docs/adr/` for Architecture Decision Records.
See `docs/governance/` for governance framework, PDD, scope, metrics, and roadmap.

## Phase

Engineering Bootstrap complete. Phase 1 pending customer validation.
