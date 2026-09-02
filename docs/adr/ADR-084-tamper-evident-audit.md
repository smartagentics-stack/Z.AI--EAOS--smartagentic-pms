# ADR-084: Tamper-Evident Audit — RFC 6962 Merkle Tree, WORM AuditMerkleRoot Table

**ADR-ID:** ADR-084
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #24 ("AI audit") is classified as **"Partial"** — Stream 5 created the `AIAuditEvent` table with a basic SHA-256 hash chain (line 594 of `phase-c-stream5-agent-runtime-report.md`): every row carries `prevHash` (SHA-256 of the previous row's `rowHash`) and `rowHash` (SHA-256 of all row fields + `prevHash`). Stream 8 Foundational Conflict **FC-8.3** (Critical) flags this as insufficient for regulator-grade tamper-evidence.

The Stream 8 research (s06) is unambiguous:

- **RFC 6962: Certificate Transparency** (`https://www.rfc-editor.org/info/rfc6962`): the cryptographic gold standard for append-only logs. Defines Merkle Hash Trees, audit paths, and STH (Signed Tree Head) publication. Originally designed for TLS certificate transparency; now the de-facto standard for any tamper-evident log.
- **Veritaschain** (December 2025): "Hash chains link events cryptographically — any modification is detectable; Ed25519 signatures prove who created each event; Merkle trees [enable efficient verification of arbitrary leaves]."
- **arriqaaq Merkle tree immutable verifiable log**: "Tamper-evident logs means you can cryptographically prove that the data hasn't been unexpectedly changed."
- **NousResearch hermes-agent Merkle Hash-Chain Audit Trail** (March 2026): "cryptographically linked, tamper-evident log of every agent action."

Stream 5's basic hash chain has a critical weakness: **an attacker with DB write access can rewrite the entire chain from scratch**, recomputing every `prevHash` and `rowHash` consistently. The chain is tamper-**evident** only if the verifier has an independent copy of the chain head hash; otherwise it is tamper-**resistant** only against naïve single-row edits. RFC 6962 Merkle Trees solve this by **publishing the Merkle root to an independent write-once medium** at periodic intervals. Once a root is published, the entire historical chain becomes independently verifiable.

**EU AI Act Article 12** (s15) requires "High-risk AI systems must maintain continuous, automatically generated logs for a minimum of six months." Stream 6 ADR-062 already established 7-year retention — exceeds the EU AI Act minimum. Phase B B4 #42 explicitly rejected blockchain ("DO NOT ADD Phase 1") — RFC 6962 Merkle Trees provide the same tamper-evidence property without blockchain's overhead.

## 2. Problem

Should SmartAgentics keep Stream 5's basic hash chain, adopt RFC 6962 Merkle Trees with periodic root publication, adopt a blockchain-based audit ledger, or adopt an external SaaS audit service?

## 3. Options

### Option A: Keep Stream 5's basic hash chain (`prevHash + rowHash`)

Rejected. An attacker with DB write access can rewrite the entire chain from scratch consistently. Insufficient for regulator-grade tamper-evidence (FC-8.3).

### Option B: Blockchain-based audit ledger

Explicitly rejected per Phase B B4 #42 ("Blockchain — Explicitly Rejected — DO NOT ADD Phase 1"). RFC 6962 Merkle Trees provide the same tamper-evidence property without blockchain's overhead (consensus, gas fees, public ledger exposure of guest data).

### Option C: External SaaS audit service (AWS CloudTrail Lake, Datadog Audit Trail)

Rejected. Violates offline-first. Hotel servers have no guaranteed internet egress. The `AuditMerkleRoot` table is the local equivalent.

### Option D: Streaming-only audit (no persistent table)

Rejected. Regulators require queryable historical logs (EU AI Act Article 12, s15). A streaming-only log cannot satisfy "deployers must retain automatically generated logs for a minimum of six months."

### Option E: RFC 6962 Merkle Tree + WORM `AuditMerkleRoot` table + 3-tier tamper-evidence

Adopted. Tier 1 = per-row hash chain (Stream 5, retained). Tier 2 = periodic Merkle Tree root published to append-only `AuditMerkleRoot` table. Tier 3 = external publication (Phase 2+, reserved for high-security deployments).

## 4. Decision

Adopt **Option E** — the 3-tier tamper-evidence architecture.

### Tier 1 — Per-row hash chain (Stream 5, retained)

