# ADR-034: Versioning & Incremental Re-index

**ADR-ID:** ADR-034
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Document Versioning** as an "Architecture Contract — NOW" capability (Phase B B4 item #18). Hotel SOPs, policies, rate sheets, and announcements are versioned documents — they change over time. Re-ingesting a 30-page SOP after a one-paragraph edit must NOT require re-embedding all ~150 chunks; that would be wasteful (Reddit r/Rag 2025: "re-embedding entire docs is wasteful"; research §7.1). Citations referencing a chunk from version 3 must remain resolvable after the document is re-ingested to version 4 (ADR-032 §6.2.2). Embedding-model upgrades (nomic-embed-text v1.5 → v2-MoE) require a full reindex without downtime (Qdrant migration tutorial — blue-green dual-index pattern).

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §7.1, §7.2) documented the incremental re-indexing evidence: Kapa.ai (2026) — "A RAG index is a point-in-time snapshot; without a refresh pipeline it drifts out of sync the moment your docs change. Keeping it in sync means detecting what changed at each source, re-ingesting and re-embedding only the deltas, validating before publishing." Content hashing (Zimaspace 2026) — "Content hashing prevents unnecessary re-embedding by giving each file or chunk a deterministic fingerprint that changes when the hashed content changes." CocoIndex (2025) — "When a document is edited, CocoIndex reuses cached embeddings for unchanged chunks, removes rows for chunks that no longer exist, and adds rows [for new chunks]." Safjan (2026) — "Version Your Vectors - Index Versioning as the Missing Layer in RAG... A reindexing job silently drops a document partition due to a pipeline bug." Oracle (2026) — "How to Detect RAG Index Drift: Deleted Docs, Stale Chunks and Duplicate Embeddings."

The recommended versioning model: `KnowledgeDocument.currentVersion Int` + `contentHash` (SHA-256 of normalized markdown) + `rawFileHash` (SHA-256 of original file bytes). On re-ingestion: if `rawFileHash` unchanged → skip (no work); if `contentHash` unchanged → skip re-embedding; else compute per-chunk hashes (`chunkHash = SHA-256(chunk text)`), re-embed only new/changed child chunks, reuse embeddings for unchanged chunks (skip Ollama call), soft-delete removed chunks. For embedding-model upgrades: blue-green dual-index reindex (Qdrant-documented) — build `KnowledgeChunkVector_v2` alongside `KnowledgeChunk_vector`; once 100% complete, switch reads to v2 and archive v1. `KnowledgeCitation.docVersion` snapshot preserves citation resolvability across re-ingestion (ADR-032 §6.2.2).

## 2. Problem

The architectural problem: **define a document versioning + incremental re-indexing contract that (a) stamps every `KnowledgeDocument` with `currentVersion Int @default(1)`, `contentHash String` (SHA-256 of normalized markdown), and `rawFileHash String` (SHA-256 of original file bytes), (b) stamps every `KnowledgeChunk` with `docVersion Int` (snapshot version — citations reference this), `chunkHash String` (SHA-256 of chunk text), and `deletedAt DateTime?` (soft-delete), (c) implements the re-ingestion algorithm: rawFileHash unchanged → skip; contentHash unchanged → skip re-embedding; else per-chunk hash delta — reuse embeddings for unchanged chunks (skip Ollama call), embed new/changed chunks, soft-delete removed chunks, (d) achieves ~50× cost reduction on typical SOP edits (1 paragraph changed in a 30-page document → ~3 chunks re-embedded instead of ~150), (e) increments `KnowledgeDocument.currentVersion` on every content-changing re-ingestion; old chunks retain their `docVersion` snapshot (soft-deleted, not hard-deleted) so `KnowledgeCitation` rows referencing them remain resolvable (ADR-032 §6.2.2), (f) implements blue-green dual-index reindex for embedding-model upgrades (nomic-embed-text v1.5 → v2-MoE): build `KnowledgeChunkVector_v2` alongside `KnowledgeChunk_vector`; once 100% complete, switch reads to v2 and archive v1 — zero downtime (Qdrant-documented pattern), (g) emits `AuditEvent` (eventType=KNOWLEDGE_REINGEST) with details `{oldVersion, newVersion, chunksAdded, chunksReused, chunksDeleted}` on every re-ingestion, (h) supports change detection via file-watch (chokidar, ADR-036), hash-based nightly sweep, manual UI button, and email-triggered (Phase 2+), (i) runs as a Restate workflow (already chosen in ADR-001) — no new orchestrator, and (j) feeds Stream 7 (Offline Sync) — `rawFileHash` enables sync conflict detection.** This ADR defines the versioning + re-indexing contract; the freshness/staleness contract is owned by ADR-035; the ingestion channels are owned by ADR-036.

