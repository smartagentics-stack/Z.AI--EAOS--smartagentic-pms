# SmartAgentics Engineering Bootstrap Specification

**Version:** 1.0
**Status:** FIRST IMPLEMENTATION ARTIFACT
**Owner:** Engineering Office
**Created:** 2026-07-14
**Directive:** TRB-005

---

## What This Is

An executable engineering baseline, not a governance document. This specifies the repository structure, build system, testing, CI/CD, and development workflow that enable all Phase 1 implementation.

**Acceptance criterion for this spec:** A new engineer can clone the repo, run one command, and have a working development environment with passing tests.

---

## 1. Repository Topology

### Decision: Monorepo

**Rationale:**
- Phase 1 is one product (Hotel PMS), not multiple services
- Shared TypeScript types between frontend and backend
- Simpler CI (one pipeline, one deployable)
- Smaller team (1-3 engineers) — polyrepo overhead not justified
- Migration path: if AI services split out later, use monorepo workspaces

**Alternatives rejected:**
- Polyrepo: overhead without benefit at Phase 1 scale
- Hybrid: premature complexity

### Structure

```
smartagentics/
├── apps/
│   ├── web/                    # Next.js frontend (PMS UI)
│   └── worker/                 # Restate worker (workflow handlers)
├── packages/
│   ├── shared/                 # Shared types, schemas, utilities
│   ├── db/                     # Prisma schema, migrations, client
│   └── ai/                     # AI assistant prompts, evaluation
├── scripts/                    # Build, deploy, test scripts
├── docs/                       # Architecture, ADRs, RTM (this folder)
├── .github/
│   └── workflows/              # CI pipelines
├── package.json                # Workspace root
├── turbo.json                  # Turborepo config (build orchestration)
├── tsconfig.base.json          # Shared TypeScript config
├── .eslintrc.js                # Shared lint rules
├── .prettierrc                 # Formatting
└── README.md                   # Setup instructions
```

---

## 2. Package Management

### Decision: pnpm with workspaces

**Rationale:**
- Disk efficient (hard links vs copies)
- Strict dependency management (no phantom deps)
- Workspaces support monorepo
- Faster than npm/yarn for monorepos

**`package.json` (root):**

```json
{
  "name": "smartagentics",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "format": "prettier --write .",
    "bootstrap": "pnpm install && pnpm db:generate && pnpm test"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## 3. Build System

### Decision: Turborepo

**Rationale:**
- Monorepo build orchestration
- Remote caching (speeds up CI)
- Dependency-aware task execution
- Configured via `turbo.json`

**`turbo.json`:**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "db:generate": {
      "outputs": ["node_modules/.prisma/**"]
    }
  }
}
```

---

## 4. Dependency Policy

### Rules

1. **Production dependencies:** must be justified in ADR or Build vs Buy Matrix
2. **Dev dependencies:** allowed if they serve build/test/lint
3. **No unused dependencies:** `pnpm depcheck` runs in CI
4. **Security audit:** `pnpm audit` runs in CI, blocks on high severity
5. **License check:** all dependencies must be compatible with our license (TBD — ADR-002 needed)

### Approved Dependencies (Phase 1)

| Dependency | Type | Justification |
|-----------|------|---------------|
| next | production | Frontend framework (ADR-001) |
| @restatedev/restate-sdk | production | Workflow engine (ADR-001, EAOS-proven) |
| @prisma/client | production | ORM for SQLite/PostgreSQL (ADR-001) |
| @auth/core | production | Authentication (ADR-001, Build vs Buy) |
| openai | production | AI provider (ADR-001) |
| better-sqlite3 | production | SQLite driver (ADR-001) |
| zod | production | Runtime validation |
| winston or pino | production | Logging (TBD — spike needed) |
| vitest | dev | Unit/integration testing |
| playwright | dev | E2E testing |
| @testing-library/react | dev | Component testing |
| promptfoo | dev | AI evaluation (ADR-001) |

**Any dependency not in this list requires ADR approval.**

---

## 5. Testing Stack

### Decision: Vitest + Playwright

**Rationale:**
- Vitest: fast, Vite-native, Jest-compatible API
- Playwright: cross-browser E2E, good Windows support (target market)
- Both support TypeScript natively

### Test Types

| Type | Tool | Location | Runs On |
|------|------|----------|---------|
| Unit | Vitest | `packages/*/src/__tests__/` | Every commit |
| Integration | Vitest | `apps/*/tests/integration/` | Every commit |
| E2E | Playwright | `tests/e2e/` | Pre-merge + nightly |
| AI Evaluation | Promptfoo | `packages/ai/evals/` | Pre-merge (AI changes only) |
| Smoke | Custom script | `scripts/smoke/` | Post-deploy |

### Coverage Targets

| Package | Coverage | Threshold |
|---------|----------|-----------|
| packages/shared | Lines | ≥80% |
| packages/db | Lines | ≥70% |
| packages/ai | Lines | ≥70% |
| apps/web | Lines | ≥60% |
| apps/worker | Lines | ≥80% |

**Coverage enforced in CI — PR blocked if below threshold.**

### Example Test Structure