Every `AIAuditEvent` row carries `prevHash` (SHA-256 of the previous row's `rowHash`) and `rowHash` (SHA-256 of all row fields + `prevHash`). Detects single-row tampering.

### Tier 2 — Periodic Merkle Tree root (NEW)

Every N minutes (default 60), the Auditor computes a Merkle Tree over all `AIAuditEvent` rows since the last published root. The root hash is written to a new `AuditMerkleRoot` Prisma table:

```prisma
model AuditMerkleRoot {
  id               String   @id @default(cuid())
  tenantId         String
  rootHash         String   // SHA-256 Merkle root
  leafCount        Int      // number of leaves in this tree
  firstLeafId      String   // first AIAuditEvent.id in this tree
  lastLeafId       String   // last AIAuditEvent.id in this tree
  publishedAt      DateTime @default(now())
  previousRootHash String?  // links roots into a root-chain
  signature        String?  // Ed25519 signature by the deployment's audit key

  @@unique([tenantId, publishedAt])
  @@index([tenantId, publishedAt])
}
```

The `AuditMerkleRoot` table is **append-only**: Prisma middleware + SQLite trigger reject any UPDATE or DELETE on it. Phase 1: Prisma middleware. Phase 2+: SQLite `AFTER UPDATE|DELETE` trigger that raises `ABORT`.

### Tier 3 — External publication (Phase 2+, reserved)

The monthly Merkle root is exported to a write-once medium — either (a) burned to optical archival storage if a regulator demands physical WORM, or (b) hashed into the next month's root (a "root-of-roots" chain) and the final annual root hash is published to a notarized timestamping authority. Phase 1 ships Tier 1 + Tier 2 only.

### Verification

A nightly Restate job (`AuditMerkleVerifierWorkflow`) recomputes the Merkle Tree from `AIAuditEvent` rows and compares against `AuditMerkleRoot`. Any mismatch → critical alert + `AIAuditEvent` `eventType=MERKLE_VERIFICATION_FAILED`.

### `AIAuditEvent` amendments (additive, ADR-046 amendment)

- `merkleLeafIndex` (Int) — position in the tree.
- `merkleRootHash` (String) — the root this leaf belongs to.

### Signature

Each `AuditMerkleRoot.signature` is an Ed25519 signature by the deployment's audit key (generated at install time, stored in Windows Credential Manager). Ed25519 library: `@noble/ed25519` (MIT, browser/Node-compatible).

## 5. Rationale

- **FC-8.3 closure**: RFC 6962 Merkle Trees + WORM `AuditMerkleRoot` table provide regulator-grade tamper-evidence that a basic hash chain cannot.
- **Independent verifiability**: once a root is published to the append-only `AuditMerkleRoot` table, an attacker who rewrites `AIAuditEvent` history must also rewrite `AuditMerkleRoot` — which is blocked by the SQLite trigger / Prisma middleware. The two tables are independently tamper-evident.
- **EU AI Act Article 12 satisfaction** (s15): "continuous, automatically generated logs" + 7-year retention (Stream 6 ADR-062) exceeds the 6-month minimum.
- **Blockchain rejection respected** (Phase B B4 #42): RFC 6962 Merkle Trees provide the same tamper-evidence property without blockchain's overhead or public-ledger exposure of guest data.
- **Offline-first respected**: `AuditMerkleRoot` is a local SQLite table; no external SaaS audit service required.
- **Ed25519 signatures** (Veritaschain, s06) prove authorship of each root — defends against a compromised DB account forging roots.
- **Incremental Merkle Tree** (Phase 2+ optimization): each new root is built atop the previous root's tree, not from scratch — keeps recomputation tractable on a 50M-row table.

## 6. Consequences

- New `AuditMerkleRoot` Prisma table (append-only; SQLite trigger + Prisma middleware enforcement).
- `AIAuditEvent` amendments: `merkleLeafIndex`, `merkleRootHash` (ADR-046 amendment, additive).
- New `AuditMerkleVerifierWorkflow` Restate workflow (nightly verification).
- New `AIAuditEvent` event type: `MERKLE_VERIFICATION_FAILED`.
- New SDK interface `AuditMerkleTree` (builder) and `AuditMerkleVerifier` (nightly verifier) in `packages/sdk/src/ai/`.
- Deployment audit key generated at install time, stored in Windows Credential Manager.
- **Risk: append-only `AuditMerkleRoot` table grows unboundedly.** At 1 root/hour, ~8,760 rows/year/tenant — negligible. At 1 root/min, ~525,600/year — still manageable in SQLite.
- **Risk: Merkle recomputation on a large `AIAuditEvent` table (50M rows, per Stream 5 estimate) takes minutes.** Mitigation: incremental Merkle Tree (each new root built atop the previous root's tree); nightly job runs off-peak.
- **Risk: deployment audit key compromise.** Mitigation: key stored in Windows Credential Manager (not in DB); key rotation procedure documented; Phase 2+ may move to HSM.
- **Risk: Prisma middleware bypass (a direct SQL UPDATE on `AuditMerkleRoot`).** Mitigation: Phase 2+ SQLite trigger raises `ABORT` even on direct SQL; Phase 1 verifier rule VERIFY-AI-SECURITY-04 flags missing trigger.
- Dependencies: Stream 5 `AIAuditEvent` table; Stream 6 multi-agent fields; Stream 7 HLC timestamps; `@noble/ed25519` (MIT).
- Phase 1 effort: ~3 weeks (Merkle Tree implementation ~1 week, `AuditMerkleRoot` table + append-only enforcement ~1 week, nightly verifier workflow ~1 week).

## 7. Review Conditions

- Review if a `MERKLE_VERIFICATION_FAILED` event fires in production — would indicate either a real tampering attempt or (more likely) a bug in the Merkle implementation; both require immediate root-cause analysis.
- Review if Phase 2+ regulator demands physical WORM (optical archival) — would activate Tier 3 external publication.
- Review if a 50M-row `AIAuditEvent` table makes nightly recomputation intractable — would require the incremental Merkle Tree optimization earlier than planned.
- Review if a community Merkle audit standard emerges (e.g., a standardized `AuditMerkleRoot` schema) that should replace the SmartAgentics-owned table.
- Review if the deployment audit key rotation procedure is invoked (e.g., suspected compromise) — would require re-signing all historical roots with the new key.
- Review if Phase 2+ cross-site audit verification (Stream 7 SyncEngine syncs `AuditMerkleRoot` across LAN hub-and-spoke) proves valuable — would extend ADR-084 with cross-site root comparison.
- Review if EU AI Act Article 12 enforcement guidance evolves to demand real-time root publication (vs. hourly) — would shorten the Tier 2 publication interval.
