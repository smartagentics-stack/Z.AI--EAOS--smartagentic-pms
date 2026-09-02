# ADR-015: Local AI Runtime — Architectural Contract

**ADR-ID:** ADR-015
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §3) classifies the **Local AI Runtime** as an "Architecture Contract — NOW" capability: the foundation of SmartAgentics' offline AI story and the prerequisite for Streams 2 (Local Embeddings), 3 (Offline Knowledge / RAG), 5 (Agent Runtime), and 8 (AI Security). ADR-001 currently records "Local AI: Deferred", which was reasonable when the technology readiness of Windows-native, OpenAI-compatible, commercially-licensed local LLM runtimes was uncertain.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Sections 2, 3, 9, 12, 13, 15) established that this technology barrier is no longer present. Production-grade, MIT-licensed, Windows-native runtimes exist today (llama.cpp, Ollama, LocalAI), all expose an OpenAI Chat Completions-compatible HTTP endpoint, and CPU-only inference is viable at 8–15 tok/s on hotel-grade hardware. The work for Phase D is therefore to write the **architectural contract** (interface + ADR) — not to select a single vendor. This ADR reserves the runtime abstraction boundary in the SDK so that Phase E can ship the contract without breaking the existing cloud-only `AIProvider` (per Foundational Conflict #3).

## 2. Problem