```
packages/shared/src/
├── schemas/
│   ├── reservation.ts
│   └── reservation.test.ts    # Co-located unit tests
├── utils/
│   ├── date.ts
│   └── date.test.ts
```

---

## 6. CI/CD

### Decision: GitHub Actions (or equivalent)

**Pipeline stages:**

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
      - run: pnpm audit --audit-level=high
      
  e2e:
    runs-on: windows-latest   # Test on Windows (target market)
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm e2e
```

### CI Gates (all must pass to merge)

1. ✅ Lint passes
2. ✅ Build succeeds
3. ✅ Unit + integration tests pass
4. ✅ Coverage thresholds met
5. ✅ No high-severity security vulnerabilities
6. ✅ E2E tests pass (on Windows — target market)

---

## 7. Versioning

### Decision: Semantic Versioning

```
MAJOR.MINOR.PATCH
```

- **MAJOR:** Breaking changes
- **MINOR:** New features (backward compatible)
- **PATCH:** Bug fixes

### Release Tags

- `v1.0.0-alpha.1` — internal alpha
- `v1.0.0-beta.1` — pilot hotel beta
- `v1.0.0` — production release

### Changelog

Keep `CHANGELOG.md` at repo root. Format: [Keep a Changelog](https://keepachangelog.com/).

---

## 8. Release Strategy

### Phase 1 Release Pipeline

```
feature branch
    ↓
PR + CI passes
    ↓
merge to main
    ↓
auto-build artifacts
    ↓
