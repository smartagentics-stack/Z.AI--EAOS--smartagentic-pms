# ADR-016: Hardware Capability Detection

**ADR-ID:** ADR-016
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §4) classifies **Hardware Capability Detection** as an "Architecture Contract — NOW" capability. Phase B B4 item #4 confirmed that the SmartAgentics SDK currently has no `HardwareCapabilityDetector` interface and no concept of hardware profiles. The existing cloud-only `AIProvider` (per B4 item #1) has no concept of quantization, model size, or hardware requirements — because the cloud provider handles all of that transparently.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Sections 13 and 14) established that hardware detection is feasible using only Node.js built-ins (`os`, `fs`) plus driver-bundled CLI tools (`nvidia-smi`, `system_profiler`, `vulkaninfo`, `rocminfo`) — no native addons required. The detection result feeds model selection (per ADR-015 advisory defaults and ADR-021 Model Registry), e.g., "this machine has 8 GB RAM and no GPU → use Phi-3.5-mini Q4_K_M".

## 2. Problem

The architectural problem: **define a cross-platform, zero-heavy-dependency hardware capability detector that produces a `HardwareProfile` value object the local runtime can use to (a) select an appropriate model, (b) choose CPU vs GPU vs hybrid execution, (c) enforce minimum hardware floors, and (d) avoid cold-start surprises for hotel staff.** The detector must run on Windows (primary hotel platform), with macOS and Linux support for dev/cloud-fallback scenarios, and must not require hotel IT to install additional dependencies beyond the GPU driver stack (which is pre-installed if a GPU is present).

## 3. Options

### Option A: Native Node addon for hardware detection (e.g., `node-cuda`, `node-sysctl`)

Maximum fidelity GPU/CPU introspection via native APIs. Rejected — heavy native dependency, build complexity on Windows, requires per-platform prebuilt binaries, and breaks the "no native addons" principle established by ADR-015 (research Section 14, "Rejected alternatives").

### Option B: Pure shell-out approach — call OS CLI tools (`wmic`, `system_profiler`, `lshw`, `/proc/cpuinfo`, `nvidia-smi`) for everything

No Node built-ins; parse CLI output for CPU, RAM, GPU, disk. Rejected — large dependency on Linux-only tools (`lshw`, `hwinfo`), fragile CLI parsing, deprecated Windows tools (`wmic`), and bypasses the cross-platform `os`/`fs` built-ins that already solve most of the problem (research Section 14, "Rejected alternatives").

### Option C: Hybrid — Node.js built-ins (`os`, `fs`) for CPU/RAM/disk/OS/arch + driver-bundled CLI tools (`nvidia-smi`, `system_profiler`, `vulkaninfo`, `rocminfo`) for GPU only

Use Node.js standard library for everything it can do cross-platform (CPU model/speed/cores via `os.cpus()`, architecture via `os.arch()`, RAM via `os.totalmem()`, disk via `fs.statfs` (Node 18+), platform via `os.platform()`). Shell out to driver-bundled CLIs _only_ for GPU detection — these tools are pre-installed with their respective driver stacks (NVIDIA driver → `nvidia-smi`; macOS → `system_profiler`; Vulkan SDK / AMD driver → `vulkaninfo`; ROCm → `rocminfo`). Cache results in SQLite (per ADR-006). Per research Section 14.

## 4. Decision

Adopt **Option C**. The Hardware Capability Detection architectural contract is:

1. **SDK interface** — A `HardwareCapabilityDetector` interface in `packages/sdk/src/ai/` exposing:
   - `detect(): Promise<HardwareProfile>` — fresh detection (slow; shell-out to driver CLIs).
   - `profile(): Promise<HardwareProfile>` — cached detection (fast path; backed by SQLite per ADR-006).

2. **`HardwareProfile` value object**:

   ```
   HardwareProfile {
     cpu: { cores: number; physicalCores: number; architecture: string; features: string[]; model: string }
     ram: { totalBytes: number; availableBytes: number }
     gpus: Array<{ vendor: 'nvidia' | 'amd' | 'apple' | 'intel' | 'unknown'; model: string; vramTotalBytes: number; vramFreeBytes: number; driverVersion: string; backend: 'cuda' | 'rocm' | 'vulkan' | 'metal' | 'none' }>
     disk: { totalBytes: number; availableBytes: number }
     os: 'win32' | 'linux' | 'darwin'
     arch: 'x64' | 'arm64' | 'ia32' | 'arm'
     detectedAt: ISO8601
   }
   ```

3. **Detection strategy**:
   - **CPU**: `os.cpus()` (model, speed, times per core), `os.arch()`, `os.availableParallelism()` (Node 18.14+). On Linux: parse `/proc/cpuinfo` flags (avx2, avx512, amx, avx_vnni, sse4_2). On Windows: `Get-CimInstance Win32_Processor` PowerShell (replaces deprecated `wmic`). On macOS: `sysctl -n machdep.cpu.features` and `sysctl -n machdep.cpu.leaf7_features`.
   - **RAM**: `os.totalmem()` and `os.freemem()` (cross-platform, zero-dependency).
   - **Disk**: `fs.statfs` (Node 18+, cross-platform).
   - **GPU (CUDA)**: shell out to `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv` (per NVIDIA nvidia-smi manual). Available wherever the NVIDIA driver is installed (Windows + Linux).
   - **GPU (Metal)**: macOS only. `system_profiler SPDisplaysDataType`. Metal API for device properties.
   - **GPU (ROCm)**: `rocminfo` and `rocm-smi` (Linux primarily; Windows support limited).
   - **GPU (Vulkan)**: `vulkaninfo` (cross-vendor, cross-platform) — Vulkan SDK tool. Per Ollama Windows docs, Vulkan is the recommended AMD fallback on Windows.
   - **OS/architecture**: `os.platform()`, `os.arch()`, `process.platform`, `process.arch`.

