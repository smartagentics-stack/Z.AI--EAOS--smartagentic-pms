# ADR-093: Model Isolation — Ollama Low-Privilege Windows Service + Firewall Egress Block

**ADR-ID:** ADR-093
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #29 ("Offline AI security") flags model isolation as a "NOW" gap. Stream 1 already established that Ollama binds `127.0.0.1:11434` by default with `OLLAMA_NO_CLOUD=1` (per `phase-c-stream1-local-ai-runtime-report.md`), and that "Ollama runs locally. We don't see your prompts or data when you run locally." But Stream 1 did not specify the **defense-in-depth model isolation contract**: (a) Ollama as a separate OS process under a low-privilege Windows service account; (b) Windows Firewall egress block on the Ollama process; (c) no in-process model linking (no `node-llama-cpp`); (d) filesystem isolation between PMS data and model files.

The Stream 8 research (s20) surveyed sandbox and isolation patterns:

- **Augmentcode agent execution sandbox** (May 2026): "An agent execution sandbox is a production isolation boundary for AI-generated code because it restricts filesystem access, network egress, and [process spawning]."
- **Northflank secure AI-agent sandbox networking**: "An egress allowlist defines exactly where a sandbox can connect. Policies can restrict traffic by hostname, IP range, port, and protocol."
- **Innoq sandboxed coding agents** (March 2026): "I routed all network traffic from my development sandbox through a strict proxy allowlist, allowing only a small [set of trusted endpoints]."

The architectural insight is that **process isolation + HTTP boundary** is the minimum viable isolation for an offline-first Windows-deployed AI PMS. The OpenAI-compatible HTTP API at `127.0.0.1` is the _only_ ingress — no direct memory access from the Next.js PMS process. A prompt-injection attack that achieved code execution inside the Ollama process would be contained: the Ollama process has no filesystem access to PMS data, no network egress (firewall block), and no shared memory with the PMS process.

The hard rejected alternative is **in-process model linking via `node-llama-cpp`** — this would give the model direct access to the PMS process memory, a catastrophic isolation failure. A prompt-injection attack that achieved code execution would have direct DB access, direct access to PII in memory, and direct access to network sockets. Stream 1 §2 already specifies HTTP-only ingress; this ADR codifies it as a hard architectural constraint and adds the Windows-service and firewall controls.

## 2. Problem

Should SmartAgentics run the model in-process via `node-llama-cpp`, run Ollama on a separate LAN machine, run Ollama in a Docker container, or run Ollama as a native Windows service under a low-privilege account with firewall egress block?

## 3. Options

### Option A: In-process model linking via `node-llama-cpp`

Rejected. Gives the model direct access to PMS process memory. Catastrophic for isolation. A prompt-injection attack that achieved code execution would have direct DB access, direct PII access, direct network socket access. Stream 1 §2 already specifies HTTP-only ingress; this ADR codifies the rejection as a hard constraint.

### Option B: Ollama on a separate LAN machine (Phase 1)

Partially rejected. Phase 1 = same machine (single-machine hotel server). Phase 2+ = acceptable for hub-and-spoke topology (Stream 7), but then Ollama is on the hub only, never on spokes. Spokes proxy LLM calls via the hub.

### Option C: Docker container for Ollama

Acceptable on Windows via Docker Desktop, but adds Docker as a runtime dependency. Phase 1 prefers native Windows service (simpler install). Phase 2+ may containerize for stronger isolation if Docker Desktop is already required for Langfuse (ADR-091).

### Option D: No isolation (run Ollama as the logged-in user with default firewall)

Rejected. The logged-in user may have admin privileges; a compromised Ollama process would inherit them. Default Windows Firewall allows outbound — a compromised Ollama could exfiltrate data.

### Option E: Ollama as low-privilege Windows service + firewall egress block + filesystem isolation + HTTP-only ingress

Adopted. Defense-in-depth model isolation contract: (a) separate OS process under `NT SERVICE\OllamaSvc`; (b) HTTP-only ingress at `127.0.0.1:11434`; (c) Windows Firewall inbound = `127.0.0.1:11434` only, outbound = block all on the Ollama process; (d) filesystem isolation; (e) no in-process linking (hard constraint).

## 4. Decision

Adopt **Option E** — the defense-in-depth model isolation contract.

### 1. Process isolation

Ollama runs as a separate Windows service under a dedicated low-privilege service account (`NT SERVICE\OllamaSvc`), NOT as the logged-in user. The Next.js PMS process communicates only via HTTP at `127.0.0.1:11434`. The Ollama process has no filesystem access to PMS data (`C:\ProgramData\SmartAgentics\Data\pms.db`); the PMS process has no filesystem access to model files (`%HOMEPATH%\.ollama\models`).

### 2. Network isolation

- **Windows Firewall rule on the Ollama service account**: inbound = `127.0.0.1:11434` only; outbound = block all (the model never needs to call out — model weights are pre-downloaded at install time, not at inference time).
- **Windows Firewall rule on the Next.js PMS**: outbound = allow `127.0.0.1:11434` (for LLM calls) + LAN hub (for Stream 7 sync) + LAN printer + local SMTP; block all other outbound by default.

### 3. No in-process model linking (hard architectural constraint)