## 3. Options

### Option A: Full re-embedding on every re-ingestion

Re-embed all chunks whenever a document is re-ingested, regardless of what changed. Rejected — wasteful. Reddit r/Rag (2025): "re-embedding entire docs is wasteful." For a typical SOP edit (1 paragraph in 30 pages), full re-embedding = ~150 embedding calls; incremental = ~3. **50× cost reduction** lost. Research §7.1.

### Option B: Append-only with versioning (every chunk update creates a new vector with a new version; queries filter to `version = latest`)

Every chunk update creates a new row with a new `docVersion`; old rows are retained; queries filter to `version = latest`. Rejected — research §12.1 "Rejected alternatives" mentions this as a review-trigger candidate if soft-delete + delta becomes painful. Pros: full audit history; cons: storage grows monotonically; queries must filter to `version = latest` (extra WHERE clause). Reserved as a fallback if soft-delete + delta proves operationally painful (ADR-026 §7 review trigger).

### Option C: Hard-delete removed chunks on re-ingestion

Hard-delete `KnowledgeChunk` rows for chunks no longer present in the new document version. Rejected — orphans `KnowledgeCitation` rows referencing the deleted chunks (ADR-032 §6.2.2). Citations must remain resolvable for the retention period (7 years default). Soft-delete (`deletedAt`) preserves resolvability.

### Option D: Single-vector-table reindex for embedding-model upgrades (in-place)

Drop the old `KnowledgeChunk_vector` table and rebuild it with the new embedding model in place. Rejected — downtime during reindex; queries fail until reindex completes. Safjan (2026): "A reindexing job silently drops a document partition due to a pipeline bug." The Qdrant-documented blue-green dual-index pattern avoids downtime.

### Option E: SHA-256 chunk-hash delta + soft-delete + `docVersion` snapshot + blue-green dual-index for embedding-model upgrades

`KnowledgeDocument.currentVersion` + `contentHash` + `rawFileHash`. `KnowledgeChunk.docVersion` + `chunkHash` + `deletedAt`. Re-ingestion: rawFileHash unchanged → skip; contentHash unchanged → skip re-embedding; else per-chunk hash delta — reuse embeddings for unchanged chunks, embed new/changed chunks, soft-delete removed chunks. Embedding-model upgrade: blue-green dual-index (`KnowledgeChunkVector_v2` alongside `KnowledgeChunk_vector`; switch reads to v2 when 100% complete). `KnowledgeCitation.docVersion` snapshot preserves citation resolvability. Per research §7.2.

## 4. Decision

Adopt **Option E**. The Versioning & Incremental Re-index architectural contract is:

1. **`KnowledgeDocument` versioning columns** — Per ADR-028 §9 and research §7.2.1:
   - `currentVersion Int @default(1)` — the current version number; increments on every content-changing re-ingestion.
   - `contentHash String` — SHA-256 of normalized markdown (the canonical IR after parsing, ADR-029). Changes when document content changes (even if `rawFileHash` is unchanged due to parsing normalization differences).
   - `rawFileHash String` — SHA-256 of original file bytes. Changes when the source file changes on disk.
   - `lastVerifiedAt DateTime` — updated on every re-ingestion attempt (even no-op).
   - `lastIngestedAt DateTime` — updated on every content-changing re-ingestion.
   - Unique constraint `@@unique([tenantId, propertyId, sourcePath])` — one document per (tenant, property, source path).
   - Indexes: `@@index([tenantId, lastVerifiedAt])`, `@@index([contentHash])`.