4. **Caching**: Detection results are cached in a SQLite table (per ADR-006 SQLite foundation). Hardware rarely changes during a session — cache lifetime = process session, with a manual `detect()` refresh on demand (e.g., admin "Refresh hardware" button).

5. **GPU is optional** — CPU-only operation MUST always work (per ADR-015 §7). The detector returns `gpus: []` when no GPU is present, and the runtime falls back to CPU.

6. **Supported backends per OS** (per ADR-015 §7 and research Section 13):
   - **Windows**: CUDA (NVIDIA) + Vulkan (cross-vendor fallback, including AMD where ROCm is unavailable).
   - **Linux**: CUDA + ROCm (AMD) + Vulkan.
   - **macOS**: Metal (Apple Silicon). (Dev environment only; not a hotel target.)

7. **Graceful degradation** — driver CLI tools may not be present (e.g., `nvidia-smi` missing if NVIDIA driver not installed). The detector MUST handle missing tools gracefully and log a warning, never throw.

8. **Defensive parsing** — driver CLI output formats vary across versions. Parse defensively; fall back to "unknown" rather than crash.

## 5. Rationale

- **Node.js built-ins are zero-dependency and cross-platform** for the majority of the detection surface (CPU model/speed, RAM, disk, OS, arch). Using them avoids native-addon build burden on Windows hotel IT (research Section 14).
- **Driver-bundled CLIs are already present** wherever the corresponding GPU is installed — `nvidia-smi` ships with the NVIDIA driver, `system_profiler` ships with macOS, `vulkaninfo` ships with the Vulkan SDK / AMD driver. No additional dependencies for hotel IT to install (research Section 14).
- **No native Node addons** preserves the ADR-015 principle that the SDK never links to GPU-specific native code; the detector is a thin shell-out layer (research Section 14, "Rejected alternatives").
- **SQLite caching** (ADR-006) avoids repeated shell-outs during a session; hardware rarely changes mid-session (research Section 14).
- **GPU optional + CPU fallback mandatory** is non-negotiable for hotel hardware diversity (per ADR-015 §7; research Section 13 — "SmartAgentics must NOT require a GPU. GPU is an accelerator, not a prerequisite. CPU-only operation must always work.").
- **Vulkan as AMD Windows fallback** — per Ollama Windows docs: "Some RDNA2 / Radeon RX 6000 systems, including RX 6800-class cards, may not expose ROCm v7 on current Windows AMD drivers. Vulkan is enabled by default and is the recommended fallback for those systems." (research Section 13).
- **Rejecting `wmic` (deprecated) for Windows** in favor of `Get-CimInstance Win32_Processor` PowerShell (research Section 14).

## 6. Consequences

**Positive**:

- SmartAgentics can run on any hotel Windows workstation without GPU hardware purchases — the foundation of offline AI viability (research Section 12).
- Model selection is automated: no human needs to pick "Phi-3.5-mini Q4_K_M for this 8 GB machine" — the detector + registry handles it.
- Zero additional dependencies for hotel IT — uses only what's already installed (Node.js + optional GPU driver).
- Detection result feeds ADR-015's advisory quantization defaults → automated, hardware-aware model selection.

**Negative / obligations**:

- New SDK interface and reference implementation required (~3–5 days per Phase E recommendation #3).
- Windows ARM detection is less mature — needs validation in PoC (research Section 14 risks).
- `nvidia-smi` not present if NVIDIA driver not installed — must handle gracefully.
- Driver CLI output format may vary across versions — parse defensively.
- Caching policy must be defined: stale cache after hardware change (e.g., RAM upgrade) requires manual `detect()` refresh.

**Dependencies on other ADRs**:

- Depends on ADR-006 (SQLite) for caching.
- Depends on ADR-015 (Local AI Runtime) — the detector exists to serve the runtime's model selection.
- Feeds ADR-021 (Model Registry) — the registry uses `HardwareProfile` to filter installable models by `hardwareRequirements` from the manifest (per ADR-017).
- Feeds ADR-017 (Model Packaging) — the manifest's `hardwareRequirements.minRamGb`, `minVramGb`, `recommendedRamGb` are matched against the detected profile.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A future Node.js LTS release** ships stable cross-platform CPU feature detection (e.g., `os.cpuFeatures()`) that replaces the need for `/proc/cpuinfo`/`sysctl`/`Get-CimInstance` parsing.
2. **Windows ARM adoption at hotels** becomes material — validate detection maturity and re-evaluate.
3. **A new GPU vendor** (e.g., Intel Arc, Moore Threads) becomes relevant for hotel hardware — add the corresponding detection path (`intel_gpu_top`, MUSA tools).
4. **DirectML support** becomes a primary path (e.g., if llama.cpp adds a DirectML backend) — add DirectML detection on Windows.
5. **A native Node addon** emerges that is sufficiently cross-platform and permissively licensed to remove the shell-out complexity.
6. **Annually**, as part of the regular ADR review cycle, to confirm the detection surface has not shifted.
