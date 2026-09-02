# ADR-019: Model Lifecycle (updates + rollback)

**ADR-ID:** ADR-019
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §2) lists "model loading, model unloading, model selection, model fallback, model health, model lifecycle, model update mechanism, model rollback" as required sub-capabilities of "Local AI Model Management — NOW". File 2 §B4 items #28 (offline model packaging) and #29 (offline model updates) make model distribution and updates first-class concerns. Phase B B4 item #2 confirmed none of these capabilities exist in the current SDK.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Sections 18, 19, 20) established that the lifecycle is implementable on top of Ollama's existing primitives (content-addressable blob store, `ollama pull`/`ollama stop`/`ollama rm`, `ollama ps`) — SmartAgentics adds the metadata, validation, audit, and policy layer that Ollama lacks. The state machine synthesizes findings from Sections 3 (Ollama), 16 (Packaging), 17 (Versioning), 19 (Updates), and 20 (Rollback).

## 2. Problem

The architectural problem: **define a `ModelLifecycle` state machine and transition rules that (a) cover the full discover → install → validate → register → activate → use → monitor → deactivate → update/replace → rollback flow, (b) map cleanly to Ollama (or equivalent runtime) operations while preserving runtime swappability per ADR-015, (c) enforce SHA256 integrity at validation, (d) support instant rollback via content-addressed blob retention, and (e) provide an audit trail Ollama alone does not.**

## 3. Options

### Option A: Let Ollama manage the lifecycle alone (no SmartAgentics layer)

Use `ollama pull` / `ollama run` / `ollama stop` / `ollama rm` directly. Rejected — Ollama lacks audit trail, validation, tenant-aware registry, version pinning, and lifecycle policy (research Section 18, "Rejected alternatives"). `:latest` tag movement makes rollback non-reproducible.

### Option B: Manual lifecycle (no state machine)

Document procedures; let admins run `ollama` commands manually. Rejected — unmanageable at scale; no enforcement of validation, integrity, or retention policy; no audit (research Section 18).

### Option C: SmartAgentics-defined `ModelLifecycle` state machine over Ollama primitives, with SHA256 validation, audit trail, retention policy, and instant rollback via blob retention

Define a state machine in the SmartAgentics SDK. SmartAgentics wraps Ollama operations (or equivalent llama-server / LocalAI operations) with metadata, validation, audit, and policy. State transitions are persisted in the Model Registry (ADR-021, backed by SQLite per ADR-006). Per research Sections 18, 19, 20.

## 4. Decision

Adopt **Option C**. The Model Lifecycle architectural contract is:

1. **State machine**:

   ```
   DISCOVERED → DOWNLOADED → VALIDATED → REGISTERED → ACTIVATED → IN_USE → DEACTIVATED → (UPDATED | ROLLED_BACK | REMOVED)
                                                       ↑                                        │
                                                       └────────────────────────────────────────┘
                                                               (re-activate)
   ```

   State definitions:
   - **DISCOVERED** — SmartAgentics catalog mentions the model; not yet downloaded.
   - **DOWNLOADED** — GGUF file present on disk; not yet verified.
   - **VALIDATED** — SHA256 verified (matches `manifest.json.sha256` per ADR-017); GGUF metadata readable; manifest matches.
   - **REGISTERED** — ModelRegistry entry created (per ADR-021); model available for activation.
   - **ACTIVATED** — Model loaded (or loadable on demand) by the local runtime.
   - **IN_USE** — Model is currently serving requests.
   - **DEACTIVATED** — Model unloaded from runtime; remains on disk and in registry.
   - **UPDATED** — New version downloaded and validated; old version retained for rollback.
   - **ROLLED_BACK** — Previous version re-activated; failed version retained for diagnosis.
   - **REMOVED** — Model files deleted from disk; registry entry marked as removed (metadata retained for audit).

