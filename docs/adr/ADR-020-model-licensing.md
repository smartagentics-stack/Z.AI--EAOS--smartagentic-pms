# ADR-020: Model Licensing Policy

**ADR-ID:** ADR-020
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §B4 item #13) lists "Local model licensing" as a required capability, and File 2 §2 lists "model licensing metadata" as a required sub-capability of "Local AI Model Management — NOW". Phase B did not establish a model licensing policy because the cloud-only `AIProvider` (per B4 item #1) offloads all licensing responsibility to the cloud provider. Once SmartAgentics distributes model files to hotels (per ADR-017 Model Bundle), the licensing burden shifts to SmartAgentics: every model file must have its license tracked, displayed, and complied with.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Section 21) read the authoritative license texts in full for the major open-weight model families (Meta Llama 3 Community License, Gemma Terms of Use, Mistral Apache 2.0 and MNPL, Qwen2.5, Microsoft Phi-3 MIT) and confirmed that all major open-weight families permit commercial use under permissive-ish terms — the main compliance burden is attribution display and per-model license verification.

## 2. Problem

The architectural problem: **define which model licenses SmartAgentics will accept for hotel distribution, which it will reject, what attribution and metadata must be displayed, and what per-model verification procedure must run before a model enters the Model Registry** — such that SmartAgentics can legally bundle and distribute model files to commercial hotel customers without license violations, while preserving access to the most capable open-weight models (Llama, Gemma, Mistral, Qwen, Phi).

## 3. Options

### Option A: Only MIT-licensed models

Most permissive; zero attribution complexity. Rejected — excludes valuable models: Llama 3 (Community License), Gemma (Gemma Terms), Qwen (Apache 2.0 with caveats), most Mistral models. Would force SmartAgentics onto Phi-3.5-mini as the only viable model, which is too restrictive (research Section 21, "Rejected alternatives").

### Option B: Only fully OSI-approved open-source models

Strictest interpretation of "open source". Rejected — the Meta Llama 3 Community License is NOT OSI-approved but IS commercially usable (research Section 21). Excluding Llama would exclude one of the most capable and widely-used model families. The 700M MAU threshold is not a concern for a hotel PMS.

### Option C: Acceptable license list (MIT, Apache 2.0, Llama Community, Gemma Terms) + explicit exclusion of non-commercial licenses (Mistral MNPL and similar) + mandatory attribution display + per-model verification + license metadata in manifest

Define an explicit allow-list of acceptable licenses, an explicit deny-list of unacceptable licenses, mandatory `license` / `licenseUrl` / `attribution` fields in the manifest (per ADR-017), mandatory attribution display in the SmartAgentics UI, and a per-model verification procedure that runs before a model enters the registry. Per research Section 21.

## 4. Decision

Adopt **Option C**. The Model Licensing Policy is:

1. **Preferred model licenses for SmartAgentics** (no usage restrictions):
   - **MIT** — most permissive; e.g., Microsoft Phi-3.5-mini (research Section 21: "Phi models are open source through the MIT License").
   - **Apache 2.0** — permissive with patent grant; e.g., Mistral Apache 2.0 models (Mixtral 8x7B), Qwen2.5 (except 3B and 72B variants — verify per-model), Nomic Embed.

2. **Acceptable with attribution** — **Meta Llama 3 Community License**:
   - Permits commercial use, modification, distribution.
   - **Mandatory attribution**: "If you distribute or make available the Llama Materials ... you shall (A) provide a copy of this Agreement with any such Llama Materials; and (B) **prominently display 'Built with Meta Llama 3'** on a related website, user interface, blogpost, about page, or product documentation." (research Section 21, full license text read).
   - **Naming requirement**: "If you use the Llama Materials to create, train, fine tune, or otherwise improve an AI model, which is distributed or made available, you shall also include 'Llama 3' at the beginning of any such AI model name." — relevant only if SmartAgentics fine-tunes (excluded Phase 1 per directive Flag 7).
   - **700M MAU clause**: "If, on the Meta Llama 3 version release date, the monthly active users of the products or services made available by or for Licensee ... is greater than 700 million monthly active users in the preceding calendar month, you must request a license from Meta." — **not a concern for SmartAgentics** (hotel PMS will not approach 700M MAU); document for future AI-BOS expansion.