tag release (v1.0.0-alpha.#)
    ↓
deploy to internal staging
    ↓
smoke test
    ↓
(pilot) deploy to pilot hotel
```

### Artifacts per Release

| Artifact | Format | Purpose |
|----------|--------|---------|
| Windows installer | `.exe` (NSIS or electron-builder) | Hotel deployment |
| Web app | Docker image or static export | Cloud deployment (future) |
| Worker | Docker image | Cloud deployment (future) |
| Database migrations | SQL files | Upgrade path |
| Release notes | Markdown | Customer communication |

---

## 9. Configuration Management

### Decision: Environment variables + .env files

**Hierarchy (highest priority first):**
1. Process environment variables (production)
2. `.env.local` (developer-specific, gitignored)
3. `.env.{NODE_ENV}` (e.g., `.env.test`)
4. `.env` (defaults, committed)

**`packages/shared/src/config.ts`:**

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string(),
  RESTATE_URL: z.string().default('http://localhost:9070'),
  OPENAI_API_KEY: z.string().optional(),
  AUTH_SECRET: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = ConfigSchema.parse(process.env);
```

**Validation at startup — invalid config crashes immediately.** No silent misconfiguration.

---

## 10. Logging

### Decision: pino (structured JSON logging)

**Rationale:**
- Fastest Node.js logger
- Structured JSON (machine-readable)
- EAOS investigation used structured JSON logging successfully (RR-014 Stage 1)

**`packages/shared/src/logger.ts`:**

```typescript
import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
  },
});
```

### Log Schema

```json
{
  "level": "info",
  "time": 1721000000000,
  "msg": "reservation_created",
  "reservationId": "res_abc123",
  "tenantId": "hotel_001",
  "userId": "user_xyz",
  "durationMs": 45
}
```

### Log Levels

| Level | When to use |
|-------|-------------|
| error | Failures requiring human intervention |
| warn | Unexpected but handled conditions |
| info | Business events (reservation created, check-in completed) |
| debug | Development diagnostics (off in production) |

**Never log:** passwords, API keys, PII (guest names, payment info) — redact at log call site.

---

## 11. Database Migrations

### Decision: Prisma Migrate

**Rationale:**
- Type-safe schema
- Migration history
- Supports SQLite (Phase 1) and PostgreSQL (future)
- EAOS investigation used Prisma successfully

### Migration Workflow

```bash
# Edit schema
vim packages/db/schema.prisma

# Create migration
pnpm db:migrate --name add_reservations_table

# Apply in development
pnpm db:push

# Verify
pnpm db:studio
```

### Migration Rules

1. **Never delete migrations** — they're history
2. **Always test up AND down** — rollback must work
3. **Breaking changes require ADR** — column drops, type changes
4. **Migrations run on startup in production** — with backup first

### Seed Data

```bash
pnpm db:seed  # Loads test hotel, rooms, staff
```

---

## 12. Installer (Windows)

### Decision: electron-builder or NSIS (spike needed)

**Acceptance criteria (from M-013):**
- Fresh install completes <15 minutes
- No manual intervention required
- Includes: Node.js runtime, SQLite, app binary
- Creates desktop shortcut
- Registers uninstaller
- Auto-update capability (checks for new versions)

### Architecture Spike Required

This is Spike-INSTALL-01 (see Architecture Spikes section). Must answer:
- Can electron-builder produce a Windows installer that bundles Node.js?
- Can it auto-update?
- What's the install size?
- Does it work on Windows 10 and 11?

---

## 13. Development Workflow

### Bootstrap (first time)

```bash
git clone <repo>
cd smartagentics
pnpm bootstrap   # installs deps, generates client, runs tests
```

### Daily Development

```bash
pnpm dev         # starts web + worker + restate (via docker-compose)
```

### `docker-compose.yml` (development services)

```yaml
version: '3.8'
services:
  restate:
    image: restatedev/restate:latest
    ports: ['9070:9070', '8080:8080']
  
  # SQLite runs as file (no container needed)
  # OpenAI is external API
```

### Pre-commit Hooks (Husky)

```bash
pnpm prepare     # installs husky

# .husky/pre-commit
pnpm lint-staged   # lints + formats changed files
pnpm test          # runs affected tests
```

### Branch Strategy

```
main           — production-ready
develop        — integration branch
feature/*      — feature work
fix/*          — bug fixes
spike/*        — architecture spikes
```

---

## 14. Architecture Spikes (replaces generic PoCs)

Per TRB-005: spikes answer "Can this work in OUR architecture while satisfying quality attributes?"

### Quality Attributes (every spike must address)

| Attribute | Question |
|-----------|----------|
| Performance | Does it meet latency/throughput targets? |
| Reliability | Does it handle failures gracefully? |
| Maintainability | Can a new engineer understand and modify it? |
| Security | Does it meet security requirements? |
| Testability | Can it be tested automatically? |
| Operational | How hard is it to deploy/monitor/debug? |

### Spike List

| Spike ID | Name | Question | Quality Attributes | Success Criteria | Status |
|----------|------|----------|-------------------|------------------|--------|
| SPIKE-01 | Offline LAN Sync | Can two PMS clients sync via LAN with 0 data loss? | Reliability, Performance | 0 duplicate transactions, 1h concurrent ops, <1s sync latency | PLANNED |
| SPIKE-02 | SQLite Conflict Resolution | Can SQLite handle PMS-specific conflicts? | Reliability, Maintainability | All conflict types (room, reservation, billing) resolve correctly | PLANNED |
| SPIKE-03 | AI Assistant Intermittent | Can AI degrade gracefully when offline? | Reliability, Operational | Online <3s response, offline returns cached/helpful message <1s | PLANNED |
| SPIKE-04 | Backup/Restore | Can SQLite backup/restore meet M-008? | Reliability, Operational | Backup <30s, restore <60s, 100% integrity | PLANNED |
| SPIKE-05 | Windows Installer | Can we produce a Windows installer meeting M-013? | Operational, Maintainability | Install <15min, auto-update works | PLANNED |
| SPIKE-06 | AI Evaluation Pipeline | Can Promptfoo validate AI meets M-009? | Testability, Maintainability | Golden suite runs, <5% hallucination | PLANNED |
| SPIKE-07 | AI Cost Monitoring | Can we track + limit AI costs per M-011/M-012? | Operational, Reliability | Per-request cost tracked, budget alerts fire | PLANNED |
| SPIKE-08 | Android Companion | Can Android connect to PMS over LAN? | Performance, Operational | Phone views reservations, room status | DEFERRED (Phase 2) |

### Spike Output

Each spike produces:
1. **Code** in `spikes/{SPIKE-ID}/` (not production code, but runnable)
2. **Spike Report** answering all 6 quality attribute questions
3. **ADR** if the spike validates an architectural decision
4. **Updated RTM** if the spike reveals new requirements

**Spike that fails:** Produces a report explaining why, and the approach is revised. Not a failure — a learning.

---

## 15. Health Checks

### Application Health

```
GET /health
200 OK
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "restate": "ok",
    "ai": "ok" | "degraded" | "unavailable"
  },
  "version": "1.0.0-alpha.1",
  "uptime": 3600
}
```

### Startup Health Check

On app start:
1. Database connection — fail fast if unreachable
2. Restate connection — warn if unreachable (offline mode)
3. AI API key — warn if missing (AI features disabled)
4. Disk space — warn if <1GB free
5. Memory — warn if >80% used

---

## 16. What's NOT in This Spec

- Business logic (that's Phase 1 feature implementation, after customer validation)
- AI prompts (that's AI Office work, after AI Evaluation spike)
- Customer-facing UI design (that's Product Office work, after customer validation)
- Deployment infrastructure (that's Operations Office, after installer spike)

**This spec is the backbone. Features are built ON it, not in it.**

---

## 17. Execution Plan

### What I Can Do Now (Track B — parallel to customer discovery)

1. **Initialize repository structure** — create the monorepo layout
2. **Set up package.json, turbo.json, tsconfig** — build system
3. **Set up ESLint, Prettier** — code quality
4. **Set up Vitest** — testing framework
5. **Set up Prisma schema (empty)** — database schema
6. **Set up pino logger** — logging
7. **Set up GitHub Actions CI** — pipeline
8. **Set up Husky pre-commit** — git hooks
9. **Write README** — bootstrap instructions
10. **Create docker-compose.yml** — dev environment

### What Requires Human Action

- Customer Discovery (Track A)
- Windows installer spike (requires Windows testing)
- AI evaluation spike (requires OpenAI API key + golden dataset)

### Next Action

**I can initialize the repository structure NOW.** This is not blocked by customer discovery. Shall I proceed with creating the actual code skeleton, or do you want to review this spec first?
