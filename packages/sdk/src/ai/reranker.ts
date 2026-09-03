// ADR-025 Reranker — NoOp Phase 1 default; bge-reranker-v2-m3 (ONNX int8) reserved for Phase 2+.
// Invoked by the Retriever (ADR-024) AFTER hybrid fusion, BEFORE parent-child expansion.
// Phase 1 introduces NO new runtime dependency (onnxruntime-node is Phase 2+ only).

import type { ModelId, Version } from './runtime.js';
import type { ModelHealth } from './runtime.js';
import type { SearchResult } from './retriever.js';

/** Reranker implementation strategy. */
export type RerankerStrategy = 'noop' | 'cross-encoder' | 'llm-listwise';

/** Options for a rerank() call. */
export interface RerankOptions {
  /** Maximum candidates to score (cross-encoder sweet spot = 20). */
  readonly maxCandidates?: number;
  /** Override the runtime default model. */
  readonly modelId?: ModelId;
  /** Return at most topK reranked candidates. */
  readonly topK?: number;
  readonly tenantId: string;
}

/** Input to a reranker: query + fused candidates from Retriever. */
export interface RerankerInput {
  readonly query: string;
  readonly candidates: readonly SearchResult[];
  readonly options?: RerankOptions;
}

/** Reranked output with updated scores and ordering. */
export interface RerankerOutput {
  readonly reranked: readonly SearchResult[];
  readonly modelId: ModelId | null;
  readonly strategy: RerankerStrategy;
  readonly latencyMs: number;
}

/** Phase 1 default — passthrough config (returns candidates unchanged). */
export interface NoOpRerankerConfig {
  readonly strategy: 'noop';
  readonly preserveOrder: boolean;
}

/** Phase 2+ cross-encoder config (bge-reranker-v2-m3, 568M params, ~570 MB int8 ONNX). */
export interface CrossEncoderRerankerConfig {
  readonly strategy: 'cross-encoder';
  readonly modelId: ModelId;
  readonly version: Version;
  readonly maxCandidates: number;
  readonly runtimeBackend: 'onnx-cpu' | 'onnx-gpu';
}

/**
 * Reranker contract per ADR-025.
 * NoOpReranker is the Phase 1 default (passthrough); BgeRerankerV2M3Reranker is the Phase 2+ upgrade.
 * Activation is a behind-the-interface swap — no architectural change.
 */
export interface Reranker {
  rerank(input: RerankerInput): Promise<RerankerOutput>;
  health?(): Promise<ModelHealth>;
}
