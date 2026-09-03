// ADR-022 Local Embeddings — EmbeddingsRuntime Interface.
// Contract boundary is OpenAI-compatible HTTP (/v1/embeddings, Ollama /api/embed).
// The application NEVER loads an embedding model in-process for the primary path.

import type { ModelHealth } from './runtime.js';
import type { ModelId, Version } from './runtime.js';

/** Default embedding model: nomic-embed-text-v1.5 (Apache 2.0, 768 dim, 8192-token context). */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text-v1.5' as const;

/** Default embedding dimension for nomic-embed-text-v1.5. */
export const DEFAULT_EMBEDDING_DIM = 768 as const;

/** Options passed to EmbeddingsRuntime.embed(). */
export interface EmbedOptions {
  /** Matryoshka truncation dimension (768 → 512/256/128/64 for Nomic v1.5). */
  readonly dim?: number;
  /** L2-normalize output vectors (default: true). */
  readonly normalize?: boolean;
  /** Override the runtime default model. */
  readonly modelId?: ModelId;
  /** Batch size for HTTP calls (default: 32). */
  readonly batchSize?: number;
}

/** Metadata for a registered embedding model. */
export interface EmbeddingModel {
  readonly modelId: ModelId;
  readonly version: Version;
  readonly dim: number;
  readonly maxContextTokens: number;
  readonly normalize: boolean;
  readonly matryoshkaSupported: boolean;
}

/** Request to embed one or more texts. */
export interface EmbeddingRequest {
  readonly texts: readonly string[];
  readonly options?: EmbedOptions;
  readonly tenantId: string;
}

/** Normalized embedding response — number[][] regardless of upstream HTTP shape. */
export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
  readonly modelId: ModelId;
  readonly version: Version;
  readonly dim: number;
  readonly usage: { readonly promptTokens: number; readonly totalTokens: number };
  readonly latencyMs: number;
}

/**
 * EmbeddingsRuntime contract per ADR-022 §4.1.
 * Normalizes divergent upstream response shapes (Ollama /api/embed, OpenAI /v1/embeddings,
 * Cohere /v1/embed, Mistral /v1/embeddings) to a single number[][] return type.
 */
export interface EmbeddingsRuntime {
  embed(texts: readonly string[], options?: EmbedOptions): Promise<readonly (readonly number[])[]>;
  listEmbeddingModels(): Promise<readonly EmbeddingModel[]>;
  loadEmbeddingModel(modelId: ModelId, version: Version): Promise<void>;
  unloadEmbeddingModel(modelId: ModelId, version: Version): Promise<void>;
  health(modelId: ModelId, version: Version): Promise<ModelHealth>;
}

/** Additive extension to AIProvider so cloud providers MAY also implement embed() (ADR-022 §4.2). */
export interface EmbeddingCapableProvider {
  embed(texts: readonly string[], options?: EmbedOptions): Promise<readonly (readonly number[])[]>;
}
