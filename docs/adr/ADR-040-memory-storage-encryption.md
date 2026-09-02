# ADR-040: Memory Storage & Encryption

**ADR-ID:** ADR-040
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) established that memory lives in the **same SQLite database as PMS data** (and as the Stream 3 knowledge base), scoped by `tenantId` mandatory NOT NULL, with no separate database process. ADR-039 (Taxonomy) established the 7-category contract. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §12, §13) details the storage schema and the encryption-at-rest layer that protects it.

The Microsoft SFI (Secure Future Initiative) guidance (research §9.1, §12.1) is unambiguous: memory is both high-value data AND a control plane, and requires "isolation by user, agent, and tenant using deterministic controls like ACLs, scoped tokens, **encryption at rest and in transit**." The OWASP AI Agent Security Cheat Sheet (research §12.1) lists five controls, including "use cryptographic integrity checks for long-term memory." The research documents the threat: a stolen laptop or backup file exposes all tenant memory if there is no encryption at rest — "Shared Agent Memory: The Multi-Tenant Time Bomb" (research §12.1).

The encryption solution that fits SmartAgentics' offline-first single-file SQLite substrate is **SQLCipher** (research §12.2): "a specialized build of the excellent SQLite database [with] transparent and on-the-fly encryption. The encryption algorithm is 256-bit AES in CBC mode." SQLCipher is a drop-in SQLite fork (Apache-2.0-compatible) — the existing Prisma+SQLite stack adopts it by swapping the SQLite binding (e.g., `better-sqlite3` → `better-sqlite3-sqlcipher` or `@vscode/sqlite3` with SQLCipher build). No new database process, no Python runtime, no cloud KMS dependency. The master key lives in the OS keychain (Windows Credential Manager / macOS Keychain / Linux secret service), with per-tenant keys derived via HKDF.

The research (§12.2, §12.3) also documents that the choice of sqlite-vec (Stream 2, ADR-023) pays off for memory: sqlite-vec's OLTP-optimized UPDATE/INSERT/DELETE (verified from Alex Garcia's blog) makes cascading deletes and integrity-check recomputations fast. If sqlite-vec required a full index rebuild on every write (like the deprecated sqlite-vss), cascading GDPR deletes would be infeasible at scale.

## 2. Problem

The architectural problem: **define the memory storage schema and encryption-at-rest contract that (a) extends the existing Prisma schema with 3 new additive models (`MemoryRecord`, `MemoryEvent`, `MemoryAccessLog`) + 2 enums (`MemoryType`, `MemoryScope`) + 2 raw SQL virtual-table migrations (`vec0_memrecord` sqlite-vec + `memrecord_fts` FTS5), with no existing model modified; (b) makes `tenantId` NOT NULL on every memory table, with composite indexes optimized for the four-dimensional scope queries (tenant/property/user/agent/session) and the retention sweep (expiresAt/retentionExpiresAt/deletedAt); (c) makes the `MemoryRecord` envelope carry the full lifecycle machinery (confidence, importance, writtenAt, lastConfirmedAt, expiresAt, retentionPolicy, halfLifeDays, timesRetrieved, timesRetrievedAndConfirmed, sensitivity, supersedes, supersededBy, provenance, metadata, deletedAt, contentHash) so a single row answers all lifecycle, retrieval, and audit questions; (d) partitions the `vec0_memrecord` sqlite-vec virtual table on `tenant_id` (per Stream 2's ADR-027 multi-tenant pattern) so memory retrieval is isolated from knowledge retrieval and cross-tenant leakage is structurally prevented; (e) adopts SQLCipher (AES-256-CBC) as the encryption-at-rest layer — opt-in per tenant in Phase 1 (default off for dev; default on for production), mandatory in Phase 2+ for any tenant with PII in memory (which is all tenants); (f) derives per-tenant encryption keys from a master key via HKDF, with the master key stored in the OS keychain (Windows Credential Manager via `keytar` or equivalent) — a stolen database file is useless without the tenant key; (g) reserves field-level encryption (Phase 2+) for extra-sensitive memory fields (dietary allergies, accessibility needs) with a separate key derived from `tenantId + userId`, protecting against a compromised admin reading all user memories; (h) reserves per-tenant SQLite files (Phase 2+, Stream 2's collection-per-tenant pattern) as the strongest isolation for high-security tenants (chains, luxury brands); (i) carries a `contentHash` (SHA-256 of content + provenance + timestamps) on every `MemoryRecord` for cryptographic integrity checks — the OWASP control against tampering; (j) makes all storage operations transactional with PMS operations (SQLite WAL crash-safety) so a power failure mid-session does not lose working memory; and (k) feeds ADR-041 (Permissions) — the schema's `tenantId`/`scope`/`department` columns are the substrate the Prisma middleware enforces against.** This ADR is the storage-and-encryption companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-028 (Knowledge Base Architecture schema) and Stream 2's ADR-023 (Vector Store) + ADR-027 (Multi-Tenant Vector Isolation).

