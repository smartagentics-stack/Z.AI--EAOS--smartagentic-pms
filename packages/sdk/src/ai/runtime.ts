// ADR-015 Local AI Runtime · ADR-016 Hardware Capability Detection · ADR-021 Model Registry
// Architectural contract for offline-first OpenAI-compatible HTTP LLM runtimes (Ollama / llama-server / LocalAI).
// Extends the existing cloud-shaped AIProvider (./index.js) WITHOUT breaking existing consumers.

import type { AIProvider, AIRequest, AIResponse } from './index.js';

/** Identifier of a registered model (matches Ollama manifest modelId or SmartAgentics internal id). */
export type ModelId = string;

/** Semantic version pin per ADR-018 (e.g., "1.0.0"). */
export type Version = string;

/** Lifecycle status per ADR-019. */
export type ModelLifecycleStatus =
  'DISCOVERED' | 'REGISTERED' | 'ACTIVATED' | 'DEACTIVATED' | 'ROLLED_BACK' | 'REMOVED';

/** Category of work a model can perform; used by selectModel(). */
export type ModelTask =
  'text-generation' | 'tool-calling' | 'embeddings' | 'reranking' | 'vision' | 'speech';

/** Supported quantization formats per ADR-017. */
export type Quantization = 'Q4_K_M' | 'Q5_K_M' | 'Q6_K' | 'Q8_0' | 'F16' | 'FP32';

/** Reference runtime engine per ADR-015 §4.4–4.5. */
export type RuntimeEngine = 'ollama' | 'llama-server' | 'localai';

/** Detected hardware capability envelope per ADR-016 (CPU-first; GPU is an accelerator, never a prerequisite). */
export interface HardwareProfile {
  readonly cpuCoresPhysical: number;
  readonly cpuCoresLogical: number;
  readonly ramTotalGb: number;
  readonly ramAvailableGb: number;
  readonly vramTotalGb: number;
  readonly gpuBackend: 'none' | 'cuda' | 'vulkan' | 'rocm' | 'metal';
  readonly gpuModel: string | null;
  readonly os: 'windows' | 'linux' | 'macos';
  readonly architecture: 'x64' | 'arm64';
}

/** Bundled model artifact descriptor registered into the registry (DISCOVERED → REGISTERED). */
export interface ModelBundle {
  readonly modelId: ModelId;
  readonly name: string;
  readonly version: Version;
  readonly upstreamVersion: Version | null;
  readonly provider: string;
  readonly runtime: RuntimeEngine;
  readonly modelType: ModelTask;
  readonly contextLength: number;
  readonly quantization: Quantization;
  readonly parameterCount: bigint;
  readonly fileSizeBytes: bigint;
  readonly sha256: string;
  readonly capabilities: readonly ModelTask[];
  readonly hardwareRequirements: {
    readonly minRamGb: number;
    readonly minVramGb: number;
    readonly recommendedRamGb: number;
  };
  readonly compatibility: {
    readonly minRuntimeVersion: string;
    readonly maxRuntimeVersion: string | null;
    readonly runtimeEngine: RuntimeEngine;
    readonly ggufVersion: number;
  };
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly attribution: string | null;
  readonly installedLocation: string;
}

/** Persisted model record per ADR-021 — the application-layer source of truth (Ollama blob store is the runtime-level store). */
export interface Model {
  readonly id: string;
  readonly modelId: ModelId;
  readonly name: string;
  readonly version: Version;
  readonly provider: string;
  readonly runtime: RuntimeEngine;
  readonly modelType: ModelTask;
  readonly contextLength: number;
  readonly quantization: Quantization;
  readonly parameterCount: bigint;
  readonly fileSizeBytes: bigint;
  readonly sha256: string;
  readonly capabilities: readonly ModelTask[];
  readonly hardwareRequirements: {
    readonly minRamGb: number;
    readonly minVramGb: number;
    readonly recommendedRamGb: number;
  };
  readonly compatibility: {
    readonly minRuntimeVersion: string;
    readonly maxRuntimeVersion: string | null;
    readonly runtimeEngine: RuntimeEngine;
    readonly ggufVersion: number;
  };
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly attribution: string | null;
  readonly status: ModelLifecycleStatus;
  readonly installedLocation: string;
  readonly installedAt: string;
  readonly lastUsedAt: string | null;
}

/** Optional filter for ModelRegistry.list(). */
export interface ModelFilter {
  readonly tenantId?: string;
  readonly runtime?: RuntimeEngine;
  readonly modelType?: ModelTask;
  readonly status?: ModelLifecycleStatus;
}

/** Health probe result for a model + runtime. */
export interface ModelHealth {
  readonly modelId: ModelId;
  readonly version: Version;
  readonly loaded: boolean;
  readonly healthy: boolean;
  readonly latencyMs: number | null;
  readonly errorMessage: string | null;
}

/**
 * Local LLM runtime contract per ADR-015. Extends the cloud-shaped AIProvider
 * with model load/unload, health, capabilities, and hardware-aware selection.
 * Implementations MUST be HTTP-only — the application MUST NEVER link to llama.cpp directly.
 */
export interface LocalLLMRuntime extends AIProvider {
  load(modelId: ModelId, version: Version): Promise<void>;
  unload(modelId: ModelId, version: Version): Promise<void>;
  listLoaded(): Promise<readonly Model[]>;
  health(modelId: ModelId, version: Version): Promise<ModelHealth>;
  capabilities(): Promise<readonly ModelTask[]>;
  selectModel(task: ModelTask, hardware: HardwareProfile): Promise<ModelId>;
  generate(request: AIRequest): Promise<AIResponse>;
  isAvailable(): boolean;
  estimateCost(
    request: AIRequest,
  ): Promise<{ readonly estimatedCostUSD: number; readonly estimatedTokens: number }>;
}

/**
 * Application-layer Model Registry per ADR-021. Single source of truth for
 * installed models, version pinning (ADR-018), and lifecycle transitions (ADR-019).
 */
export interface ModelRegistry {
  register(bundle: ModelBundle): Promise<ModelId>;
  activate(modelId: ModelId, version: Version): Promise<void>;
  deactivate(modelId: ModelId, version: Version): Promise<void>;
  list(filter?: ModelFilter): Promise<readonly Model[]>;
  get(modelId: ModelId, version: Version): Promise<Model>;
  rollback(modelId: ModelId, toVersion: Version): Promise<void>;
  remove(modelId: ModelId, version: Version): Promise<void>;
  health(modelId: ModelId, version: Version): Promise<ModelHealth>;
}

/**
 * Hardware capability detector per ADR-016. Probes the host machine to inform
 * model selection and quantization defaults. CPU-only operation MUST always work.
 */
export interface HardwareCapabilityDetector {
  detect(): Promise<HardwareProfile>;
  meetsMinimum(
    hardware: HardwareProfile,
    requirements: {
      readonly minRamGb: number;
      readonly minVramGb: number;
      readonly recommendedRamGb: number;
    },
  ): boolean;
}