2. **`KnowledgeChunk` versioning columns** — Per ADR-028 §9 and research §7.2.1:
   - `docVersion Int` — snapshot version at chunk creation. A chunk created at version 3 retains `docVersion=3` even after the document is at version 4 (the chunk is soft-deleted, not updated).
   - `chunkHash String` — SHA-256 of chunk text. Invariant for unchanged text; changes when the chunk's text changes. Used for delta detection (reuse embeddings for unchanged chunks).
   - `deletedAt DateTime?` — soft-delete timestamp. Null for live chunks; non-null for chunks removed in a later re-ingestion.
   - Indexes: `@@index([docId, docVersion])`, `@@index([chunkHash])`.

3. **Re-ingestion algorithm** — Per research §7.2.2:

   ```
   on file change detected (chokidar, ADR-036) or manual re-upload or hash-based nightly sweep:
     1. rawFileHash_new = SHA-256(file bytes)
     2. if rawFileHash_new == KnowledgeDocument.rawFileHash:
          → update lastVerifiedAt = now(); done (no work)
     3. parse file → normalized Markdown (ADR-029)
     4. contentHash_new = SHA-256(normalized Markdown)
     5. if contentHash_new == KnowledgeDocument.contentHash:
          → update lastVerifiedAt = now(); done (no re-embedding)
     6. chunk the new Markdown → new_chunks[] (ADR-026)
     7. for each new_chunk:
          chunkHash = SHA-256(chunk text)
          look up existing KnowledgeChunk where docId=? AND chunkHash=? AND deletedAt IS NULL
          if found: reuse its embedding (skip Ollama call); update parentChunkId if changed
          if not found: embed via Ollama (ADR-022); insert new KnowledgeChunk at docVersion = currentVersion + 1
     8. for each existing chunk not in new_chunks (by chunkHash):
          soft-delete (deletedAt = now())
     9. KnowledgeDocument.currentVersion++, contentHash=contentHash_new,
        rawFileHash=rawFileHash_new, lastIngestedAt=now, lastVerifiedAt=now
     10. emit AuditEvent (eventType=KNOWLEDGE_REINGEST, details={oldVersion, newVersion, chunksAdded, chunksReused, chunksDeleted})
   ```

4. **Cost savings** — Per research §7.2.2:
   - For a typical SOP edit (1 paragraph changed in a 30-page document): only ~3 chunks change → only 3 embedding calls instead of ~150.
   - **50× cost reduction** on typical updates.
   - For unchanged documents (`rawFileHash` match): 0 embedding calls (skip entirely).
   - For documents with formatting-only changes (`contentHash` match after normalization): 0 embedding calls (skip re-embedding).

5. **`chunkHash` stability** — Per research §7.2.2:
   - `chunkHash = SHA-256(chunk text)` — invariant for unchanged text.
   - A chunk with unchanged text retains its `chunkId` (CUID) and its embedding is reused (no Ollama call).
   - A chunk with changed text gets a new `chunkId` (CUID); the old chunk is soft-deleted (`deletedAt`); the new chunk is inserted at the new `docVersion`.
   - SHA-256 collision risk is negligible (research risk R-3.10). If paranoid, include `chunkIndex` in the hash.

