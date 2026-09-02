# ADR-092: Model Trust — OpenSSF Sigstore Model Signing + SLSA Provenance

**ADR-ID:** ADR-092
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #29 ("Offline AI security") flags model integrity as a "NOW" gap. Stream 8 Foundational Conflict **FC-8.8** (High) flags the deeper issue: Stream 1 specified GGUF as the model format but did NOT specify **model signing / supply-chain verification**. The install media (USB stick, downloaded installer) is itself a supply-chain attack surface — a malicious actor who substitutes a tampered GGUF on the install media would gain code execution inside the Ollama process the moment the model loads.

The Stream 8 research (s07) identified the production-ready standard:

- **OpenSSF Model Signing v1.0 launch** (April 2025, `https://openssf.org/blog/2025/04/04/launch-of-model-signing-v1-0-openssf-ai-ml-working-group-secures-the-machine-learning-supply-chain`): "The aim of the project is to provide a library and CLI for signing and verification of ML models, supporting any type of model format and models [of any size]." Integrating with Hugging Face and Kaggle.
- **Sigstore model-transparency GitHub** (`https://github.com/sigstore/model-transparency`): "This project demonstrates how to protect the integrity of a model by signing it. We support generating signatures via Sigstore, a tool for making code [signing easy]."
- **Google security blog: Taming the Wild West of ML** (April 2025): "The three steps involved in building an [AI supply chain security program]: sign models at training time; verify signatures at deployment time; publish provenance attestations."
- **Red Hat model authenticity** (April 2025): "The Sigstore model transparency project is a significant step toward applying software supply chain signing [to ML]."
- **OWASP LLM03:2025 Supply Chain Vulnerabilities** (s01, s05): #3 LLM risk. Includes vulnerable model files, malicious pre-trained models, supply-chain attacks on model repositories.

The three-step Google principle (sign at training time, verify at deployment, publish provenance) maps directly to SmartAgentics' release pipeline: (1) sign at packaging time (the SmartAgentics model packager signs the GGUF with a project key); (2) verify at load time (Ollama loads only verified GGUFs; an unsigned GGUF is rejected with `ModelIntegrityError`); (3) SLSA Build Level 3 provenance attestation captures source, build, output, license, signer.

Sigstore's keyless signing (Fulcio CA + Rekor transparency log) is more secure and auditable than PGP — PGP key management is error-prone. Sigstore is independent of Hugging Face's own integrity checks (which verify file hashes but do not sign models cryptographically — a man-in-the-middle attack on the HF download could substitute a malicious model with a valid HF hash).

## 2. Problem

Should SmartAgentics trust Hugging Face's integrity checks, use manual PGP signature by a release engineer, adopt Sigstore model signing, or skip signing (trust the install media)? Should provenance be SLSA Build Level 3?

## 3. Options

### Option A: Trust Hugging Face's own integrity checks

Partially rejected. HF does verify file hashes but does not sign models cryptographically. A man-in-the-middle attack on the HF download could substitute a malicious model with a valid HF hash. Sigstore signature is independent of HF.

### Option B: Manual PGP signature by SmartAgentics release engineer

Rejected. PGP key management is error-prone; Sigstore's keyless signing (Fulcio CA + Rekor transparency log) is more secure and more auditable.

### Option C: No model signing (trust the install media)

Rejected. The install media (USB stick, downloaded installer) is itself a supply-chain attack surface. Sigstore signing defends against tampered install media.

### Option D: Encryption-in-use (confidential computing, homomorphic)

Rejected for Phase 1. Adds 100-1000× latency. Reserved for Phase 3+ if a high-security deployment demands it. Not a substitute for signing — addresses a different threat (in-use confidentiality, not at-rest integrity).

### Option E: Sigstore model signing + SLSA Build Level 3 provenance + verify at install and load time

Adopted. Sign at packaging time; verify at install time (Windows installer) and load time (Ollama model loader wrapper); SLSA Build Level 3 attestation captures full provenance.

## 4. Decision

Adopt **Option E** — Sigstore model signing + SLSA provenance.

### At packaging time (SmartAgentics release pipeline)

Every GGUF model file is signed with Sigstore (specifically, `sigstore/model-transparency` CLI) using the SmartAgentics project key. The signature is stored alongside the model file as `{model}.gguf.sigstore`.

### SLSA Build Level 3 provenance attestation

A SLSA Build Level 3 attestation is generated for each model, capturing:

- **Source**: Hugging Face repo URL + commit hash (e.g., `microsoft/Phi-3.5-mini-instruct@abc123`).
- **Build**: llama.cpp commit hash + quantization parameters (e.g., Q4_K_M).
- **Output**: GGUF file SHA-256 hash + size.
- **License**: model card license (e.g., MIT for Phi-3.5).
- **Signer**: SmartAgentics project key ID + timestamp.

### At load time (Ollama loads a model)

The SmartAgentics model loader (a small wrapper around `ollama pull` / `ollama load`) verifies the Sigstore signature before allowing Ollama to load the model. If verification fails → `ModelIntegrityError` + `AIAuditEvent` `eventType=MODEL_INTEGRITY_FAILED` + abort the load.

