# ADR-017: Model Packaging (GGUF)

**ADR-ID:** ADR-017
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §B4 item #28) classifies **Offline model packaging** as a required capability, and File 2 §2 requires model packaging as a sub-capability of "Local AI Model Management — NOW". Hotel distribution has hard constraints that cloud distribution does not: (a) USB/LAN transfer of multi-GB files, (b) integrity verification across untrusted transfer media, (c) embedded tokenizer + chat template (hotel IT must not need to know the model's chat format), (d) cross-runtime portability (the same model file must load in Ollama, llama-server, and LocalAI per ADR-015).

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Section 16) established that **GGUF** (GGML format) is the only viable single-file format meeting all four constraints. Safetensors (multi-file, no embedded tokenizer) is acceptable only as a cloud-side interchange format. ONNX is relevant only for non-LLM models (vision, speech). Pickle (legacy PyTorch) is a security risk.

## 2. Problem

The architectural problem: **define the canonical on-disk and distribution model packaging format for SmartAgentics' local AI runtime, the structure of the distributable "Model Bundle", the manifest schema, and the integrity verification procedure** — such that hotel IT can install models via USB, LAN, or online mirror with cryptographic assurance, and the same file loads in any OpenAI-compatible runtime supported by ADR-015.

## 3. Options

### Option A: Safetensors as the hotel distribution format

Safetensors is the default format on Hugging Face Hub (April 2026, per DataCamp). Stores tensor weights; security-audited (Hugging Face Safetensors Security Audit, May 2023). Rejected as hotel distribution format — multi-file (requires `config.json`, `tokenizer.json`, `generation_config.json` companions); no embedded chat template; complicates offline transfer and forces hotel IT to know the model's chat format (research Section 16).

### Option B: ONNX as the LLM format

ONNX Runtime supports CPU, CUDA, DirectML, CoreML, OpenVINO. Cross-platform, cross-framework. Rejected for LLMs — conversion overhead, no quality benefit over GGUF for LLMs, mismatched to the llama.cpp ecosystem (research Section 16). Reserved as relevant only for non-LLM models (vision, speech) in future AI-BOS phases.

### Option C: GGUF (GGML format) as the primary on-disk and distribution format, wrapped in a Model Bundle (GGUF + manifest.json + license.txt) with mandatory SHA256 integrity verification

GGUF is a single-file deployment format: "Single-file deployment: they can be easily distributed and loaded, and do not require any external files for additional information." (Hugging Face GGUF docs). mmap-compatible for fast loading. Embedded tokenizer and chat template. Content-addressable. Extensible metadata (key-value structure). Supports sidecars (mmproj-, mtp-, LoRA, vocab-only) and sharding. Per research Section 16.

## 4. Decision

Adopt **Option C**. The Model Packaging architectural contract is:

1. **Primary model packaging format: GGUF** (k-quant variants). All local LLM models distributed to hotels MUST be in GGUF format.

2. **Safetensors** is acceptable ONLY as a _cloud-side interchange format_ (e.g., downloading from Hugging Face and converting to GGUF for hotel distribution). It is NOT a hotel-distribution format.

3. **ONNX** is relevant ONLY for non-LLM models (vision, speech) in future AI-BOS phases. It is NOT a Phase 1 concern for the local LLM runtime.

4. **Rejected formats**:
   - Safetensors as hotel distribution — multi-file, no embedded tokenizer.
   - ONNX as LLM format — conversion overhead, no quality benefit.
   - **Pickle (legacy PyTorch)** — security risk (arbitrary code execution).
   - **GGML (old format)** — deprecated, replaced by GGUF.

5. **Model Bundle structure** — the distributable unit is a `.zip` or `.tar.gz` archive containing:
   - `<ModelName>-<Version>-<Quantization>.gguf` — the model weights file.
   - `manifest.json` — the model manifest (schema below).
   - `license.txt` — the model's license text (required by ADR-020).