6. **Soft-delete (never hard-delete) `KnowledgeChunk` rows** — Per ADR-032 §6.2.2:
   - `deletedAt DateTime?` — soft-delete on re-ingestion.
   - **Never hard-delete** a `KnowledgeChunk` until all `KnowledgeCitation` rows referencing it are themselves archived.
   - Retention policy: 7 years for compliance-relevant docs (research §18 #3 open question); per-tenant configurable.
   - The `CitationResolver.resolve(chunkId, docVersion)` (ADR-032) looks up soft-deleted chunks if needed — citations remain resolvable.

7. **`docVersion` snapshot for citation stability** — Per ADR-032 §6.2.2 and research §7.2.1:
   - `KnowledgeChunk.docVersion Int` — snapshot version at chunk creation.
   - `KnowledgeCitation.docVersion Int` — snapshot version at citation time (ADR-032 §4).
   - When a document is re-ingested, `currentVersion` increments; new chunks get the new `docVersion`; old chunks (unchanged) keep their `docVersion`; changed chunks are soft-deleted and replaced with new chunks at the new `docVersion`.
   - A `KnowledgeCitation` referencing `docVersion=3` remains resolvable even after the document is at `docVersion=4` — the soft-deleted v3 chunks are retained for the retention period.

8. **Embedding-model upgrade reindex (blue-green dual-index)** — Per research §7.2.3:
   - When the embedding model is upgraded (e.g., nomic-embed-text v1.5 → v2-MoE per ADR-022), run a **blue-green dual-index reindex** as a Restate workflow:
     1. Build a new `KnowledgeChunkVector_v2` table alongside the old `KnowledgeChunk_vector` (v1) table.
     2. For each live `KnowledgeChunk` (deletedAt IS NULL), re-embed with the new model and insert into `KnowledgeChunkVector_v2`.
     3. Once 100% complete, switch reads to v2 (`Retriever` queries `KnowledgeChunkVector_v2` instead of `KnowledgeChunk_vector`).
     4. Archive v1 (`KnowledgeChunk_vector` retained for the retention period; not queried).
   - **Zero downtime** — queries continue against v1 during reindex; cutover to v2 is a config flip.
   - Old citations continue to resolve via the `docVersion` snapshot (ADR-032) — the v1 vectors are retained for the retention period.
   - Qdrant migration pattern (research §7.2.3): "A migration process copies the data from the old collection to the new one, re-embedding vectors using the new model. During the migration, you keep searching [the old index]."
   - aboutvectordatabase.com (research §7.2.3): "The only robust fix is to re-embed and re-index: run all stored documents (or their source text) through the new model and replace the vectors in the VDB."
   - Safjan (research §7.2.3): "Version Your Vectors - Index Versioning as the Missing Layer in RAG."

9. **`AuditEvent` on every re-ingestion** — Per research §7.2.2 step 10:
   - `eventType = KNOWLEDGE_REINGEST`.
   - `actorId` = system (chokidar trigger) or user (manual re-upload).
   - `resource` = `KnowledgeDocument:<id>`.
   - `details` = JSON: `{oldVersion, newVersion, chunksAdded, chunksReused, chunksDeleted, durationMs}`.
   - Reuses the existing `AuditEvent` table (ADR-001) — no new audit infrastructure.

10. **Change detection channels** — Per research §7.4 and ADR-036:
    - **File-watch (active)**: chokidar watches configured directories (LAN-shared folder, USB mount point, local upload staging). On file change → trigger re-ingestion workflow.
    - **Hash-based (passive)**: nightly Restate job re-hashes all source files; if `rawFileHash` differs from stored value → trigger re-ingestion. Backup for chokidar missed events (research risk R-3.12).
    - **Manual (user-initiated)**: PMS UI "Re-ingest" button on each document.
    - **Email-triggered (Phase 2+)**: monitored inbox triggers ingestion of attached SOPs (ADR-036).

11. **Restate workflow orchestration** — Per ADR-001 (Restate already chosen as workflow orchestrator):
    - Re-ingestion is a Restate workflow — durable, resumable, observable.
    - The nightly hash-based sweep is a Restate scheduled workflow.
    - The embedding-model-upgrade blue-green reindex is a long-running Restate workflow with progress tracking.
    - No new orchestrator.

## 5. Rationale

- **SHA-256 chunk-hash delta is the industry-standard incremental re-indexing pattern** — CocoIndex (2025): "When a document is edited, CocoIndex reuses cached embeddings for unchanged chunks, removes rows for chunks that no longer exist, and adds rows [for new chunks]." Content hashing (Zimaspace 2026): "Content hashing prevents unnecessary re-embedding by giving each file or chunk a deterministic fingerprint that changes when the hashed content changes." Medium (Vasanthan): "Hashing converts document content into a unique fingerprint. If content changes: Old Hash != New Hash. Then the document must be reindexed." (research §7.1).
- **50× cost reduction on typical SOP edits** — For a 1-paragraph change in a 30-page document: ~3 chunks re-embedded instead of ~150. Critical for hotel hardware (Phi-3.5-mini @ Q4_K_M ~12 tok/s; embedding via nomic-embed-text-v1.5; re-embedding 150 chunks would take minutes; re-embedding 3 takes seconds) (research §7.2.2).
- **Soft-delete preserves citation resolvability** — Hard-deleting a chunk would orphan its `KnowledgeCitation` rows. Soft-delete (`deletedAt`) + 7-year retention preserves resolvability — critical for compliance (research §6.2.2, ADR-032 §6.2.2).
- **`docVersion` snapshot preserves citation stability across re-ingestion** — A `KnowledgeCitation` referencing `docVersion=3` remains resolvable after the document is at `docVersion=4` — the soft-deleted v3 chunks are retained. This is the "specific version that was used to generate the answer" guarantee (research §6.2.2).
- **Blue-green dual-index for embedding-model upgrades is the Qdrant-documented pattern** — Zero downtime; queries continue against v1 during reindex; cutover to v2 is a config flip. aboutvectordatabase.com: "The only robust fix is to re-embed and re-index." Safjan: "Version Your Vectors - Index Versioning as the Missing Layer in RAG." (research §7.2.3).
- **`rawFileHash` vs `contentHash` two-tier hashing** — `rawFileHash` (SHA-256 of file bytes) detects any file change (cheap; no parsing needed). `contentHash` (SHA-256 of normalized markdown) detects content change after parsing (avoids re-embedding on formatting-only changes). The two-tier approach minimizes both parsing and embedding cost (research §7.2.2).
- **`AuditEvent` on every re-ingestion** — `KNOWLEDGE_REINGEST` event with `{oldVersion, newVersion, chunksAdded, chunksReused, chunksDeleted}` provides full operational visibility — reuses the existing `AuditEvent` table (research §7.2.2 step 10).
- **Restate workflow orchestration** — Re-ingestion, nightly sweep, and blue-green reindex are Restate workflows — durable, resumable, observable. No new orchestrator (ADR-001).
- **Rejecting full re-embedding (Option A)** — Wasteful; 50× cost reduction lost (research §7.1).
- **Rejecting append-only with versioning (Option B)** — Storage grows monotonically; queries must filter to `version = latest`. Reserved as a fallback if soft-delete + delta proves operationally painful (research §12.1, ADR-026 §7 review trigger).
- **Rejecting hard-delete (Option C)** — Orphans `KnowledgeCitation` rows; violates citation resolvability (ADR-032 §6.2.2).
- **Rejecting in-place reindex (Option D)** — Downtime during reindex; queries fail until reindex completes (research §7.2.3, Safjan).

## 6. Consequences

**Positive**:

- ~50× cost reduction on typical SOP edits — 3 chunks re-embedded instead of 150.
- Two-tier hashing (`rawFileHash` + `contentHash`) minimizes both parsing and embedding cost.
- Soft-delete + 7-year retention preserves citation resolvability across re-ingestion.
- `docVersion` snapshot preserves citation stability — citations reference the specific version that generated the answer.
- Blue-green dual-index for embedding-model upgrades — zero downtime.
- `AuditEvent` (`KNOWLEDGE_REINGEST`) on every re-ingestion provides full operational visibility.
- Restate workflow orchestration — durable, resumable, observable; no new orchestrator.
- `chunkHash` enables delta detection — unchanged chunks retain `chunkId` (CUID) and embedding.

**Negative / obligations**:

- Phase 1 must implement the re-ingestion algorithm + `chunkHash` delta + soft-delete + `AuditEvent` emission — estimated 2–3 days (research §13.3).
- The re-ingestion algorithm must be atomic per document — a partial re-ingestion (e.g., Ollama crash mid-embedding) must not leave the document in an inconsistent state. Mitigation: Restate workflow durability; transactional Prisma writes; resume-from-checkpoint.
- Soft-deleted chunks accumulate over time — periodic hard-purge of chunks with no remaining citations and past the retention period is needed (a Restate workflow).
- `chunkHash` collision risk is negligible (SHA-256) but not zero — research risk R-3.10 (Negligible/Low). Mitigation: include `chunkIndex` in the hash if paranoid.
- Blue-green dual-index reindex doubles vector storage during the migration — `KnowledgeChunkVector_v2` alongside `KnowledgeChunk_vector`. Mitigation: archive v1 promptly after cutover.
- The `chunkHash` delta assumes the chunker (ADR-026) is deterministic — same input markdown produces same chunks. If the chunker's algorithm changes (e.g., `chunkSize` default tuned), `chunkHash` matches may break. Mitigation: pin the chunker version; re-chunk all documents on chunker upgrade (a Restate workflow).
- The nightly hash-based sweep re-hashes all source files — for large corpora (10K+ documents), this is I/O-intensive. Mitigation: batch; parallelize; schedule off-peak.
- `rawFileHash` requires re-reading the source file — for documents sourced from URLs (http://...), this means re-downloading. Mitigation: HTTP `If-Modified-Since` / `ETag` headers; cache the downloaded file.
- chokidar may miss events on Windows network drives (research risk R-3.12) — the nightly hash-based sweep is the backup.
- The `KnowledgeCitation` retention policy (7 years default) is an open question (research §18 #3) — must be finalized in Phase E.

**Dependencies on other ADRs**:

- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeDocument.currentVersion` + `contentHash` + `rawFileHash`; `KnowledgeChunk.docVersion` + `chunkHash` + `deletedAt`.
- Depends on ADR-029 (Parser Stack) — re-ingestion re-parses via the same `DocumentParser`; `parserUsed` + `parseWarnings` updated.
- Depends on ADR-026 (Document Chunking) — re-ingestion re-chunks via the same `Chunker`; chunker determinism required for `chunkHash` delta.
- Depends on ADR-022 (Local Embeddings) — re-embedding via `EmbeddingsRuntime.embed()`; embedding-model upgrade triggers blue-green reindex.
- Depends on ADR-032 (Source Attribution & Citation) — `KnowledgeCitation.docVersion` snapshot; soft-delete preserves resolvability.
- Depends on ADR-036 (Offline Ingestion Channels) — chokidar file-watch triggers re-ingestion; manual UI button; nightly hash-based sweep.
- Depends on ADR-001 (Reference Stack) — Restate workflow orchestrator; `AuditEvent` existing table.
- Depends on ADR-005 (Prisma) for schema management; ADR-006 (SQLite) for persistence.
- Feeds ADR-035 (Freshness & Staleness) — `lastVerifiedAt` updated on every re-ingestion attempt; staleness sweep uses `lastVerifiedAt`.
- Feeds ADR-030 (RAG Pipeline) — `SemanticCacheEntry` invalidation on re-ingestion (chunks may have changed).
- Feeds Stream 7 (Offline Sync) — `rawFileHash` enables sync conflict detection.
- Feeds Stream 8 (Security & Governance) — `KNOWLEDGE_REINGEST` `AuditEvent` is the audit trail.
- Compatible with ADR-013 (Observability Strategy) — re-ingestion operations are traced (docId, oldVersion, newVersion, chunksAdded, chunksReused, chunksDeleted, durationMs).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Soft-delete + delta proves operationally painful** (e.g., soft-deleted chunks accumulate beyond SQLite's practical limit) — switch to append-only with versioning (Option B); queries filter to `version = latest`; periodic compaction.
2. **An embedding-model upgrade is scheduled** (nomic-embed-text v1.5 → v2-MoE per ADR-022) — execute the blue-green dual-index reindex Restate workflow; verify zero-downtime cutover; archive v1.
3. **The chunker's algorithm changes** (e.g., `chunkSize` default tuned per ADR-026) — `chunkHash` matches may break; re-chunk all documents (a Restate workflow).
4. **`chunkHash` collision is detected** (negligible risk, R-3.10) — include `chunkIndex` in the hash; re-chunk all documents.
5. **chokidar misses events on Windows network drives** (risk R-3.12) — tighten the nightly hash-based sweep schedule; add a manual "Re-ingest all" UI button.
6. **A partial re-ingestion leaves a document in an inconsistent state** — tighten the atomicity guarantee (Restate workflow durability; transactional Prisma writes; resume-from-checkpoint).
7. **`KnowledgeCitation` retention policy** (>7 years) is finalized (research §18 #3) — implement the hard-purge workflow for chunks past retention with no remaining citations.
8. **The nightly hash-based sweep is I/O-intensive** for large corpora (>10K documents) — batch; parallelize; schedule off-peak.
9. **A new change-detection channel** (e.g., webhook from a document-management system) becomes relevant — add as a new `sourceType` value; trigger the same re-ingestion workflow.
10. **Annually**, as part of the regular ADR review cycle.