The existing SDK exposes a single cloud-shaped `AIProvider` interface (`packages/sdk/src/ai/index.ts` per B4 item #1) that assumes the model is always loaded, always healthy, and chosen by the cloud provider. A local runtime has a richer contract: it must load/unload models, report health and capabilities, and select models based on detected hardware. If Phase 1 ships with only the cloud-shaped `AIProvider`, every downstream consumer (PMS modules, Agent Runtime, RAG, Memory) will program against the wrong abstraction and a Phase 2 retrofit will be a costly rewrite.

The architectural problem: **define an SDK contract for the local AI runtime that (a) preserves vendor swappability at the HTTP boundary, (b) extends rather than breaks the existing `AIProvider`, (c) does not require a GPU, and (d) names the reference runtime technology without locking SmartAgentics to it.**

## 3. Options

### Option A: Link llama.cpp directly as a native Node addon (e.g., `node-llama-cpp`)

Bundle llama.cpp as a Node.js native module inside the SmartAgentics process. Maximum performance and tightest integration, but rebuild burden on every hotel IT platform, vendor lock-in, and version-coupling to llama.cpp internals. Per the research report (Section 2, "Rejected alternatives").

### Option B: OpenAI-compatible HTTP contract — recommended engine = llama.cpp, consumed via `llama-server` directly (no extra front-end)

Use llama.cpp's built-in `llama-server` (MIT) as the HTTP front-end. Endpoint `POST /v1/chat/completions`. Zero extra runtime beyond llama.cpp itself; lower-level operational surface (manual binary management, manual model registry). Per research Section 2.

### Option C: OpenAI-compatible HTTP contract — recommended engine = llama.cpp, consumed via a server front-end (Ollama as reference; LocalAI as explicit alternative)

Same OpenAI-compatible HTTP boundary as Option B, but consumed through a higher-level server: **Ollama** (MIT, native Windows installer, content-addressable model registry, `OLLAMA_NO_CLOUD=1` for true offline) as the reference, and **LocalAI** (MIT, 60+ swappable backends, single binary, multimodal-ready) as an explicit alternative at the identical contract boundary. The SDK never links to either — only HTTP. Per research Sections 3 and 9.

## 4. Decision

Adopt **Option C**. The Local AI Runtime architectural contract is:

1. **SDK interface** — A `LocalLLMRuntime` interface in `packages/sdk/src/ai/` that _extends_ the existing `AIProvider` with `load(modelId)`, `unload(modelId)`, `listLoaded()`, `health()`, `capabilities()`, and `selectModel(task, hardwareProfile)`. Existing `AIProvider` (cloud) is unchanged; existing cloud consumers continue to work.

2. **Reference runtime contract** — Any HTTP server exposing OpenAI-compatible `/v1/chat/completions` and `/v1/embeddings`. The SmartAgentics application MUST NEVER link directly to llama.cpp — only through HTTP, to preserve vendor swappability.

3. **Reference engine** — llama.cpp (MIT), as the de-facto foundation of the local LLM ecosystem and the engine beneath every viable front-end.

4. **Reference front-end** — **Ollama** (MIT) for the Phase 1 PoC and default hotel deployment. **LocalAI** (MIT) is an explicitly permitted substitute at the same HTTP contract boundary, recommended when multimodal local inference (vision, speech) is on the roadmap.

5. **Excluded runtimes** — closed-source runtimes (LM Studio — "internal business purposes" only license, no redistribution) and AGPL-3.0 runtimes (Text Generation WebUI, KoboldCpp — viral license incompatible with closed-source PMS distribution) are NOT permitted as production runtimes.

6. **Reserved for future cloud role** — vLLM (Apache 2.0) is NOT the hotel-side local runtime; it is reserved for the future cloud AI fallback / multi-tenant cloud deployment (per directive §"Optional cloud AI fallback").

7. **Mandatory CPU operation** — GPU is an _accelerator_, not a _prerequisite_. CPU-only operation MUST always work. GPU support: CUDA + Vulkan on Windows, CUDA + ROCm + Vulkan on Linux, Metal on macOS. Hybrid CPU+GPU offload via llama.cpp `--n-gpu-layers` is supported.

8. **Default Ollama configuration profile for hotel deployment** (deployment guide, not SDK contract):
   - `OLLAMA_NO_CLOUD=1` (true offline)
   - `OLLAMA_HOST=127.0.0.1:11434` (localhost only; LAN exposure via SmartAgentics authenticated reverse proxy)
   - `OLLAMA_KEEP_ALIVE=30m` (warm for typical shift duration)
   - `OLLAMA_MAX_LOADED_MODELS=2` (LLM + embedding model concurrently)
   - `OLLAMA_NUM_PARALLEL=2` (front desk + restaurant concurrent)

9. **Advisory quantization defaults** (actual selection is a runtime decision based on detected hardware per ADR-016):
   - **Q4_K_M** (GGUF k-quant) as the production default — best balance of size, quality, and CPU/GPU portability (~75% size reduction, ~5–15 tok/s on a modern 8-core CPU).
   - **Q5_K_M** where RAM allows (16 GB+ systems).
   - **Q8_0** for high-fidelity small models (e.g., Phi-3.5-mini at 3.8B).
   - Default model class for hotel workstations (8 GB RAM, no GPU, 4–8 core CPU): Phi-3.5-mini (3.8B) or Qwen2.5-3B-Instruct in Q4_K_M. Expected throughput 8–15 tok/s.
   - For 16 GB RAM + 6 GB+ VRAM GPU: Qwen2.5-7B-Instruct in Q4_K_M. Expected throughput 20–40 tok/s GPU, 5–10 tok/s CPU.
   - Thread tuning: `--threads` = physical core count, not logical; for hybrid P/E core CPUs use only P-cores.

10. **Multi-tenant isolation** — Ollama and llama-server have no concept of tenants; tenant isolation MUST be enforced at the SmartAgentics application layer (no shared conversation state, RAG retrieval scoped per tenant), to be specified by Stream 8.

11. **Resource management** — Ollama/llama-server handle queueing internally. SmartAgentics MUST NOT implement its own LLM request queue; instead, a per-tenant _request budget_ (rate limit) is enforced at the SmartAgentics application layer.

## 5. Rationale

- **Vendor swappability at the HTTP boundary**: All three viable front-ends (Ollama, llama-server, LocalAI) expose the same OpenAI-compatible endpoint. The SDK contracts against the HTTP API, not against a binary. Ollama can be swapped for llama-server or LocalAI without changing SmartAgentics code (research Section 3, "Inference" — "Upgrade path: ✅").
- **llama.cpp as engine** is the de-facto foundation (used by Ollama, GPT4All, KoboldCpp, LM Studio). MIT-licensed. Choosing it does not introduce lock-in (research Section 2).
- **Ollama as reference front-end** satisfies every Phase B Stream 1 evaluation criterion: offline-first (`OLLAMA_NO_CLOUD=1`), Windows/local (native Windows 10 22H2+ binary, no admin), LAN operation (`OLLAMA_HOST=0.0.0.0:11434`), Android client (OpenAI-compatible HTTP callable from any client), privacy (local only), persistence (`~/.ollama`), maintainability (single .exe installer, auto-updates), cost (MIT, no per-token fees), licensing (MIT), upgrade path (stable HTTP API contract), production viability (extensive production usage; vLLM docs reference it). Partial items (multi-tenant, security, sync) are mitigated at the application layer (research Section 3).
- **LocalAI as explicit alternative** matches the AI-BOS Local AI Runtime diagram (Local LLM Runtime + Embedding Runtime + Reranker + Speech Runtime + Vision Runtime); its 60+ swappable backends and single-binary architecture justify its adoption when multimodal local inference is on the roadmap (research Section 9).
- **CPU-first** is non-negotiable for hotel hardware diversity. CPU inference at 8–15 tok/s is viable for human-paced PMS interactions (research Section 12, SitePoint benchmark; arXiv 2505.06461 "When CPUs Outperform for On-Device LLM Inference" — 17 tok/s CPU vs 12.8 tok/s GPU for small models in specific configurations).
- **Excluding closed-source (LM Studio) and AGPL-3.0 (Text Generation WebUI, KoboldCpp) runtimes** is a licensing necessity for commercial PMS distribution (research Sections 4, 10, 11).
- **Q4_K_M as default** — best balance of size (~75% reduction), quality (~95–97% of FP16 per AWQ comparison baseline; 10–20% quality vs AWQ per SitePoint), and CPU/GPU portability (research Section 12). GPTQ (GPU-only, lower quality) and AWQ (GPU-required) are rejected for hotel-side; FP16/BF16 unquantized is too large.
- **Additive SDK change** — extending `AIProvider` with `LocalLLMRuntime` does not break the existing OpenAI provider (Foundational Conflict #3, migration impact: low cost).

## 6. Consequences

**Positive**:

- Phase 1 can ship cloud-only (per ADR-001) while reserving the local AI contract. No retrofit risk in Phase 2+.
- The HTTP-only boundary means SmartAgentics can swap Ollama ↔ llama-server ↔ LocalAI without code changes.
- CPU-first operation eliminates GPU as a hard requirement for hotel hardware.
- Existing cloud `AIProvider` consumers continue to work unchanged.

**Negative / obligations**:

- New SDK interfaces (`LocalLLMRuntime`) and reference implementation (Ollama-backed HTTP client) require ~1–2 weeks of Phase E engineering.
- `OLLAMA_NO_CLOUD=1` and `disable_ollama_cloud: true` MUST be enforced by SmartAgentics config — otherwise Ollama may attempt outbound calls (research Section 3 risks). Test this in the PoC.
- Ollama has no built-in auth; mitigation: bind to 127.0.0.1, expose via SmartAgentics' authenticated reverse proxy for LAN.
- Tenant isolation is entirely the application layer's responsibility (Stream 8).
- Below 5 tok/s feels "broken" to users — SmartAgentics MUST enforce a minimum hardware floor OR fall back to cloud AI.
- AMD ROCm on Windows is incomplete; Vulkan is the recommended fallback (research Section 13).
- Ollama tags move (`:latest` re-points) — the `ModelRegistry` (ADR-021) MUST pin specific SHA256 digests, not floating tags.
- Recommended Ollama env var profile must be documented in the deployment guide and validated in the PoC.

**Dependencies on other ADRs**:

- Depends on ADR-016 (Hardware Capability Detection) for runtime parameters.
- Depends on ADR-017 (Model Packaging / GGUF) for the model format.
- Depends on ADR-021 (Model Registry) for model selection, pinning, and activation.
- ADR-001 "Local AI: Deferred" should be amended to: "Local AI implementation: deferred. Local AI architectural contract: NOW." (per Foundational Conflict #1 — to be handled by a separate ADR-001 amendment, not by this ADR).
- Compatible with ADR-006 (SQLite) for caching hardware profiles and registry state.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Multimodal local inference (vision, speech) is on the Phase roadmap** — re-evaluate whether LocalAI should replace Ollama as the reference front-end (research Section 9).
2. **The future cloud AI fallback is designed** (per directive "Optional cloud AI fallback") — re-evaluate vLLM as the cloud-side runtime candidate (research Section 5).
3. **A critical Ollama breaking change** to the OpenAI-compatible HTTP API is released that cannot be mitigated at the SDK boundary.
4. **Hotel PoC measurements show CPU throughput below 5 tok/s** on representative hardware — re-evaluate the hardware floor or accelerate cloud fallback design.
5. **A new MIT/Apache-2.0 licensed runtime** emerges with materially better Windows/CPU performance than llama.cpp/Ollama.
6. **Native iOS/macOS SmartAgentics client is planned** — re-evaluate MLX (research Section 6) as a client-side engine.
7. **GGUF spec introduces incompatible metadata changes** that break the manifest schema defined in ADR-017.
8. **Annually**, as part of the regular ADR review cycle, to confirm the technology landscape has not shifted.
