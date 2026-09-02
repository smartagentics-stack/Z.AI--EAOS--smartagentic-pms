# ADR-036: Offline Ingestion Channels

**ADR-ID:** ADR-036
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8, File 2 § implicit in offline-first architecture) classifies **Knowledge Ingestion** as an "Architecture Contract — NOW" capability and the SmartAgentics PMS is offline-first by design — the hotel server may be air-gapped from the public internet, with document transfer via LAN-shared folders, USB sticks, manual upload, and batch CLI. The existing SmartAgentics repository has no ingestion channels — research B4 #13.

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §8) documented the air-gapped / offline document-transfer evidence: Julia discourse (2023) — "One machine at home to download all the files. Then 'burn' it on to a USB drive. Bring it to work." PrivacyGuides (2025) — community confirmation of USB-based transfer. Everfox (2024) — cross-domain solution pattern for high-security environments. Dolthub (2023) — practical tooling discussion for air-gapped networks. Batchpatch (2020) — Windows-specific offline ops. The canonical air-gap pattern is USB transfer; LAN-shared folders are the hotel-specific extension.

The recommended offline ingestion channels: **Manual upload (UI)**, **LAN-shared folder watch** (chokidar), **USB-stick auto-import** (OS-level udev/AutoRun hook + chokidar), and **Batch CLI** — all Phase 1. **SFTP pull**, **Email attachment ingestion**, and **Cloud sync (when online)** are Phase 2+. All ingestion runs locally; no cloud calls. **chokidar** (MIT, 12.2k stars, v5.0.0 released Nov 2025) is the only sensible choice for cross-platform file watching in Node.js — it explicitly fixes Windows `fs.watch` quirks (the v5.0.0 release notes mention "fix: unwatch deleted watched directory on Windows").

## 2. Problem