## 3. Options

### Option A: No encryption at rest (rely on OS file permissions)

Use plain SQLite files; rely on Windows NTFS ACLs / Linux file permissions to protect the database file. **Rejected** — research §12.5: insufficient — a stolen laptop or backup file exposes all tenant memory. SQLCipher is cheap insurance (5–15% overhead per Zetetic benchmarks). OS file permissions do not protect backups, do not protect against physical theft, do not protect against malicious admins with filesystem access.

### Option B: Application-level encryption (encrypt fields in JS, store ciphertext in SQLite)

Encrypt the `content` field in JavaScript before persisting; store ciphertext in SQLite. **Rejected** — research §12.5: slower (can't index encrypted fields — FTS5 and sqlite-vec both need plaintext); harder to query (every query needs decryption); key management in application code (more attack surface). SQLCipher's transparent encryption is superior — the database file is encrypted at rest but the Prisma client sees plaintext, so FTS5 and sqlite-vec work normally.

### Option C: Separate database per tenant (database-per-tenant) with per-tenant SQLCipher keys

One encrypted SQLite file per tenant, each with its own key. **Rejected as default** — research §9.5, §12.2: strong isolation but operationally heavy (thousands of SQLite files for a chain; backup/migration/schema-evolution per file; connection-pool management per file). Reserved for Phase 2+ opt-in for high-security tenants (chains, luxury brands). Phase 1 uses shared-schema with `tenantId` partition + single SQLCipher-encrypted database file with per-tenant derived keys (key separation without file separation).

### Option D: Postgres + pgvector from Phase 1 (skip SQLite for memory)

Use Postgres (with pgvector) as the memory substrate from Phase 1, with Postgres-native row-level security. **Rejected** — research §9.5, ADR-001: Postgres is a server process; breaks offline-first single-file SQLite principle; incompatible with the offline Windows installer. SQLite does not natively support RLS, but Prisma middleware achieves the same effect. Postgres+pgvector is the Phase 2+ cloud-parity target (`PostgresMemoryStore`), not the Phase 1 default.

### Option E: Trusted Execution Environment (TEE / SGX / SEV-SNP) for memory isolation

Use Intel SGX or AMD SEV-SNP enclaves to protect memory at the hardware level. **Rejected** — research §12.5, citing arXiv:2605.03213: "They do not prevent the semantic effects of prompt injection: TEE-backed memory isolation can keep prompts, retrieved context, and runtime separate but not prevent semantic attacks." TEEs protect against physical/disk attacks but not prompt injection — and the threat model is prompt injection, not physical theft. Overkill for Phase 1; SQLCipher + per-tenant keys covers the disk-theft threat at a fraction of the complexity.

### Option F: Existing SQLite substrate + 3 additive Prisma models + 2 virtual tables + SQLCipher (AES-256-CBC, per-tenant HKDF-derived keys, master key in OS keychain) + SHA-256 contentHash + Phase 2+ field-level encryption and per-tenant files reserved

Extend the existing offline-first SQLite database with 3 new Prisma models (`MemoryRecord`, `MemoryEvent`, `MemoryAccessLog`) + 2 enums + 2 raw SQL virtual-table migrations. `tenantId` NOT NULL on every model. `vec0_memrecord` partition-keyed on tenant_id. `memrecord_fts` FTS5 with porter unicode61 tokenizer. SQLCipher as drop-in SQLite fork (Apache-2.0-compatible, AES-256-CBC) — opt-in Phase 1 (default on for production), mandatory Phase 2+ for PII tenants. Per-tenant keys derived from master key (OS keychain) via HKDF. SHA-256 `contentHash` on every `MemoryRecord` for tampering detection. Phase 2+ field-level encryption for sensitive fields; Phase 2+ per-tenant SQLite files for high-security tenants. Per research §12, §13.

## 4. Decision

Adopt **Option F**. The Memory Storage & Encryption architectural contract is:

1. **3 new additive Prisma models** (research §13) — no existing model modified:

   - **`MemoryRecord`** — the unified envelope for working/conversational/semantic/user/agent memories (NOT episodic events). Fields: `id` (CUID), `tenantId` (NOT NULL), `propertyId?`, `userId?`, `agentId?`, `sessionId?`, `teamId?` (Phase 2+), `type` (MemoryType enum), `scope` (MemoryScope enum), `category?` (per-type categories: ROOM_PREFERENCE/DIETARY/LEARNED_PATTERN/etc.), `department?` (department ACL), `content` (Text), `contentHash` (SHA-256), `embedding?` (Bytes, stored separately in vec0), `confidence` (Float, default 0.5), `importance` (Float, default 0.5), `writtenAt`, `lastConfirmedAt`, `expiresAt?`, `retentionPolicy?` ('TAX_7Y'), `halfLifeDays` (Int, default 180), `timesRetrieved`, `timesRetrievedAndConfirmed`, `sensitivity` (default LOW), `supersedes?`, `supersededBy?`, `provenance` (JSON), `metadata` (JSON), `deletedAt?`. 9 composite indexes: `(tenantId, type, scope)`, `(tenantId, userId, type)`, `(tenantId, agentId, type)`, `(tenantId, sessionId, type)`, `(tenantId, department)`, `(tenantId, lastConfirmedAt)`, `(tenantId, expiresAt)`, `(tenantId, deletedAt)`, `(supersedes)`.

   - **`MemoryEvent`** — the append-only raw episodic log. Fields: `id`, `tenantId` (NOT NULL), `propertyId?`, `agentId?`, `userId?`, `sessionId?`, `eventType` (String: USER_MESSAGE/ASSISTANT_MESSAGE/TOOL_CALL/TOOL_RESULT/DECISION/OBSERVATION/SYSTEM_EVENT/ERROR/HUMAN_APPROVAL/ESCALATION/RESERVATION_CREATED/GUEST_CHECKED_IN/...), `eventTimestamp` (default now()), `payload` (JSON), `provenance` (JSON), `retentionExpiresAt?`, `retentionPolicy?`, `deletedAt?`. 7 composite indexes: `(tenantId, eventTimestamp)`, `(tenantId, agentId, eventTimestamp)`, `(tenantId, userId, eventTimestamp)`, `(tenantId, sessionId, eventTimestamp)`, `(tenantId, eventType, eventTimestamp)`, `(tenantId, retentionExpiresAt)`, `(tenantId, deletedAt)`.

   - **`MemoryAccessLog`** — the audit log of every memory operation. Fields: `id`, `tenantId` (NOT NULL), `operation` (CREATE/READ/UPDATE/DELETE/EXPORT/PROMOTE), `operatorType` (USER/AGENT/SYSTEM), `operatorId?`, `targetRecordId?`, `targetEventId?`, `targetUserId?`, `operationTimestamp` (default now()), `operationDetail` (JSON), `ipAddress?`, `userAgent?`, `retentionExpiresAt?` (7-year audit retention). 5 composite indexes: `(tenantId, operationTimestamp)`, `(tenantId, operatorType, operatorId, operationTimestamp)`, `(tenantId, targetUserId, operationTimestamp)`, `(tenantId, targetRecordId)`, `(retentionExpiresAt)`.

2. **2 enums** — `MemoryType` (WORKING/CONVERSATIONAL/EPISODIC/SEMANTIC/USER/AGENT) and `MemoryScope` (SESSION/USER_PRIVATE/AGENT_PRIVATE/TEAM_SHARED/PROPERTY_SHARED/TENANT_SHARED).

3. **2 raw SQL virtual-table migrations**:

   - **`vec0_memrecord`** (sqlite-vec, per Stream 2 ADR-023/027 pattern):
     ```sql
     CREATE VIRTUAL TABLE IF NOT EXISTS vec0_memrecord USING vec0(
       embedding FLOAT[768],  -- nomic-embed-text-v1.5 dimension (Stream 2)
       tenant_id TEXT PATH 'tenant_id',  -- partition key for pre-filtering
       record_id TEXT PATH 'record_id'
     );
     ```
   - **`memrecord_fts`** (FTS5, per Stream 3 pattern):
     ```sql
     CREATE VIRTUAL TABLE IF NOT EXISTS memrecord_fts USING fts5(
       content,
       tenant_id UNINDEXED,
       record_id UNINDEXED,
       tokenize = 'porter unicode61'
     );
     ```

4. **SQLCipher encryption at rest** (research §12.2):
   - **Algorithm**: AES-256-CBC (SQLCipher default; Apache-2.0-compatible).
   - **Binding swap**: `better-sqlite3` → `better-sqlite3-sqlcipher` (or `@vscode/sqlite3` with SQLCipher build). Prisma client sees plaintext; the database file is encrypted at rest.
   - **Phase 1**: opt-in (default off for dev; default on for production).
   - **Phase 2+**: mandatory for any tenant with PII in memory (which is all tenants).
   - **Performance**: 5–15% overhead per Zetetic benchmarks; acceptable for hotel-scale; benchmark in Phase E (research R-12.4).

5. **Per-tenant key derivation** (research §12.2):
   - Master key stored in OS keychain (Windows Credential Manager via `keytar` npm package or equivalent; macOS Keychain; Linux secret service).
   - Per-tenant key derived from master key + tenantId via HKDF (HMAC-based Key Derivation Function).
   - No separate per-tenant key storage — keys are derived on demand from the master.
   - A stolen database file is useless without the tenant key, which requires the master key, which requires OS keychain access (which requires OS user authentication).
   - **Key recovery**: master key backed up in OS keychain with documented recovery flow; per-tenant keys derived (no separate per-tenant key storage to lose); documented key-rotation procedure; backup of encrypted database file + master key together (research R-12.2).

6. **SHA-256 `contentHash` for cryptographic integrity** (research §12.2 Layer 4):
   - Every `MemoryRecord` carries `contentHash = SHA-256(content + provenance + timestamps)`.
   - On every write, recompute and store.
   - On retrieval, recompute and verify; mismatch indicates tampering → quarantine + alert (NOT auto-delete).
   - Nightly Restate workflow recomputes hashes for all records; mismatches flagged in `MemoryAccessLog` and admin UI.
   - This is the OWASP "cryptographic integrity checks for long-term memory" control.

7. **Phase 2+ reserved — field-level encryption** (research §12.2):
   - For extra-sensitive memory fields (dietary allergies, accessibility needs), encrypt the `content` field with a separate key derived from `tenantId + userId`.
   - Protects against a compromised admin reading all user memories (admin has tenant key but not per-user key).
   - Requires key management discipline per user (or per user-session) — Phase 2+ complexity.

8. **Phase 2+ reserved — per-tenant SQLite files** (research §12.2, §9.5):
   - Stream 2's collection-per-tenant pattern: one encrypted SQLite file per tenant, each with its own master-key-derived key.
   - Strongest isolation: a compromised tenant's database file is useless for attacking other tenants.
   - Operational cost: backup/migration/schema-evolution per file.
   - Phase 2+ opt-in for high-security tenants (chains, luxury brands).

9. **Transactional with PMS operations** — Memory lives in the same SQLite file as PMS data (and Stream 3 knowledge base). SQLite WAL (Write-Ahead Logging) crash-safety means a power failure mid-session does not lose working memory. Memory operations can be in the same Prisma transaction as PMS operations (e.g., "create reservation + write episodic RESERVATION_CREATED event" in one transaction).

10. **Partition isolation from knowledge retrieval** — `vec0_memrecord` is a separate virtual table from Stream 3's `vec0_knowledge_chunk`, both partition-keyed on tenant_id. Memory retrieval and knowledge retrieval use the same sqlite-vec extension but distinct virtual tables — ontological separation (memory vs knowledge) is preserved at the storage layer (research §1.1).

## 5. Rationale

- **SQLCipher is the offline-first encryption solution** — research §12.2, §12.3: "SQLCipher is a drop-in SQLite fork — the existing Prisma+SQLite stack adopts it by swapping the SQLite binding. No new database process, no Python runtime, no cloud KMS dependency. It fits SmartAgentics' stack perfectly. The only cost is the key management discipline (master key in OS keychain, per-tenant key derivation)." AES-256-CBC is the SQLCipher default and is widely vetted.
- **Per-tenant key derivation via HKDF is the right key-management pattern** — research §12.2: master key in OS keychain (single secret to protect); per-tenant keys derived on demand (no separate per-tenant key storage to lose or compromise); a stolen database file is useless without the master key, which requires OS user authentication. This is the standard pattern for multi-tenant encryption at rest.
- **Transparent encryption beats application-level encryption** — research §12.5: SQLCipher's transparent encryption means Prisma/FTS5/sqlite-vec see plaintext; the database file is encrypted at rest. Application-level encryption would break FTS5 keyword search and sqlite-vec similarity search (both need plaintext to compute indexes).
- **`contentHash` SHA-256 is the OWASP integrity control** — research §12.1, §12.2 Layer 4: "OWASP AI Agent Security Cheat Sheet lays out five specific controls: sanitize data before storage, isolate memory between users and sessions, set expiration and size limits, audit for sensitive data before persistence, and use cryptographic integrity checks for long-term memory." The `contentHash` on every `MemoryRecord` is the integrity check; tampering is detected on retrieval and by the nightly integrity sweep.
- **sqlite-vec's OLTP-optimized writes pay off for memory** — research §11.1, §13: Alex Garcia's blog confirms sqlite-vec's UPDATE/INSERT/DELETE is fast (chunked internal storage); the deprecated sqlite-vss required a full index re-write for all writes. This makes cascading GDPR deletes (ADR-043) and nightly integrity-check recomputations feasible at hotel scale.
- **`tenantId` NOT NULL + composite indexes is the Microsoft SFI substrate** — research §9.1, §13: "Isolate memory by user, agent, and tenant using deterministic controls." The composite indexes on `(tenantId, *)` make the four-dimensional scope queries (ADR-041) fast and make the retention sweep (ADR-042) fast. The Prisma middleware (ADR-041) is the enforcement layer; this schema is the substrate.
- **3 additive models + 2 virtual tables = minimal schema change** — research §13, FC-4.4: no existing model modified; the 3 new models + 2 enums + 2 raw SQL migrations are all additive. This resolves FC-4.4 with zero risk to existing PMS tables.
- **Phase 1 opt-in / Phase 2+ mandatory encryption is the pragmatic path** — research §12.2: Phase 1 ships with encryption optional (default off for dev to simplify testing; default on for production); Phase 2+ makes it mandatory for PII tenants. This avoids blocking Phase 1 on key-management infrastructure while ensuring production deployments are encrypted from day one.
- **Rejecting no-encryption (Option A)** — research §12.5: stolen laptop/backup exposes all tenant memory; SQLCipher is cheap insurance.
- **Rejecting application-level encryption (Option B)** — research §12.5: breaks FTS5/sqlite-vec indexing; slower; harder to query; key management in application code.
- **Rejecting database-per-tenant as default (Option C)** — research §9.5, §12.2: operationally heavy; reserved for Phase 2+ high-security tenants.
- **Rejecting Postgres from Phase 1 (Option D)** — research §9.5, ADR-001: server process; breaks offline-first; reserved for Phase 2+ cloud parity.
- **Rejecting TEE/SGX (Option E)** — research §12.5, arXiv:2605.03213: doesn't prevent semantic prompt injection; overkill for the disk-theft threat model.

## 6. Consequences

**Positive**:

- Memory storage extends the existing offline-first SQLite substrate with 3 additive Prisma models + 2 virtual tables — no existing model modified, no new database process, no breaking change.
- SQLCipher AES-256-CBC encryption at rest with per-tenant HKDF-derived keys protects against stolen laptop/backup — the OWASP and Microsoft SFI control.
- SHA-256 `contentHash` on every `MemoryRecord` provides cryptographic integrity — tampering is detected on retrieval and by nightly sweep.
- `tenantId` NOT NULL + composite indexes make four-dimensional scope queries and retention sweeps fast.
- `vec0_memrecord` partition-keyed on tenant_id isolates memory retrieval from knowledge retrieval and prevents cross-tenant leakage at the storage layer.
- sqlite-vec's OLTP-optimized writes make cascading GDPR deletes and integrity-check recomputations feasible at hotel scale.
- Memory operations are transactional with PMS operations (SQLite WAL) — power failure mid-session does not lose working memory.
- Phase 2+ escalation paths reserved: field-level encryption for sensitive fields; per-tenant SQLite files for high-security tenants; PostgresMemoryStore for cloud parity.

**Negative / obligations**:

- SQLCipher binding swap (`better-sqlite3` → `better-sqlite3-sqlcipher`) must be tested across Windows/macOS/Linux — Phase E benchmark of 5–15% overhead (research R-12.4).
- Master-key management in OS keychain requires `keytar` (or equivalent) dependency and a documented recovery flow — key loss = tenant data loss (research R-12.2). Backup of encrypted database file + master key together is mandatory.
- The nightly integrity-check Restate workflow recomputes SHA-256 for all `MemoryRecord` rows — at hotel scale (1M records per tenant) this is a non-trivial nightly job; Phase E benchmark required.
- The 9 composite indexes on `MemoryRecord` and 7 on `MemoryEvent` add write overhead — acceptable for hotel-scale event volumes (research R-4.1: 18M events/180d) but must be benchmarked.
- The `contentHash` recomputation on every write is a small overhead; the mismatch-quarantine path must be reviewed by admin (not auto-deleted) to avoid false-positive data loss (research R-12.3).
- Phase 2+ field-level encryption and per-tenant SQLite files add significant complexity — the contracts are reserved but the implementation is deferred.
- The `embedding` field is stored as Bytes in `MemoryRecord` for schema completeness but the actual vector lives in `vec0_memrecord` — developers must understand the dual-write pattern (write the row, then upsert the vector); a Prisma extension or `MemoryStore` method encapsulates this.
- The `memrecord_fts` FTS5 table must be kept in sync with `MemoryRecord` content updates (insert/update/delete triggers or application-level dual-write) — FTS5 external-content tables are an option but add complexity.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — offline-first principle; local-inference-only (no fine-tuning — the compliance advantage).
- Depends on ADR-005 (Prisma) — schema modeling; middleware pattern.
- Depends on ADR-006 (SQLite) — single-file substrate; WAL crash-safety.
- Depends on ADR-013 (Observability Strategy) — nightly integrity-check workflow traced; SQLCipher key-access events audited.
- Depends on ADR-022 (Local Embeddings) — `nomic-embed-text-v1.5` 768-dim for `vec0_memrecord`.
- Depends on ADR-023 (Vector Store) — sqlite-vec for `vec0_memrecord`; OLTP-optimized writes.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenant_id` partition key pattern.
- Depends on ADR-028 (Knowledge Base Architecture) — sibling schema pattern; `vec0_memrecord` separate from `vec0_knowledge_chunk`.
- Depends on ADR-038 (AI Memory Architecture) — the 3-model + 2-virtual-table schema is the substrate for the 7 sub-interfaces.
- Depends on ADR-039 (Memory Taxonomy) — the `type`/`scope`/`category` enums encode the 7-category contract.
- Feeds ADR-041 (Permissions & Isolation) — the `tenantId`/`scope`/`department` columns are the substrate the Prisma middleware enforces against.
- Feeds ADR-042 (Retention & Decay) — the `expiresAt`/`retentionExpiresAt`/`retentionPolicy`/`halfLifeDays`/`lastConfirmedAt`/`timesRetrievedAndConfirmed`/`importance` fields are the substrate for the TTL ladder and decay scoring.
- Feeds ADR-043 (Deletion & GDPR) — the `deletedAt` soft-delete column and `contentHash` integrity check support cascading delete.
- Feeds ADR-044 (Security & Poisoning) — the `contentHash` is Layer 4 of the 6-layer defense; SQLCipher is the encryption layer.
- Feeds ADR-046 (Operations API) — the schema fields are the SDK surface.
- Feeds ADR-047 (Provenance & Audit) — the `MemoryAccessLog` table is the audit substrate; the `provenance` JSON is the per-entry provenance.
- Feeds Stream 8 (Security & Governance) — SQLCipher key-access events and integrity-check results are Stream 8 audit surfaces.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **SQLCipher performance overhead exceeds 15% in Phase E benchmarks** — evaluate alternative bindings (`@vscode/sqlite3` SQLCipher build, `@electric-sql/pglite` for in-process Postgres with pgcrypto); consider making encryption opt-in for performance-sensitive tenants.
2. **A master-key loss incident occurs** (tenant key unrecoverable) — root-cause the key-management failure; verify the OS keychain backup/recovery flow; consider key-escrow with legal review; document the data-loss outcome.
3. **A `contentHash` mismatch is detected in production** (tampering or bug) — root-cause; verify the nightly integrity-check workflow flagged it; verify the quarantine + admin-review path (not auto-delete); verify the `MemoryAccessLog` reconstruction.
4. **sqlite-vec DELETE performance degrades at very large scale** (research R-11.3) — verify the cascading-delete benchmarks at 1M+ vectors per tenant; consider batched deletion for very large bulk operations.
5. **A Phase 2+ high-security tenant demands per-tenant SQLite files** — verify the collection-per-tenant pattern (Stream 2 ADR-027 escalation) works for memory; verify the per-tenant master-key derivation; verify the operational tooling (backup/migration/schema-evolution per file).
6. **A field-level-encryption demand emerges** (e.g., a tenant requires per-user-key encryption for accessibility/dietary data) — evaluate the Phase 2+ field-level encryption contract; verify the per-user key derivation and key-management discipline.
7. **A FTS5 sync failure occurs** (FTS5 index out of sync with `MemoryRecord` content) — root-cause the dual-write bug; consider FTS5 external-content tables with triggers; verify the rebuild path.
8. **Postgres cloud parity becomes a Phase 2+ priority** — evaluate `PostgresMemoryStore` (pgvector + Postgres RLS + pgcrypto); verify the schema migration path; verify the offline-first contract is preserved for non-cloud tenants.
9. **SQLCipher publishes a breaking change or security advisory** — evaluate the upgrade; verify the binding swap is forward-compatible; verify the key-rotation procedure.
10. **Annually**, as part of the regular ADR review cycle.