2. **Implementation mapping to Ollama** (reference runtime per ADR-015):
   - DISCOVERED — SmartAgentics catalog lookup.
   - DOWNLOADED — `ollama pull <model>:<tag>` OR direct GGUF download + `ollama create` (the latter for USB/LAN bundle install).
   - VALIDATED — SmartAgentics SHA256 check on the GGUF file (independent of Ollama, using Node.js `crypto`).
   - REGISTERED — SmartAgentics ModelRegistry SQLite insert (per ADR-021).
   - ACTIVATED — First request triggers Ollama lazy-load; OR pre-warm via `ollama run` at SmartAgentics startup (per ADR-015 §8 advisory).
   - IN_USE — `ollama ps` shows the model as loaded.
   - DEACTIVATED — `ollama stop <model>`.
   - UPDATED — `ollama pull <model>:<newer-tag>`; old blob retained by Ollama until `ollama rm` (per Section 19).
   - ROLLED_BACK — Re-activate old tag (must still be present in Ollama's blob store, per Section 20).
   - REMOVED — `ollama rm <model>:<tag>`; SmartAgentics registry update.

3. **Update mechanisms**:
   - **Online updates** (when internet available): SmartAgentics downloads from the **SmartAgentics-controlled mirror** (per ADR-017 §11) — NOT directly from Ollama registry or Hugging Face. Reason: version control, integrity, licensing compliance.
   - **Offline updates** (USB/LAN): Model Bundle (`.zip` with GGUF + manifest.json + license.txt per ADR-017) transferred via USB or LAN file share. SmartAgentics installer validates SHA256 before activation.
   - **Delta updates**: **NOT in Phase 1.** Defer to Phase 2+ when model size growth justifies the complexity. GGUF's content-addressed blob structure (in Ollama) provides partial reuse — if two model versions share layers (e.g., same base model, different LoRA adapter), only the changed layers are downloaded (research Section 19).

4. **Integrity verification — MANDATORY on every install/update**:
   - SHA256 verification on every install/update (per ADR-017 §10).
   - **Reject on mismatch.** Log to audit trail. Fallback to previous version.
   - Audit trail records: timestamp, operator (admin / system / automated), from-state, to-state, sha256, manifest snapshot.

5. **Version retention policy**:
   - SmartAgentics ModelRegistry retains the last **N=3 versions** of each model (configurable per deployment).
   - Older versions are garbage-collected only after **successful activation of the new version + 7-day grace period** (research Section 20).
   - Retention is enforced via a periodic reconciliation job.

6. **Rollback procedure**:
   1. SmartAgentics admin triggers rollback via UI.
   2. SmartAgentics deactivates current model version (state → DEACTIVATED).
   3. SmartAgentics activates previous version from local blob store (instant if blob still present, per Section 20 — Ollama retains blobs).
   4. SmartAgentics logs rollback to audit trail.
   5. SmartAgentics reports the failed version to the SmartAgentics mirror (for fleet-wide issue detection).
   - **Instant rollback** is feasible because Ollama retains content-addressed blobs (research Section 20).
   - **Corrupted model recovery**: if GGUF file is corrupted (SHA256 mismatch on load), SmartAgentics automatically falls back to previous version + triggers re-download of the corrupted version.

7. **Reconciliation job** (runs at SmartAgentics startup):
   - Compares ModelRegistry state to Ollama's actual loaded/available models.
   - Detects state drift (e.g., user manually ran `ollama rm` outside SmartAgentics).
   - Reconciles registry → marks orphaned entries as REMOVED; re-imports orphaned Ollama models as REGISTERED.
   - Per research Section 18 risk: "State drift: Ollama and SmartAgentics registry can drift (e.g., user manually `ollama rm`s a model). Mitigation: reconciliation job on startup."

8. **Disk bloat mitigation** — Retaining 3 versions of a 4 GB model = 12 GB per model (research Section 20 risks). Mitigations: configurable retention policy; monitor disk usage via ADR-016 `HardwareProfile.disk`; surface low-disk warnings in the admin UI.

9. **Cold-start mitigation** — First model load can take 5–30 s depending on model size and disk speed (research Section 15 risks). Mitigations: pre-warm primary LLM at SmartAgentics startup; show "AI warming up" indicator in UI.

## 5. Rationale

- **Ollama blob retention enables instant rollback** — content-addressable storage means blobs are not deleted when tags move; they persist until garbage collected (research Section 20). SmartAgentics adds the policy, audit, and automation layer that Ollama lacks.
- **SmartAgentics-controlled mirror** for online updates — direct HF/Ollama download rejected for production (no version control, no integrity guarantee, licensing complexity; research Section 19, "Rejected alternatives"). PoC may use direct HF/Ollama download; production requires the mirror.
- **Delta updates deferred** — premature optimization given typical model update frequency (monthly to quarterly for hotel-relevant models); Ollama's content-addressed blob reuse already provides partial benefit (research Section 19).
- **Reconciliation job** — handles state drift between SmartAgentics registry and Ollama's blob store (research Section 18 risk).
- **SHA256 mandatory at validation** — runtime-agnostic integrity check independent of Ollama's own blob-level SHA256 (per ADR-017 §10).
- **7-day grace period before garbage collection** — gives operators time to detect a bad update and trigger rollback before the old version is purged.
- **Rejecting manual lifecycle** — unmanageable at scale; no enforcement (research Section 18).
- **Rejecting Ollama-alone lifecycle** — lacks audit trail, validation, tenant-aware registry, version pinning, lifecycle policy (research Section 18).
- **Rejecting BitTorrent/P2P distribution** — operational complexity, firewall issues at hotels (research Section 19).
- **Rejecting mandatory delta updates** — premature optimization (research Section 19).

## 6. Consequences

**Positive**:

- Full audit trail for every model state transition — required for compliance and incident response.
- Instant rollback via blob retention — operational risk of a bad update is bounded.
- Reconciliation handles drift gracefully — registry stays authoritative even when admins bypass SmartAgentics.
- Foundation for the AI-BOS "model lifecycle, model update mechanism, model rollback" capabilities (directive §2).
- Implements directive §B4 items #28 (offline model packaging) and #29 (offline model updates).

**Negative / obligations**:

- New `ModelLifecycle` interface and state machine in the SDK.
- Phase 1 implements DISCOVERED → DOWNLOADED → VALIDATED → REGISTERED → ACTIVATED → IN_USE → DEACTIVATED. UPDATED and ROLLED_BACK are deferred to Phase 2 (research Section 18, "Impact on Phase 1"). Phase 1 should still _define_ the rollback policy.
- Disk bloat — 3× model size per model; needs disk monitoring (research Section 20 risks).
- Ollama may garbage-collect blobs unexpectedly (research Section 20 risks). Mitigation: SmartAgentics SHOULD `ollama pull` old tags on a schedule to keep them warm; OR copy blobs out of Ollama's store.
- Hotel internet bandwidth (1–10 Mbps) makes a 4 GB model download take 1–9 hours (research Section 19 risks). Mitigation: schedule updates during off-peak; offer USB bundle as primary distribution.
- SmartAgentics must operate a highly-available model mirror (CDN; multiple mirrors; research Section 19 risks).
- Reconciliation job adds startup latency — must be fast (SQLite scan, not full disk scan).

**Dependencies on other ADRs**:

- Depends on ADR-021 (Model Registry) — the registry persists state and audit trail.
- Depends on ADR-017 (Model Packaging) — the bundle is the unit of DISCOVERED → DOWNLOADED → VALIDATED.
- Depends on ADR-018 (Model Versioning) — version pinning by SHA256 enables reproducible rollback.
- Depends on ADR-015 (Local AI Runtime) — the runtime's `load`/`unload` methods are called by ACTIVATED/DEACTIVATED transitions.
- Depends on ADR-006 (SQLite) for registry and audit trail persistence.
- Compatible with ADR-013 (Observability Strategy) — lifecycle transitions are traced.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Delta updates become justified** by model size growth (e.g., 30B+ models in regular rotation) — re-evaluate the "defer to Phase 2+" position.
2. **A rollback fails** because Ollama garbage-collected a blob that SmartAgentics expected to retain — re-evaluate the blob-warming / blob-copy mitigation; consider copying blobs out of Ollama's store.
3. **Fleet-wide rollback automation** is designed (Phase 2+) — re-evaluate the rollback procedure's interaction with the SmartAgentics mirror's fleet-wide issue detection.
4. **LocalAI replaces Ollama** as the reference runtime (per ADR-015 review condition #1) — re-evaluate the implementation mapping (LocalAI's backend API differs from Ollama's).
5. **Disk bloat becomes operationally painful** — re-evaluate the retention policy (N=3 versions, 7-day grace period).
6. **A model file corruption incident** reveals gaps in the auto-fallback procedure — re-evaluate the corrupted-model recovery flow.
7. **Annually**, as part of the regular ADR review cycle.