The architectural problem: **define the offline ingestion channels contract that (a) supports Manual upload (UI) via a Next.js API route that stages the file and triggers the ingest pipeline (ADR-028/029/034), (b) supports LAN-shared folder watch via chokidar watching an SMB-mounted folder on the PMS server (e.g., `\\hotelfs\sop-inbox\`), (c) supports USB-stick auto-import via an OS-level udev/AutoRun hook on Windows that triggers chokidar to detect the mount and bulk-import, (d) supports Batch CLI via a Node CLI script (`smartagentics ingest --path /sop-batch/ --recursive --tenant <id>`) that walks a folder and invokes the ingest pipeline per file, (e) reserves SFTP pull (nightly Restate workflow via the `ssh2` npm package), Email attachment ingestion (monitored inbox via `eml-parser`), and Cloud sync (Stream 7's offline-sync engine) as Phase 2+ channels, (f) records `sourceType` (UPLOAD | WATCH | BATCH | LAN | USB | EMAIL) on every `KnowledgeDocument` row for auditability, (g) uses chokidar (MIT, cross-platform, Windows-friendly) as the file-watch library for all watch-based channels, (h) runs all ingestion locally — no cloud calls; the offline-first principle is non-negotiable, (i) provides a passive hash-based nightly sweep (ADR-034) as a backup for chokidar missed events (research risk R-3.12), (j) supports per-channel RBAC (only admins can configure watch folders; only specific roles can upload), and (k) feeds Stream 7 (Offline Sync) — knowledge rows are tenant-scoped SQLite rows; `rawFileHash` enables sync conflict detection.** This ADR defines the ingestion channels; the ingest pipeline itself is owned by ADR-028/029/034; the freshness/staleness sweep is owned by ADR-035.

## 3. Options

### Option A: Cloud-only ingestion (SaaS-style upload to a cloud endpoint)

Ingest documents only via a cloud upload endpoint; no local ingestion. **Rejected** — violates the offline-first principle. The hotel server may be air-gapped; a cloud-only ingestion channel would be unavailable. Research §8.5.

### Option B: Database replication as ingestion (row-level sync from a corporate knowledge DB)

Ingest by replicating rows from a corporate knowledge database. **Rejected** — knowledge is document-shaped (PDF, DOCX, SOP, policy), not row-shaped. Replication would lose document structure (headings, tables, page numbers) required for citation (ADR-032). Research §8.5.

### Option C: Real-time streaming (Kafka-style) ingestion

Stream document ingestion events in real-time via Kafka or similar. **Rejected** — overkill for Phase 1 hotel scale. The hotel server is a single Next.js process; there is no event-streaming infrastructure. Research §8.5.

### Option D: Manual upload only (no watch, no CLI, no USB)

Support only manual UI upload; no automated channels. **Rejected** — does not meet the AI-BOS directive's "Knowledge ingestion — NOW" capability for hotel operations. Hotel staff need LAN-folder-watch (drop a SOP in `\\hotelfs\sop-inbox\` and it's ingested) and USB-stick auto-import (front-desk PC USB mount → bulk-import). Manual upload alone is too high-friction for daily operations.

### Option E: Multi-channel — Manual upload + LAN folder watch (chokidar) + USB auto-import + Batch CLI; SFTP/email/cloud Phase 2+

Phase 1: Manual upload (UI), LAN-shared folder watch (chokidar), USB-stick auto-import (Windows AutoPlay + chokidar), Batch CLI. Phase 2+: SFTP pull, Email attachment ingestion, Cloud sync. All ingestion runs locally; no cloud calls. `sourceType` recorded on every `KnowledgeDocument`. chokidar as the cross-platform file-watch library. Passive hash-based nightly sweep (ADR-034) as backup. Per research §8.2, §8.3, §8.4.

## 4. Decision

Adopt **Option E**. The Offline Ingestion Channels architectural contract is:

1. **Phase 1 channels** — Per research §8.2:

   | Channel                     | Trigger                                              | Implementation                                                      | Phase 1               |
   | --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | --------------------- |
   | **Manual upload (UI)**      | User clicks "Upload Document" in PMS UI              | Next.js API route → staged file → ingest pipeline (ADR-028/029/034) | ✅                    |
   | **LAN-shared folder watch** | File dropped in `\\hotelfs\sop-inbox\`               | chokidar watches SMB-mounted folder on the PMS server               | ✅                    |
   | **USB-stick auto-import**   | Front-desk PC USB mount                              | OS-level udev/AutoRun hook → chokidar detects mount → bulk-import   | ✅ (Windows AutoPlay) |
   | **Batch CLI**               | Admin runs `smartagentics ingest --path /sop-batch/` | Node CLI script invokes ingest pipeline on a folder                 | ✅                    |

2. **Phase 2+ channels (reserved)** — Per research §8.2:

   | Channel                        | Trigger                                                             | Implementation                                      | Phase    |
   | ------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------- | -------- |
   | **SFTP pull**                  | Nightly Restate workflow pulls from corporate SFTP                  | `ssh2` npm package → SFTP client → bulk import      | Phase 2+ |
   | **Email attachment ingestion** | Monitored inbox                                                     | `eml-parser` extracts attachments → ingest pipeline | Phase 2+ |
   | **Cloud sync (when online)**   | SmartAgentics sync engine (per ADR-001 offline-sync BUILD decision) | Stream 7's offline sync applies to KB rows too      | Phase 2+ |

3. **`sourceType` recorded on every `KnowledgeDocument`** — Per ADR-028 §9 and research §8.2:
   - `sourceType String` — enum: `UPLOAD` | `WATCH` | `BATCH` | `LAN` | `USB` | `EMAIL`.
   - `UPLOAD` = manual UI upload.
   - `WATCH` = chokidar watch (covers both LAN-shared folder and USB-stick auto-import; the `sourcePath` distinguishes them — `\\hotelfs\sop-inbox\...` vs `E:\usb-import\...`).
   - `BATCH` = batch CLI.
   - `LAN` = (Phase 2+ reserved for explicit LAN-pull; Phase 1 uses `WATCH` for LAN-shared folders).
   - `USB` = (Phase 2+ reserved for explicit USB-channel; Phase 1 uses `WATCH` for USB-stick auto-import).
   - `EMAIL` = (Phase 2+ email attachment ingestion).
   - Provides full auditability — Stream 8 (Security & Governance) can query "which documents were ingested via USB last week."

4. **chokidar as the file-watch library** — Per research §8.3:
   - **License**: MIT (verified via GitHub README header — "MIT license").
   - **Maturity**: 12.2k stars, 630 forks, v5.0.0 released Nov 2025.
   - **Why chokidar over raw `fs.watch`** (from official README, verified): "Events are properly reported; macOS events report filenames; events are not reported twice; changes are reported as add/change/unlink instead of useless rename; Atomic writes are supported; Chunked writes are supported; File/dir filtering is supported; Symbolic links are supported; Recursive watching is always supported."
   - **Critical for hotel deployment**: PMS server may run on Windows; chokidar explicitly fixes Windows `fs.watch` quirks (the v5.0.0 release notes mention "fix: unwatch deleted watched directory on Windows").
   - **Inference**: chokidar is the **only sensible choice** for cross-platform file watching in Node.js. Used for all watch-based ingestion channels (LAN-shared folder, USB-stick auto-import).

5. **Manual upload (UI) channel** —
   - PMS UI "Upload Document" button → Next.js API route (`/api/knowledge/upload`) → file staged to a local upload directory → `DocumentIngester.ingest()` (ADR-028) called.
   - The upload API route enforces RBAC (only specific roles can upload; ADR-031) and `tenantId`/`propertyId`/`department`/`aclRoles` extraction from the authenticated session (ADR-027/031).
   - `sourceType = UPLOAD`; `sourcePath = file:///<staged-path>`.
   - The UI shows upload progress + ingest status (`indexing` / `indexed` / `failed` per the existing `KnowledgeSource` DTO, ADR-028 §5).

6. **LAN-shared folder watch channel** —
   - chokidar watches a configured SMB-mounted folder on the PMS server (default: `\\hotelfs\sop-inbox\`).
   - On file add/change → `DocumentIngester.ingest()` (ADR-028) called.
   - `sourceType = WATCH`; `sourcePath = file:///<LAN-path>`.
   - The watch folder is per-tenant (or per-property) — a tenant's chokidar watches only that tenant's inbox. The watch configuration is RBAC-gated (only admins can configure watch folders).
   - chokidar is run in the Next.js server process (or a separate worker process for high-volume deployments).

7. **USB-stick auto-import channel** —
   - On Windows: AutoPlay hook detects USB mount → triggers a SmartAgentics bulk-import script → chokidar detects the mounted drive → bulk-import all files.
   - On macOS/Linux: udev rule (Linux) or launchd + disk-arbitration (macOS) detects USB mount → triggers the bulk-import script.
   - `sourceType = WATCH` (Phase 1; `sourcePath` distinguishes USB from LAN); `USB` reserved for Phase 2+ explicit-channel semantics.
   - The USB import is RBAC-gated (only specific roles can trigger USB import) and audited (`AuditEvent` eventType=`KNOWLEDGE_USB_IMPORT`).

8. **Batch CLI channel** — Per research §8.4:

   ```
   smartagentics ingest --path <folder> --recursive --tenant <id> [--property <id>] [--department <id>] [--type <enum>]
     ↓
   1. Walk folder recursively (chokidar-style glob)
   2. For each file:
      - Determine format (ADR-029)
      - Validate (size, format, virus-scan if Windows Defender CLI available)
      - Insert into KnowledgeDocument with sourceType=BATCH
      - Trigger ingest pipeline (ADR-028 §3.4)
   3. Emit batch-complete AuditEvent with summary {filesTotal, filesSuccess, filesFailed, totalChunks, durationMs}
   ```
   - The CLI is a Node script (`packages/cli/src/commands/ingest.ts`) — runs on the hotel server.
   - `sourceType = BATCH`; `sourcePath = file:///<batch-path>`.
   - The CLI is RBAC-gated (only admins can run it; the `--tenant` parameter must match the admin's tenant).

9. **Passive hash-based nightly sweep (backup for chokidar missed events)** — Per ADR-034 §3 step 2 and research §7.4:
   - Nightly Restate job re-hashes all source files; if `rawFileHash` differs from stored value → trigger re-ingestion.
   - Backup for chokidar missed events (research risk R-3.12: "File watcher (chokidar) misses events on Windows network drives").
   - Mitigation: passive hash-based nightly sweep; manual "Re-ingest" UI button; log all watch events for audit.

10. **All ingestion runs locally; no cloud calls** — Per research §8.5:
    - The offline-first principle is non-negotiable.
    - The `DocumentIngester` (ADR-028) calls only local services: `DocumentParser` (ADR-029), `EmbeddingsRuntime` (ADR-022 via Ollama), `VectorStore` (ADR-023 via sqlite-vec), `KnowledgeStore` (ADR-028 via SQLite).
    - No cloud LLM, no cloud embedding API, no cloud vector DB, no cloud storage.
    - The `LocalLLMRuntime.isAvailable()` check (ADR-030 §5) is fail-closed — if Ollama is down, ingestion fails (does not silently call cloud).

11. **Per-channel RBAC** — Per ADR-031:
    - **Manual upload**: only specific roles can upload (e.g., `front_desk_supervisor`, `gm`).
    - **LAN-shared folder watch**: only admins can configure watch folders.
    - **USB-stick auto-import**: only specific roles can trigger USB import.
    - **Batch CLI**: only admins can run the CLI; the `--tenant` parameter must match the admin's tenant.
    - All channels extract `tenantId` + `propertyIds` + `departments` + `aclRoles` from the authenticated session (manual upload) or from the channel configuration (watch folders, CLI — configured by admins).

12. **`AuditEvent` on every ingestion** — Per ADR-034 §3 step 10 and ADR-001:
    - `eventType = KNOWLEDGE_INGEST` on first ingestion.
    - `eventType = KNOWLEDGE_REINGEST` on re-ingestion (ADR-034).
    - `eventType = KNOWLEDGE_USB_IMPORT` on USB-stick auto-import (audit surface for security).
    - `eventType = KNOWLEDGE_BATCH_INGEST` on batch CLI completion (summary event with `{filesTotal, filesSuccess, filesFailed, totalChunks, durationMs}`).
    - Reuses the existing `AuditEvent` table.

## 5. Rationale

- **Multi-channel matches hotel operations practice** — Hotel staff drop SOPs in `\\hotelfs\sop-inbox\` (LAN watch); front-desk PCs auto-import USB sticks (USB auto-import); admins run `smartagentics ingest --path /sop-batch/` for bulk imports (batch CLI); ad-hoc uploads via the PMS UI (manual upload). Manual-upload-only (Option D) is too high-friction (research §8.2).
- **chokidar is the only sensible cross-platform file-watch library** — MIT-licensed, 12.2k stars, v5.0.0 (Nov 2025); explicitly fixes Windows `fs.watch` quirks. Raw `fs.watch` is unreliable on Windows network drives (research §8.3).
- **Offline-first is non-negotiable** — The hotel server may be air-gapped; cloud-only ingestion (Option A) would be unavailable. All ingestion runs locally; no cloud calls (research §8.5).
- **USB transfer is the canonical air-gap pattern** — Julia discourse (2023): "One machine at home to download all the files. Then 'burn' it on to a USB drive. Bring it to work." PrivacyGuides (2025): community confirmation. Everfox (2024): cross-domain solution pattern. The USB-stick auto-import channel operationalizes this pattern for hotel front-desk PCs (research §8.1).
- **LAN-shared folder watch is the hotel-specific extension** — Hotel properties share files via SMB-mounted folders; chokidar watching `\\hotelfs\sop-inbox\` is the natural ingestion trigger.
- **Batch CLI is the admin's bulk-import tool** — Walking a folder recursively and invoking the ingest pipeline per file is the standard batch-import pattern (research §8.4).
- **`sourceType` auditability** — Recording `UPLOAD | WATCH | BATCH | LAN | USB | EMAIL` on every `KnowledgeDocument` enables Stream 8 (Security & Governance) compliance queries ("which documents were ingested via USB last week?").
- **Passive hash-based nightly sweep is the backup** — chokidar may miss events on Windows network drives (research risk R-3.12); the nightly sweep (ADR-034) catches what chokidar missed.
- **Per-channel RBAC** — Only specific roles can upload / configure watch folders / trigger USB import / run the CLI. The channels extract `tenantId` + `propertyIds` + `departments` + `aclRoles` from the authenticated session (manual upload) or from the channel configuration (watch folders, CLI — configured by admins) (ADR-031).
- **`AuditEvent` on every ingestion** — `KNOWLEDGE_INGEST` / `KNOWLEDGE_REINGEST` / `KNOWLEDGE_USB_IMPORT` / `KNOWLEDGE_BATCH_INGEST` events provide full operational visibility — reuses the existing `AuditEvent` table (research §8.4, ADR-001).
- **Phase 2+ channels reserved** — SFTP pull (nightly Restate workflow via `ssh2`), Email attachment ingestion (`eml-parser`), Cloud sync (Stream 7's offline-sync engine) are Phase 2+ — additive `sourceType` values; no contract change (research §8.2, §17 Phase 2+ extensions).
- **Rejecting cloud-only ingestion (Option A)** — Violates offline-first principle (research §8.5).
- **Rejecting database replication (Option B)** — Knowledge is document-shaped, not row-shaped; replication loses document structure (research §8.5).
- **Rejecting real-time streaming (Option C)** — Overkill for Phase 1 hotel scale; no event-streaming infrastructure (research §8.5).
- **Rejecting manual-upload-only (Option D)** — Too high-friction for daily operations (research §8.2).

## 6. Consequences

**Positive**:

- Multi-channel ingestion matches hotel operations practice — LAN watch, USB auto-import, batch CLI, manual upload.
- chokidar is cross-platform and Windows-friendly — fixes `fs.watch` quirks.
- Offline-first is preserved — no cloud calls; all ingestion runs locally.
- `sourceType` auditability — Stream 8 can query ingestion channel for compliance.
- Passive hash-based nightly sweep (ADR-034) is the backup for chokidar missed events.
- Per-channel RBAC — only specific roles can configure / trigger each channel.
- `AuditEvent` on every ingestion (`KNOWLEDGE_INGEST`, `KNOWLEDGE_REINGEST`, `KNOWLEDGE_USB_IMPORT`, `KNOWLEDGE_BATCH_INGEST`) provides full operational visibility.
- Phase 2+ channels (SFTP, email, cloud sync) are additive `sourceType` values — no contract change.

**Negative / obligations**:

- Phase 1 must implement Manual upload (UI) + LAN-shared folder watch (chokidar) + USB-stick auto-import (Windows AutoPlay + chokidar) + Batch CLI — estimated 5–8 days (research §13.3: Chokidar watch 2–3 days + Batch CLI 3–5 days).
- chokidar may miss events on Windows network drives (research risk R-3.12, Medium/Medium) — mitigation: passive hash-based nightly sweep (ADR-034); manual "Re-ingest" UI button; log all watch events for audit.
- USB-stick auto-import requires OS-level hooks (Windows AutoPlay, Linux udev, macOS launchd) — platform-specific implementation; Phase 1 may ship Windows-only.
- The batch CLI requires admin RBAC — the `--tenant` parameter must match the admin's tenant; the CLI must not allow cross-tenant ingestion.
- The watch folder configuration is RBAC-gated — only admins can configure watch folders; the configuration UI is an obligation.
- The LAN-shared folder watch requires SMB mount on the PMS server — operational dependency; the installer must document SMB setup.
- chokidar runs in the Next.js server process (or a separate worker process for high-volume deployments) — resource consumption (file descriptors, CPU) must be monitored.
- The nightly hash-based sweep re-hashes all source files — for large corpora (10K+ documents), this is I/O-intensive (ADR-034 §6).
- The `DocumentIngester.ingest()` call is synchronous per file (within a single ingestion) but ingestion across files should be parallelized — Restate workflow durability handles per-file failures.
- The USB-stick auto-import is an audit surface — `KNOWLEDGE_USB_IMPORT` `AuditEvent` records who triggered it when; Stream 8 may audit.
- Virus-scan if Windows Defender CLI available — research §8.4 step 2 mentions this; the installer must document Windows Defender integration.

**Dependencies on other ADRs**:

- Depends on ADR-028 (Knowledge Base Architecture) — `DocumentIngester.ingest()` SDK method; `KnowledgeDocument.sourceType` column.
- Depends on ADR-029 (Parser Stack) — `DocumentParser` is called by the ingest pipeline for every channel.
- Depends on ADR-034 (Versioning & Incremental Re-index) — re-ingestion algorithm; passive hash-based nightly sweep backup.
- Depends on ADR-035 (Freshness & Staleness) — `lastVerifiedAt` updated on every ingestion attempt.
- Depends on ADR-031 (Knowledge Isolation) — per-channel RBAC; `tenantId` + `propertyIds` + `departments` + `aclRoles` extraction.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` mandatory on every ingested chunk.
- Depends on ADR-001 (Reference Stack) — Next.js API routes; Restate workflow orchestrator; `AuditEvent` existing table; Auth.js session context.
- Depends on ADR-005 (Prisma) for `KnowledgeDocument.sourceType` column; ADR-006 (SQLite) for persistence.
- Feeds Stream 7 (Offline Sync) — `sourceType` + `rawFileHash` enable sync conflict detection; cloud sync is a Phase 2+ channel.
- Feeds Stream 8 (Security & Governance) — `sourceType` auditability; `KNOWLEDGE_USB_IMPORT` is a security-relevant event.
- Compatible with ADR-013 (Observability Strategy) — ingestion operations are traced (channel, file, durationMs, chunksAdded).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **chokidar misses events on Windows network drives in production** (research risk R-3.12) — tighten the passive hash-based nightly sweep schedule; add a manual "Re-ingest all" UI button; evaluate alternative watch libraries.
2. **USB-stick auto-import is requested on macOS/Linux** — implement udev rules (Linux) + launchd + disk-arbitration (macOS); verify the bulk-import script.
3. **A Phase 2+ SFTP pull channel is requested** — implement the nightly Restate workflow via the `ssh2` npm package; add `sourceType = SFTP` (or reuse `LAN`); verify RBAC.
4. **A Phase 2+ Email attachment ingestion channel is requested** — implement the monitored inbox via `eml-parser`; add `sourceType = EMAIL`; verify RBAC.
5. **A Phase 2+ Cloud sync channel is requested** (Stream 7) — implement the sync engine; add `sourceType = CLOUD_SYNC`; verify offline-first principle (sync only when online; never auto-fallback).
6. **A new ingestion channel** (e.g., webhook from a document-management system) becomes relevant — add as a new `sourceType` value; trigger the same `DocumentIngester.ingest()` pipeline.
7. **The batch CLI is used for high-volume imports** (>10K files per batch) — parallelize ingestion; verify Restate workflow durability; monitor resource consumption.
8. **The watch folder configuration becomes operationally painful** (e.g., many tenants, many folders) — implement a watch-folder management UI; per-tenant configuration.
9. **Virus-scan integration becomes a compliance requirement** — bundle Windows Defender CLI integration; document the setup; audit per-file scan results.
10. **Annually**, as part of the regular ADR review cycle.