6. **`manifest.json` schema**:

   ```json
   {
     "modelId": "qwen2.5-7b-instruct",
     "version": "1.0.0",
     "runtime": "ollama | llama-server | localai",
     "format": "gguf",
     "quantization": "Q4_K_M",
     "architecture": "qwen2",
     "contextLength": 32768,
     "parameterCount": 7000000000,
     "fileSizeBytes": 4400000000,
     "sha256": "<hex digest of the GGUF file>",
     "capabilities": ["text-generation", "tool-calling"],
     "hardwareRequirements": {
       "minRamGb": 8,
       "minVramGb": 0,
       "recommendedRamGb": 16
     },
     "license": "apache-2.0",
     "licenseUrl": "https://...",
     "attribution": "..."
   }
   ```

   Field requirements:
   - `modelId` — stable identifier (matches ADR-018 `modelId`).
   - `version` — semantic version `MAJOR.MINOR.PATCH`, SmartAgentics-controlled (per ADR-018).
   - `runtime` — at least one of the ADR-015-permitted runtimes.
   - `quantization` — GGUF quantization label (e.g., `Q4_K_M`, `Q5_K_M`, `Q8_0`).
   - `sha256` — SHA256 of the GGUF file. **Mandatory.**
   - `capabilities` — capability strings from the vocabulary defined in ADR-018 (`text-generation`, `tool-calling`, `vision`, `embeddings`, `reranking`).
   - `hardwareRequirements` — used by the Model Registry (ADR-021) and matched against the `HardwareProfile` from ADR-016.
   - `license`, `licenseUrl`, `attribution` — required by ADR-020.

7. **GGUF naming convention** (from the GGUF spec): `[<Sidecar>-]<BaseName><SizeLabel><FineTune><Version><Encoding><Type><Shard>.gguf`. Example: `Meta-Llama-3-8B-Instruct-v1.0-Q4_K_M.gguf`. The GGUF filename inside the bundle SHOULD follow this convention.

8. **GGUF metadata fields** (from spec, must be readable by SmartAgentics):
   - `general.name`, `general.architecture`, `general.basename`, `general.size_label`, `general.finetune`, `general.version`, `general.file_type` (quantization encoding), tokenizer info, chat template.

9. **Distribution mechanisms**:
   - **Online (initial install)**: SmartAgentics downloads GGUF from a **SmartAgentics-controlled mirror** — NOT directly from Hugging Face or Ollama registry. Reason: version control, integrity, licensing compliance (per ADR-019).
   - **Offline transfer (USB/LAN)**: Model Bundle (`.zip` / `.tar.gz`) transferred via USB or LAN file share.

10. **Integrity verification — MANDATORY on every install/transfer**:
    - SHA256 of the GGUF file computed at install time (Node.js `crypto` built-in).
    - Compared against `manifest.json.sha256`.
    - **Reject on mismatch.** Log to audit trail.
    - Ollama's content-addressable blob store additionally provides blob-level SHA256 verification (per Ollama registry pattern, research Section 16).

11. **Distribution source-of-truth** — The SmartAgentics-controlled mirror is the canonical source for hotel distribution. Hugging Face and Ollama registry are _upstream sources_ for the mirror, not direct hotel-install sources (per ADR-019).

## 5. Rationale

