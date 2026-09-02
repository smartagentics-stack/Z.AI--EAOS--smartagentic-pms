# ADR-018: Model Versioning

**ADR-ID:** ADR-018
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §2) lists "model versions", "model capabilities", and "model compatibility" as required sub-capabilities of "Local AI Model Management — NOW". Phase B B4 item #2 confirmed that the SmartAgentics SDK currently has no `ModelRegistry` interface and no `ModelVersion` concept; the cloud-only `AIProvider` has no versioning because the cloud provider handles model selection transparently.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Section 17) established that **no industry-standard "semantic versioning for models" exists**. The closest foundations are (a) the GGUF naming convention and metadata fields (`general.version`, `general.architecture`, `general.basename`, `general.size_label`, `general.finetune`), (b) Ollama tags (`model:tag` format, where tags can move and `:latest` re-points), and (c) Hugging Face model cards (YAML metadata with `license`, `pipeline_tag`, `tags`, `base_model`, `library_name`). SmartAgentics must therefore define its own versioning schema on top of these primitives.

## 2. Problem

The architectural problem: **define a Model Versioning Schema that (a) is independent of upstream tag movement (Ollama `:latest` re-points; HF commits shift), (b) declares capabilities in a vocabulary SmartAgentics can match against tasks, (c) tracks runtime compatibility to prevent loading a model that the installed llama.cpp/Ollama cannot run, and (d) enables reproducible rollback** — without inventing a new industry standard.

## 3. Options

### Option A: Use Ollama tags as the source of truth

`ollama pull qwen2.5:7b-instruct-q4_K_M`; rely on the tag as the version. Rejected — tags move; `:latest` re-points to the newest blob (research Section 17, "Rejected alternatives"). Not reproducible; rollback is impossible once an old tag is re-pulled to a newer blob.

### Option B: Use Hugging Face commit SHAs as the source of truth

Pin to a specific HF revision. Rejected — Hugging Face is a _distribution source_, not SmartAgentics' registry (research Section 17). HF availability is not guaranteed; HF does not enforce SmartAgentics' compatibility and capability vocabularies; coupling to HF git internals is inappropriate for a hotel-side registry.

### Option C: SmartAgentics-defined Model Versioning Schema in the Model Bundle manifest, with semantic versioning + upstream version + capability vocabulary + runtime compatibility tracking; pinning via SHA256