### At install time (Windows installer)

The installer verifies signatures of all bundled models before completing the install. Unsigned or invalidly-signed models → abort install with clear error.

### `ModelSignature` Prisma table (new)

Records verified signatures per model file: `modelId, modelVersion, ggufSha256, sigstoreSignature, slsaProvenance JSON, verifiedAt, verifiedBy`.

### `ModelIntegrityVerifier` Restate service (new)

Wraps the Sigstore verification; called by the model loader at load time and by the installer at install time.

### Phase 1 scope

- Sigstore CLI integration in the installer (~1 week).
- Runtime verifier (~3 days).
- Release pipeline integration (~3 days).
- Phase 1 ships with Phi-3.5-mini and Qwen2.5-7B; both are MIT/Apache licensed and from reputable publishers, but SmartAgentics must re-sign them with the project key to defend against tampered install media.

### Key management

- SmartAgentics project key stored in HSM or GitHub Actions OIDC keyless signing (Sigstore's recommended pattern).
- Key rotation procedure documented.
- Phase 2+ may move to a hardware-backed key.

## 5. Rationale

- **FC-8.8 closure**: model signing / supply-chain verification is specified; the install media attack surface is closed.
- **OWASP LLM03:2025 closure** (s01): the #3 LLM risk (Supply Chain) is addressed.
- **OpenSSF Model Signing v1.0 is production-ready** (s07, April 2025): the de-facto standard, integrating with HF and Kaggle.
- **Google three-step principle** (s07): sign at training time, verify at deployment, publish provenance — all three materialized.
- **Sigstore keyless signing** (Fulcio CA + Rekor transparency log) is more secure and auditable than PGP — no key management error-proneness.
- **Independent of HF integrity checks**: a MITM attack on HF download cannot substitute a malicious model — the Sigstore signature is independent.
- **SLSA Build Level 3** captures full provenance — source, build, output, license, signer — enabling forensic reconstruction if a model is later found malicious.
- **Verify at both install and load time** — defense-in-depth: install-time verification catches tampered install media; load-time verification catches tampered model files post-install (e.g., a disk-level attack).
- **Red Hat endorsement** (s07): "a significant step toward applying software supply chain signing [to ML]" — industry confidence in the approach.

## 6. Consequences

- New `ModelSignature` Prisma table (records verified signatures per model file).
- New `ModelIntegrityVerifier` Restate service.
- Release pipeline changes (signing step) — no source code change in the PMS itself.
- Windows installer gains Sigstore verification step.
- New `AIAuditEvent` event types: `MODEL_INTEGRITY_VERIFIED`, `MODEL_INTEGRITY_FAILED`.
- **Risk: Sigstore key management — if the SmartAgentics project key is compromised, all signed models are untrustworthy.** Mitigation: key stored in HSM or GitHub Actions OIDC keyless signing (Sigstore's recommended pattern); key rotation procedure documented.
- **Risk: model files are large (2–7GB GGUF); signing takes minutes.** Mitigation: signing is a release-pipeline step, not a per-load step; verification at load is fast (SHA-256 + signature check, seconds).
- **Risk: Phase 1 ships with Phi-3.5-mini and Qwen2.5-7B from reputable publishers** — but SmartAgentics must re-sign them with the project key to defend against tampered install media. Mitigation: release pipeline re-signs every bundled model.
- **Risk: Sigstore CLI is a Python/Go toolchain; Windows compatibility.** Mitigation: `sigstore/model-transparency` CLI is cross-platform; verified Windows-compatible per the project README.
- **Risk: SLSA Build Level 3 requires hermetic builds** — the SmartAgentics release pipeline may not yet be hermetic. Mitigation: Phase 1 ships SLSA Build Level 2 (provenance without hermeticity); Phase 2 upgrades to Level 3.
- Dependencies: `sigstore/model-transparency` CLI (MIT); SmartAgentics release pipeline; Ollama model loader wrapper.
- Phase 1 effort: ~2 weeks (Sigstore CLI integration in installer ~1 week, runtime verifier ~3 days, release pipeline integration ~3 days).

## 7. Review Conditions

- Review if Sigstore key compromise is suspected — would invoke key rotation procedure and re-sign all historical models.
- Review if Phase 2+ requires SLSA Build Level 3 (hermetic builds) — would upgrade the release pipeline.
- Review if a model is later found malicious (e.g., a backdoored GGUF) — the SLSA provenance enables forensic reconstruction of the build.
- Review if Hugging Face adopts Sigstore natively (per s07, integration is in progress) — would simplify the SmartAgentics release pipeline (sign once at HF, verify at SmartAgentics load).
- Review if a community model-trust standard emerges (e.g., NIST AI RMF supply-chain profile) that should replace the SmartAgentics-owned approach.
- Review if Phase 3+ requires hardware-backed key (HSM) — would move the project key to HSM.
- Review if a hotel demands self-service model upload (e.g., a fine-tuned LoRA adapter) — would require a per-tenant signing workflow.