3. **Acceptable with care** — **Gemma Terms of Use**:
   - Permits commercial use, modification, distribution.
   - **Derivative-work clause**: "Any model trained on the output of Gemma is considered a Gemma derivative" (research Section 21). Only relevant if SmartAgentics fine-tunes on Gemma output — Phase 1 does not fine-tune (per directive Flag 7). Document for future.

4. **Per-model verification required** — some model families have heterogeneous licenses:
   - **Mistral models**: most are Apache 2.0, but some newer models use the **Mistral Non-Production License (MNPL)** — "This license allows developers to use our technology for **non-commercial purposes** and to support research work." (research Section 21). **Must check per-model.** MNPL-licensed models are NOT acceptable for SmartAgentics commercial deployment.
   - **Qwen2.5 models**: "All our open-source models, **except for the 3B and 72B variants**, are licensed under Apache 2.0." (research Section 21). **Must verify per-model** — the 3B and 72B variants use a separate license.

5. **Explicitly EXCLUDED licenses** (NOT acceptable for SmartAgentics):
   - **Mistral Non-Production License (MNPL)** — non-commercial only.
   - Any license with a "non-commercial" / "research-only" / "no commercial use" clause.
   - Any license that prohibits redistribution (e.g., LM Studio's "internal business purposes" only — relevant to runtime selection per ADR-015).
   - **Creative Commons NonCommercial (CC BY-NC)** variants.
   - **AGPL-3.0** for any model or runtime that SmartAgentics bundles — viral license incompatible with closed-source PMS distribution (relevant to runtime selection per ADR-015 — Text Generation WebUI, KoboldCpp excluded).

6. **License metadata in Model Bundle manifest** (per ADR-017 §6 schema) — every model bundle MUST include:
   - `license` — SPDX identifier or license name (e.g., `"apache-2.0"`, `"mit"`, `"llama3-community"`, `"gemma-terms"`).
   - `licenseUrl` — direct URL to the license text.
   - `attribution` — the attribution string SmartAgentics must display (e.g., `"Built with Meta Llama 3"`).

7. **SmartAgentics installer MUST display license + attribution on install**:
   - Before activating a model, the installer shows the license text and attribution string.
   - Operator (admin) must acknowledge before activation proceeds.
   - Per Llama 3 Community License requirement (B): "prominently display 'Built with Meta Llama 3' on a related website, user interface, blogpost, about page, or product documentation."

8. **SmartAgentics UI "About" page MUST list all installed models** with their licenses and attribution strings. This satisfies the "prominently display" requirement for Llama and the general attribution expectations for Apache 2.0 / MIT.

9. **License drift protection** — Per research Section 21 risks: "A model upstream may change license between versions. Mitigation: per-version license metadata; reject downgrade to non-commercial." The Model Registry (ADR-021) MUST store license metadata per `(modelId, version)` and refuse to activate a version whose license is not on the acceptable list, even if a previous version of the same `modelId` was acceptable.

10. **Phase 1 model selection** — to avoid attribution complexity in the PoC, Phase 1 should select an initial model with a permissive license:
    - **Recommended**: Phi-3.5-mini (MIT, 2.3 GB, ~12 tok/s on CPU per research Section 12) — zero attribution burden.
    - **Alternative**: Qwen2.5-7B-Instruct (Apache 2.0, except verify 3B/72B variants) — more capable; verify per-model.

## 5. Rationale

- **MIT and Apache 2.0 are the gold-standard permissive licenses** — no usage restrictions, no attribution burden beyond what SmartAgentics already plans for the "About" page (research Section 21).
- **Llama Community License is commercially usable** — the 700M MAU threshold is irrelevant to a hotel PMS (research Section 21: "Not a concern for SmartAgentics"). Excluding Llama (Option B) would exclude one of the most capable model families.
- **Gemma Terms derivative-work clause** is only relevant if SmartAgentics fine-tunes on Gemma output — Phase 1 excludes fine-tuning (directive Flag 7), so the clause is dormant (research Section 21).
- **Mistral MNPL must be checked per-model** — Mistral releases some models under Apache 2.0 (Mixtral 8x7B) and others under MNPL (newer models). A blanket "accept Mistral" would risk shipping a non-commercial model (research Section 21).
- **Qwen 3B and 72B variants** use a separate license from Apache 2.0 — must verify per-model (research Section 21).
- **Rejecting "only MIT"** — too restrictive; excludes Llama, Gemma, Qwen, most Mistral (research Section 21).
- **Rejecting "only OSI-approved"** — Llama Community License is not OSI-approved but is commercially usable; excluding it would exclude a top-tier model family (research Section 21).
- **Rejecting "allow any license"** — MNPL and other non-commercial licenses would block commercial deployment (research Section 21).
- **Attribution display requirements** — the Llama Community License mandates "prominently display"; the "About" page + per-install display satisfies this (research Section 21).
- **License drift protection** — upstream licenses can change between versions (research Section 21 risks); per-version metadata and refuse-to-downgrade prevents accidental non-commercial activation.

## 6. Consequences

**Positive**:

- SmartAgentics can legally distribute model files to commercial hotel customers under a clear, auditable policy.
- Access to the full range of capable open-weight model families (Llama, Gemma, Mistral Apache 2.0, Qwen, Phi) is preserved.
- Attribution compliance is automated via the manifest + UI "About" page + installer display.
- License drift is detected and blocked at activation time.
- Foundation for the AI-BOS "model licensing metadata" and "Local model licensing" capabilities (directive §2, §B4 item #13).

**Negative / obligations**:

- New `ModelLicense` value object in the SDK.
- UI changes required: installer license display + "About" page model list with license/attribution.
- Per-model verification procedure must run before registry entry — adds friction to adding new models.
- Automated UI test SHOULD verify attribution presence (research Section 21 risks: "Forgetting to display 'Built with Meta Llama 3' is a license violation. Mitigation: automated UI test that verifies attribution presence.").
- Phase 1 should pick a permissive-license model (Phi-3.5-mini MIT or Qwen2.5 Apache 2.0) to minimize attribution complexity in the PoC.
- License metadata MUST be re-verified on every version update (per ADR-019 UPDATED state) — a model that was MIT in v1.0.0 could become Llama Community in v1.1.0.
- The 700M MAU Llama threshold must be documented for future AI-BOS expansion — not a current concern but a future review trigger.
- The Gemma derivative-work clause becomes relevant if SmartAgentics ever fine-tunes (currently excluded per directive Flag 7) — re-evaluate at that time.

**Dependencies on other ADRs**:

- Depends on ADR-017 (Model Packaging) — the manifest carries `license`, `licenseUrl`, `attribution`.
- Depends on ADR-018 (Model Versioning) — license is per-version.
- Depends on ADR-021 (Model Registry) — the registry stores and enforces license metadata.
- Depends on ADR-019 (Model Lifecycle) — the VALIDATED state checks license acceptability before REGISTERED.
- Compatible with ADR-015 (Local AI Runtime) — closed-source / non-redistributable runtimes (LM Studio) and AGPL-3.0 runtimes (Text Generation WebUI, KoboldCpp) are already excluded at the runtime layer; this ADR extends the same principle to model files.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A model upstream changes license** between versions (research Section 21 risks) — re-evaluate the per-model verification procedure; consider adding automated license-text diffing.
2. **SmartAgentics approaches the 700M MAU Llama threshold** (very unlikely in the medium term; document for future AI-BOS expansion).
3. **SmartAgentics introduces fine-tuning** (currently excluded per directive Flag 7) — re-evaluate the Gemma derivative-work clause; re-evaluate the Llama naming requirement ("include 'Llama 3' at the beginning of any such AI model name").
4. **A new model family** with a novel license structure (e.g., a new "responsible use" license) becomes relevant — extend the acceptable / unacceptable lists by ADR amendment.
5. **A new SPDX-license-list entry** for any of the accepted licenses changes the canonical identifier — update the manifest vocabulary.
6. **Regulatory change** (e.g., EU AI Act model card requirements) imposes additional metadata — extend the manifest.
7. **A license violation incident** reveals gaps in the verification procedure — re-evaluate the per-model verification depth.
8. **Annually**, as part of the regular ADR review cycle.