SmartAgentics defines its own schema in the `manifest.json` of the Model Bundle (per ADR-017): `version` (SmartAgentics-controlled semantic version), `upstreamVersion` (the upstream model's version), `capabilities` (vocabulary array), `compatibility` (runtime version range). The Model Registry (ADR-021) pins specific SHA256 digests — not floating tags. Per research Section 17.

## 4. Decision

Adopt **Option C**. The Model Versioning architectural contract is:

1. **Model Versioning Schema** — defined in the Model Bundle `manifest.json` (per ADR-017), with the following fields:

   - **`version`** — semantic version `MAJOR.MINOR.PATCH`, **SmartAgentics-controlled** (not the upstream model's version).
     - `MAJOR` — incompatible capability change (e.g., model no longer supports `tool-calling`).
     - `MINOR` — added capability or upstream model update (e.g., Qwen2.5 → Qwen2.6).
     - `PATCH` — bug fix (e.g., re-quantization of the same upstream model).
   - **`upstreamVersion`** — the upstream model's version (e.g., `"qwen2.5-v1.0"`). Informational only; not used for selection.
   - **`capabilities`** — array of capability strings from a controlled vocabulary:
     - `text-generation`
     - `tool-calling`
     - `vision`
     - `embeddings`
     - `reranking`
     - (Future vocabularies may be added by ADR amendment.)
   - **`compatibility`** — runtime compatibility block:
     ```json
     {
       "minRuntimeVersion": "ollama/0.3.0",
       "maxRuntimeVersion": "ollama/0.x",
       "runtimeEngine": "llama.cpp",
       "ggufVersion": "v3"
     }
     ```
     - `minRuntimeVersion` / `maxRuntimeVersion` — the SmartAgentics runtime version range that can load this model. Guards against GGUF metadata drift (research Section 17 risks).
     - `runtimeEngine` — the engine family (typically `llama.cpp`, since all ADR-015-permitted runtimes use it).
     - `ggufVersion` — the GGUF spec version this file targets.

2. **Pinning policy — MANDATORY** — The Model Registry (ADR-021) MUST pin specific SHA256 digests, NOT floating tags like `:latest`. This is essential for reproducibility and rollback (per research Section 17 and ADR-019 rollback procedure).

3. **GGUF metadata as a secondary source** — The GGUF file's embedded metadata (`general.version`, `general.architecture`, `general.file_type`) is read at VALIDATED state (per ADR-019) and cross-checked against the manifest. Mismatch → reject activation.

4. **Ollama tags are NOT the source of truth** — Ollama tags are an _operational convenience_ for `ollama pull`, but the SmartAgentics Model Registry tracks models by `(modelId, version, sha256)`, not by Ollama tag. The Ollama tag is informational metadata only.

5. **Hugging Face is NOT the source of truth** — HF is an upstream source for the SmartAgentics-controlled mirror (per ADR-017 §11 and ADR-019), not a registry SmartAgentics depends on at runtime.

6. **Capability test on first activation** — Because a model advertised as `tool-calling` may not actually support it well (research Section 17 risks), SmartAgentics SHOULD run a capability smoke test on first activation (Phase 2+). Phase 1 trusts the manifest's declared capabilities.

7. **`ModelVersion` value object** — SDK type representing the version tuple `(modelId, version, upstreamVersion, sha256, capabilities, compatibility)`.

8. **Compatibility drift mitigation** — If a future llama.cpp version requires a new GGUF metadata field that an installed model lacks, the `compatibility.minRuntimeVersion` field allows the registry to refuse activation and surface a clear upgrade path (per research Section 17 risks).

## 5. Rationale

- **No industry standard exists** (research Section 17, "Inference") — SmartAgentics must define its own. The GGUF naming convention provides a foundation; the Model Bundle manifest extends it with capability declarations and compatibility tracking.
- **Rejecting Ollama tags as source of truth** — tags move; `:latest` re-points; not reproducible (research Section 17).
- **Rejecting HF commit SHAs as source of truth** — HF is a distribution source, not SmartAgentics' registry; HF availability is not guaranteed (research Section 17).
- **Rejecting "no versioning"** — no rollback, no reproducibility; incompatible with ADR-019 lifecycle and ADR-021 registry requirements.
- **SmartAgentics-controlled semantic version** decouples the upgrade cadence from upstream model releases — e.g., a re-quantization (PATCH) does not require a MINOR bump even if the upstream model version is unchanged.
- **Capability vocabulary** — borrowed from Hugging Face `pipeline_tag` (`text-generation`, `feature-extraction`, etc.) and adapted to SmartAgentics' needs; small controlled vocabulary to avoid sprawl.
- **Compatibility tracking** — guards against the GGUF metadata drift risk explicitly called out in research Section 2 risks ("llama.cpp's GGUF format evolves; minor breaking changes to metadata keys have occurred historically").
- **Pinning by SHA256** — same content-addressable principle that Ollama already uses internally for blobs (research Section 16); SmartAgentics applies it at the application layer for vendor swappability.

## 6. Consequences

**Positive**:

- Reproducible deployments — the same `(modelId, version, sha256)` tuple produces the same behavior across all hotels.
- Rollback is well-defined (per ADR-019) — the registry can re-activate any historical version by SHA256.
- Capability-based model selection — `selectModel(task, hardwareProfile)` in ADR-015's `LocalLLMRuntime` can match task → required capability → available models.
- Compatibility drift is caught early — `compatibility.minRuntimeVersion` prevents silent breakage when llama.cpp/Ollama updates.
- Decouples SmartAgentics' versioning from upstream model release cadence.

**Negative / obligations**:

- New `ModelVersion` value object and `ModelRegistry` interface required (research Section 17 impact; per B4 item #2 confirms currently missing).
- Phase 1 must define the ModelRegistry schema (SQLite table per ADR-006) — ~1 day per Phase E recommendation #2.
- Capability mismatch risk — a model advertised as `tool-calling` may not actually support it well (research Section 17 risks). Mitigation: capability smoke test on first activation (Phase 2+).
- Compatibility drift risk — a future GGUF metadata field may be required by a future llama.cpp version. Mitigation: `compatibility.minRuntimeVersion` field; reject activation with clear upgrade path.
- The versioning vocabulary is small (5 capabilities) — may need extension as AI-BOS expands. Mitigation: ADR amendment process.

**Dependencies on other ADRs**:

- Depends on ADR-017 (Model Packaging) — the versioning schema lives in the manifest.
- Depends on ADR-021 (Model Registry) — the registry stores and pins versions.
- Depends on ADR-019 (Model Lifecycle) — version transitions drive the UPDATED and ROLLED_BACK states.
- Depends on ADR-020 (Model Licensing) — license metadata is per-version (per research Section 21 risks: "A model upstream may change license between versions. Mitigation: per-version license metadata; reject downgrade to non-commercial.").
- Depends on ADR-015 (Local AI Runtime) — `selectModel(task, hardwareProfile)` uses the capability vocabulary.
- Depends on ADR-006 (SQLite) for registry persistence.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **GGUF spec introduces new metadata fields** that should be tracked in the compatibility block (e.g., a new `general.supported_features` field).
2. **A new capability** (e.g., `audio-transcription`, `image-generation`) becomes relevant — extend the controlled vocabulary by ADR amendment.
3. **An industry-standard model versioning scheme** emerges (e.g., a Model Card 2.0 spec with version semantics) — consider adopting it instead of SmartAgentics' own.
4. **Compatibility drift causes a fleet-wide activation failure** — re-evaluate the compatibility block design and the smoke-test-on-activation policy.
5. **Fine-tuning is added** (currently excluded per directive Flag 7) — re-evaluate version semantics for derivative models (e.g., `upstreamVersion` + fine-tune suffix).
6. **The capability smoke test (Phase 2+)** reveals systematic capability misdeclaration by upstream models — re-evaluate the trust model.
7. **Annually**, as part of the regular ADR review cycle.