- **GGUF is the only viable single-file format for local LLM distribution** — embedded tokenizer and chat template is a major operational simplification (hotel IT does not need to know the model's chat format), `mmap` compatibility enables fast loading, content-addressable enables integrity and dedup (research Section 16, "Inference").
- **Safetensors multi-file** — requires `config.json`, `tokenizer.json`, `generation_config.json` companions; no embedded chat template; complicates offline USB transfer; rejected as hotel distribution (research Section 16).
- **ONNX mismatched to llama.cpp ecosystem** — conversion overhead, no quality benefit for LLMs (research Section 16); reserved for non-LLM models in future phases.
- **Pickle security risk** — arbitrary code execution on load; rejected (research Section 16).
- **SmartAgentics-controlled mirror** — direct Hugging Face download is rejected for production: no version control, no integrity guarantee, licensing complexity (per ADR-019). The mirror is the application-layer enforcement of version pinning and licensing compliance.
- **SHA256 mandatory** — Ollama already provides content-addressed blob SHA256 verification (research Section 16); SmartAgentics adds an independent SHA256 check on the GGUF file (independent of Ollama) for runtime-agnostic integrity (per ADR-019 §VALIDATED state).
- **GGUF naming convention** — adopted from the GGUF spec to ensure cross-runtime portability and human-readable audit trails.
- **Bundle format `.zip` / `.tar.gz`** — ubiquitous, no special tooling required for hotel IT.

## 6. Consequences

**Positive**:

- Single-file distribution model that loads in any ADR-015-permitted runtime (Ollama, llama-server, LocalAI).
- Embedded chat template eliminates a class of "wrong chat format" bugs.
- SHA256 integrity verification on every install/transfer — cryptographic assurance for USB/LAN distribution.
- The manifest schema is the single source of truth for model identity, version, capabilities, hardware requirements, and licensing — consumed by ADR-021 (Registry), ADR-016 (Hardware), ADR-018 (Versioning), ADR-019 (Lifecycle), ADR-020 (Licensing).
- Foundation for the AI-BOS "Offline model packaging" capability (directive §B4 item #28).

**Negative / obligations**:

- Model bundles are 2–30 GB; USB transfer is slow. Mitigation: bundle compression; document expected transfer times (research Section 16 risks).
- GGUF metadata schema evolves — minor breaking changes to metadata keys have occurred historically (research Section 2 risks). Mitigation: pin to a GGUF version; test before deployment; the manifest's `compatibility.minRuntimeVersion` field (per ADR-018) guards against GGUF/runtime drift.
- Each model carries its own license — the manifest MUST record `license`, `licenseUrl`, `attribution` (per ADR-020); the SmartAgentics installer MUST display license + attribution on install.
- New `ModelPackage` interface and `ModelBundle` schema required in the SDK.
- SmartAgentics must operate the model mirror (Phase E infrastructure) — direct HF/Ollama download is acceptable for PoC only (per ADR-019).

**Dependencies on other ADRs**:

- Depends on ADR-015 (Local AI Runtime) — GGUF is the format consumed by the runtime.
- Depends on ADR-018 (Model Versioning) — the `version`, `capabilities`, and `compatibility` fields are specified by ADR-018.
- Depends on ADR-019 (Model Lifecycle) — the bundle is the unit distributed through DISCOVERED → DOWNLOADED → VALIDATED → REGISTERED.
- Depends on ADR-020 (Model Licensing) — the `license`, `licenseUrl`, `attribution` fields and display requirements are specified by ADR-020.
- Depends on ADR-021 (Model Registry) — the manifest is the unit registered in the registry.
- Depends on ADR-016 (Hardware Capability Detection) — `hardwareRequirements` is matched against `HardwareProfile`.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **GGUF spec introduces incompatible metadata changes** that break the manifest schema or the GGUF metadata fields SmartAgentics reads.
2. **A successor format to GGUF** (e.g., a hypothetical GGUF v4 or a new single-file standard) achieves ecosystem adoption across llama.cpp, Ollama, and LocalAI.
3. **SmartAgentics introduces local multimodal models** (vision, speech) — re-evaluate ONNX as a co-format for non-LLM models.
4. **SmartAgentics introduces fine-tuning** (currently excluded per directive Flag 7) — re-evaluate LoRA sidecar packaging and Safetensors as a training-side interchange format.
5. **A new integrity mechanism** (e.g., Sigstore signing for models) becomes an industry standard — add signature verification alongside SHA256.
6. **Bundle sizes grow beyond USB practical limits** (e.g., 100 GB+ models) — re-evaluate sharding and delta distribution.
7. **Annually**, as part of the regular ADR review cycle.