SmartAgentics MUST NOT link to llama.cpp/Ollama as a native Node addon (e.g., `node-llama-cpp`). The OpenAI-compatible HTTP API is the **only** ingress. Rationale: in-process linking gives the model direct access to the PMS process memory — a prompt-injection attack that achieved code execution would have direct DB access. HTTP isolation contains the blast radius. (Stream 1 §2 already specifies this; this ADR codifies it as a hard constraint.)

### 4. Filesystem isolation

- PMS data: `C:\ProgramData\SmartAgentics\Data\pms.db` — accessible only to the PMS service account.
- Model files: `%HOMEPATH%\.ollama\models` — accessible only to the Ollama service account.
- No shared filesystem path between the two processes.

### 5. Per-tenant model registry partition (Phase 2+)

Each tenant has its own model-registry directory (`%HOMEPATH%\.ollama\models\tenant-{tenantId}`); models loaded with `OLLAMA_MODELS` env var per-request. Phase 1: single shared registry (acceptable because Phase 1 is single-tenant-per-deployment per Stream 7 §0.2).

### Installer verification

The Windows installer:

1. Registers the `NT SERVICE\OllamaSvc` service account.
2. Configures the Windows Firewall rules (inbound `127.0.0.1:11434` only; outbound block on Ollama process).
3. Verifies the firewall rules post-install; if missing, aborts with `FirewallConfigurationError`.
4. Documents the GPU-specific permissions for the service account (`Load and adjust memory quotas of a process` and GPU-specific permissions).

### Phase 1 scope

- Windows installer changes (no source code change in the PMS itself).
- ~1 week of Phase E engineering.
- No SDK code change.

## 5. Rationale

- **OWASP LLM01:2025 blast-radius containment** (s01): even if a prompt-injection attack achieves code execution inside Ollama, the damage is contained — no PMS data access, no network egress, no shared memory.
- **Augmentcode principle** (s20): "An agent execution sandbox is a production isolation boundary ... restricts filesystem access, network egress, and [process spawning]" — all three materialized (filesystem isolation, firewall egress block, separate process).
- **Northflank principle** (s20): "An egress allowlist defines exactly where a sandbox can connect" — outbound block on the Ollama process is the strictest possible egress control (the model never needs to call out).
- **HTTP-only ingress** is the minimum viable isolation for an offline-first Windows-deployed AI PMS — no shared memory, no direct DB access.
- **In-process linking rejected** (hard constraint): `node-llama-cpp` would give the model direct access to PMS process memory — catastrophic for isolation.
- **Low-privilege service account** (`NT SERVICE\OllamaSvc`) ensures a compromised Ollama process does not inherit admin privileges from the logged-in user.
- **Filesystem isolation** ensures a compromised Ollama cannot read `pms.db` directly.
- **Phase 1 single-machine** matches Stream 7 §0.2 (single-tenant-per-deployment); Phase 2+ hub-and-spoke extends cleanly (Ollama on hub only).
- **No new runtime dependencies**: native Windows service + Windows Firewall (both built-in).

## 6. Consequences

- Windows installer changes: Ollama service account registration, firewall rules, verification script.
- No source code change in the PMS itself.
- New `AIAuditEvent` event type: `MODEL_INTEGRITY_VERIFIED` (at load time, per ADR-092).
- **Risk: Windows Firewall rule may be misconfigured by hotel IT during install.** Mitigation: installer verifies the rule post-install; if missing, aborts with `FirewallConfigurationError`.
- **Risk: the low-privilege service account may not have permission to load GPU drivers** (NVIDIA/ROCm). Mitigation: documented Windows install procedure grants the service account `Load and adjust memory quotas of a process` and GPU-specific permissions.
- **Risk: a hotel IT admin disables the firewall rule post-install** (e.g., to "fix" a connectivity issue). Mitigation: nightly verification job checks the firewall rule; if missing, alerts + `AIAuditEvent` `eventType=FIREWALL_MISCONFIGURED`.
- **Risk: Phase 2+ hub-and-spoke requires Ollama on the hub only** — spokes proxy LLM calls via the hub. Mitigation: documented in Stream 7 ADR-075; this ADR's controls apply to the hub Ollama instance.
- **Risk: Docker containerization (Phase 2+ option) would change the isolation model.** Mitigation: Docker provides stronger isolation (container boundary) but adds Docker Desktop as a dependency; Phase 2+ may containerize if Docker is already required for Langfuse (ADR-091).
- Dependencies: Stream 1 Ollama runtime; Windows installer; Windows Firewall (built-in); no new runtime dependencies.
- Phase 1 effort: ~1 week (Windows installer changes + verification script). No SDK code change.

## 7. Review Conditions

- Review if a hotel IT admin disables the firewall rule post-install — would require the nightly verification job to fire `FIREWALL_MISCONFIGURED` alerts.
- Review if Phase 2+ hub-and-spoke topology requires extending the isolation contract to the hub Ollama instance — would add LAN-specific controls (TLS between spoke and hub, hub-only model loading).
- Review if Docker Desktop becomes a required dependency (e.g., for Langfuse, ADR-091) — would consider containerizing Ollama for stronger isolation.
- Review if a GPU driver permission issue arises on a specific Windows version — would update the documented install procedure.
- Review if a community model-isolation standard emerges (e.g., NIST AI RMF isolation profile) that should replace the SmartAgentics-owned contract.
- Review if Phase 3+ requires multi-tenant model registry partition (per-tenant model directories) — would activate control #5.
- Review if a hotel demands a different model runtime (e.g., vLLM, llamafile) — would re-evaluate the isolation contract for the new runtime.
